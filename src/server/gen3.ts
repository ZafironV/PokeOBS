// Reglas puras de la detección automática en la Generación III (estructuras de pokeemerald).

/** sizeof(struct BattlePokemon). */
export const BATTLE_MON_SIZE = 0x58;
export const BATTLE_MONS_LENGTH = BATTLE_MON_SIZE * 4;

export const BATTLE_TYPE_DOUBLE = 1 << 0;
export const BATTLE_TYPE_TRAINER = 1 << 3;

/**
 * Índice interno de especie → número nacional, para los índices 277..411
 * (1..251 coinciden; 252..276 son huecos sin uso). Extraído de la tabla de la
 * ROM de Esmeralda española (0x323F3E); es la misma en todas las ediciones Gen III.
 */
const HOENN: readonly number[] = [
  252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274,
  275, 290, 291, 292, 276, 277, 285, 286, 327, 278, 279, 283, 284, 320, 321, 300, 301, 352, 343, 344, 299, 324, 302,
  339, 340, 370, 341, 342, 349, 350, 318, 319, 328, 329, 330, 296, 297, 309, 310, 322, 323, 363, 364, 365, 331, 332,
  361, 362, 337, 338, 298, 325, 326, 311, 312, 303, 307, 308, 333, 334, 360, 355, 356, 315, 287, 288, 289, 316, 317,
  357, 293, 294, 295, 366, 367, 368, 359, 353, 354, 336, 335, 369, 304, 305, 306, 351, 313, 314, 345, 346, 347, 348,
  280, 281, 282, 371, 372, 373, 374, 375, 376, 377, 378, 379, 382, 383, 384, 380, 381, 385, 386, 358,
];

export function gen3ToNational(internal: number): number | null {
  if (internal >= 1 && internal <= 251) return internal;
  if (internal >= 277 && internal <= 411) return HOENN[internal - 277];
  return null;
}

export interface BattleMon {
  /** Número nacional; null si el índice interno no es una especie válida. */
  species: number | null;
  internal: number;
  /** Valor de personalidad: distingue dos ejemplares de la misma especie. */
  personality: number;
  hp: number;
  maxHp: number;
  level: number;
}

export interface BattleSnapshot {
  inBattle: boolean;
  typeFlags: number;
  /** Posiciones 0..3: 0 y 2 son del jugador; 1 y 3, rivales. */
  mons: BattleMon[];
}

export function parseBattleMons(buf: Buffer): BattleMon[] {
  const mons: BattleMon[] = [];
  for (let i = 0; i < 4; i++) {
    const o = i * BATTLE_MON_SIZE;
    if (o + BATTLE_MON_SIZE > buf.length) break;
    const internal = buf.readUInt16LE(o);
    mons.push({
      internal,
      species: gen3ToNational(internal),
      hp: buf.readUInt16LE(o + 0x28),
      level: buf[o + 0x2a],
      maxHp: buf.readUInt16LE(o + 0x2c),
      personality: buf.readUInt32LE(o + 0x48),
    });
  }
  return mons;
}

/** Datos con sentido: descarta lecturas a medio cargar o memoria sin inicializar. */
function plausible(m: BattleMon | undefined): m is BattleMon & { species: number } {
  return !!m && m.species !== null && m.level >= 1 && m.level <= 100 && m.maxHp > 0 && m.hp <= m.maxHp;
}

export interface Detection {
  /** Especies a mostrar; la primera va delante (la que acaba de aparecer). */
  species: number[];
  kind: 'wild' | 'trainer';
  double: boolean;
}

export type TrackerEvent =
  | { type: 'battle-start'; kind: 'wild' | 'trainer'; double: boolean }
  | { type: 'battle-end' }
  | ({ type: 'detect' } & Detection);

/** Datos que siguen en memoria del combate anterior: se ignoran durante este tiempo al empezar otro. */
export const STALE_MS = 5000;

/**
 * Sigue el combate a partir de lecturas periódicas y decide cuándo mostrar fichas.
 *
 * - Cada Pokémon rival que aparece genera una detección, aunque se repita la
 *   especie: se identifica por especie + personalidad.
 * - Una lectura solo cuenta si se repite dos veces seguidas (evita datos a medio escribir).
 * - Al empezar un combate, gBattleMons puede conservar aún el rival anterior:
 *   esos datos se ignoran hasta que cambian o pasan STALE_MS.
 * - Un rival debilitado (PS 0) no se vuelve a mostrar junto a su compañero.
 */
export class BattleTracker {
  private inBattle = false;
  private startedAt = 0;
  private shown = new Map<number, string>();
  private previousKeys = new Set<string>();
  private candidate = '';

  update(snap: BattleSnapshot, now: number): TrackerEvent[] {
    const events: TrackerEvent[] = [];
    if (!snap.inBattle) {
      if (this.inBattle) {
        events.push({ type: 'battle-end' });
        this.previousKeys = new Set(this.shown.values());
      }
      this.inBattle = false;
      this.shown.clear();
      this.candidate = '';
      return events;
    }
    const double = (snap.typeFlags & BATTLE_TYPE_DOUBLE) !== 0;
    const kind = snap.typeFlags & BATTLE_TYPE_TRAINER ? 'trainer' : 'wild';
    if (!this.inBattle) {
      this.inBattle = true;
      this.startedAt = now;
      events.push({ type: 'battle-start', kind, double });
    }

    const slots = double ? [1, 3] : [1];
    const present = new Map<number, BattleMon & { species: number }>();
    for (const s of slots) {
      const m = snap.mons[s];
      if (!plausible(m) || m.hp === 0) continue;
      const k = key(m);
      if (now - this.startedAt < STALE_MS && this.previousKeys.has(k)) continue;
      present.set(s, m);
    }

    const signature = [...present].map(([s, m]) => `${s}=${key(m)}`).join('|');
    const stable = signature === this.candidate;
    this.candidate = signature;
    if (!stable || present.size === 0) return events;

    const fresh = [...present].filter(([s, m]) => this.shown.get(s) !== key(m));
    if (fresh.length === 0) return events;
    for (const [s, m] of present) this.shown.set(s, key(m));
    const others = [...present].filter(([s]) => !fresh.some(([f]) => f === s));
    events.push({
      type: 'detect',
      species: [...fresh, ...others].map(([, m]) => m.species),
      kind,
      double,
    });
    return events;
  }
}

const key = (m: BattleMon) => `${m.internal}:${m.personality}`;
