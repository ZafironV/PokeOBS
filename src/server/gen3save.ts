// Lectura de los datos de la partida en la Generación III (estructuras de pokeemerald):
// equipo, cajas del PC, mochila, medallas y Pokédex. Funciones puras sobre los bytes leídos.
import type { PocketId } from '../shared/types.js';
import { gen3ToNational } from './gen3.js';

/** sizeof(struct BoxPokemon) y sizeof(struct Pokemon). */
export const BOX_MON_SIZE = 80;
export const PARTY_MON_SIZE = 100;
export const PARTY_SIZE = 6;
export const BOXES = 14;
export const BOX_CAPACITY = 30;
/** PokemonStorage: currentBox (u8 + relleno), 14 × 30 BoxPokemon, 14 nombres de 9 bytes y 14 fondos. */
export const STORAGE_BOXES_OFFSET = 4;
export const STORAGE_NAMES_OFFSET = STORAGE_BOXES_OFFSET + BOXES * BOX_CAPACITY * BOX_MON_SIZE;
export const STORAGE_WALLPAPERS_OFFSET = STORAGE_NAMES_OFFSET + BOXES * 9;
export const STORAGE_LENGTH = STORAGE_WALLPAPERS_OFFSET + BOXES;

/** Desplazamientos dentro de SaveBlock1/SaveBlock2 (iguales en todos los idiomas de Esmeralda). */
export const SAVE = {
  /** SaveBlock2: nombre (0x00) y sexo (0x08) del jugador, Pokédex (capturados en 0x28, vistos en 0x5C) y clave de cifrado en 0xAC. */
  sb2Start: 0x00,
  sb2Length: 0xb0,
  playerName: 0x00,
  playerGender: 0x08,
  pokedexOwned: 0x28,
  pokedexSeen: 0x5c,
  encryptionKey: 0xac,
  /** SaveBlock1: dinero (0x490) y bolsillos de la mochila (0x560..0x848). */
  sb1BagStart: 0x490,
  sb1BagLength: 0x848 - 0x490,
  money: 0x490,
  /** Banderas del juego en SaveBlock1; las medallas son las banderas 0x867..0x86E. */
  flags: 0x1270,
  badgeFlag: 0x867,
} as const;

export const POCKETS = [
  { id: 'items', label: 'Objetos', offset: 0x560, slots: 30 },
  { id: 'balls', label: 'Poké Balls', offset: 0x650, slots: 16 },
  { id: 'tmhm', label: 'MT y MO', offset: 0x690, slots: 64 },
  { id: 'berries', label: 'Bayas', offset: 0x790, slots: 46 },
  { id: 'key', label: 'Objetos clave', offset: 0x5d8, slots: 30 },
] as const satisfies readonly { id: PocketId; label: string; offset: number; slots: number }[];

export const HOENN_BADGES = ['Piedra', 'Puño', 'Dinamo', 'Calor', 'Equilibrio', 'Pluma', 'Mente', 'Lluvia'];

// ── Texto ────────────────────────────────────────────────────────────────────

/** Juego de caracteres occidental de la Gen III (comprobado en la ROM española). */
const CHARS: Record<number, string> = {
  0x00: ' ', 0x01: 'À', 0x02: 'Á', 0x03: 'Â', 0x04: 'Ç', 0x05: 'È', 0x06: 'É', 0x07: 'Ê', 0x08: 'Ë', 0x09: 'Ì',
  0x0b: 'Î', 0x0c: 'Ï', 0x0d: 'Ò', 0x0e: 'Ó', 0x0f: 'Ô', 0x10: 'Œ', 0x11: 'Ù', 0x12: 'Ú', 0x13: 'Û', 0x14: 'Ñ',
  0x15: 'ß', 0x16: 'à', 0x17: 'á', 0x19: 'ç', 0x1a: 'è', 0x1b: 'é', 0x1c: 'ê', 0x1d: 'ë', 0x1e: 'ì', 0x20: 'î',
  0x21: 'ï', 0x22: 'ò', 0x23: 'ó', 0x24: 'ô', 0x25: 'œ', 0x26: 'ù', 0x27: 'ú', 0x28: 'û', 0x29: 'ñ', 0x2a: 'º',
  0x2b: 'ª', 0x2d: '&', 0x2e: '+', 0x35: '=', 0x36: ';', 0x51: '¿', 0x52: '¡', 0x5a: 'Í', 0x5b: '%', 0x5c: '(',
  0x5d: ')', 0x68: 'â', 0x6f: 'í', 0x85: '<', 0x86: '>', 0xab: '!', 0xac: '?', 0xad: '.', 0xae: '-', 0xaf: '·',
  0xb0: '…', 0xb1: '“', 0xb2: '”', 0xb3: '‘', 0xb4: '’', 0xb5: '♂', 0xb6: '♀', 0xb8: ',', 0xb9: '×', 0xba: '/',
  0xf0: ':', 0xf1: 'Ä', 0xf2: 'Ö', 0xf3: 'Ü', 0xf4: 'ä', 0xf5: 'ö', 0xf6: 'ü',
};
for (let i = 0; i < 10; i++) CHARS[0xa1 + i] = String(i);
for (let i = 0; i < 26; i++) {
  CHARS[0xbb + i] = String.fromCharCode(65 + i);
  CHARS[0xd5 + i] = String.fromCharCode(97 + i);
}
const CODES = new Map(Object.entries(CHARS).map(([k, v]) => [v, Number(k)]));

/** Texto del juego hasta el terminador 0xFF; los códigos desconocidos se omiten. */
export function decodeText(buf: Buffer): string {
  let out = '';
  for (const b of buf) {
    if (b === 0xff) break;
    out += CHARS[b] ?? '';
  }
  return out.trim();
}

/** Inverso de decodeText (para pruebas y datos simulados). */
export function encodeText(text: string, length: number): Buffer {
  const buf = Buffer.alloc(length, 0xff);
  [...text].slice(0, length).forEach((c, i) => (buf[i] = CODES.get(c) ?? 0xac));
  return buf;
}

// ── Pokémon ──────────────────────────────────────────────────────────────────

/** Orden de las 4 subestructuras (G crecimiento, A ataques, E esfuerzo, M varios) según personalidad % 24. */
const ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
];

export interface BoxMon {
  /** Número nacional; null si el índice interno no es válido. */
  species: number | null;
  nickname: string;
  experience: number;
  heldItem: number;
  isEgg: boolean;
  shiny: boolean;
  /** Poké Ball en la que se capturó (1 Master … 4 Poké … 12 Premier; 0 si no se sabe). */
  ball: number;
}

export interface PartyMon extends BoxMon {
  level: number;
  hp: number;
  maxHp: number;
  /** Estado alterado (dormido, envenenado…): 0 si ninguno. */
  status: number;
}

export function isShiny(personality: number, otId: number): boolean {
  return ((otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff)) < 8;
}

/**
 * Descifra un BoxPokemon (80 bytes). Devuelve null si el hueco está vacío o si
 * la suma de comprobación no cuadra (datos a medio escribir o basura).
 */
export function parseBoxMon(buf: Buffer, offset = 0): BoxMon | null {
  const personality = buf.readUInt32LE(offset);
  const otId = buf.readUInt32LE(offset + 4);
  const flags = buf[offset + 0x13];
  const hasSpecies = (flags & 0x02) !== 0;
  if (!hasSpecies && personality === 0 && otId === 0) return null;
  const key = (personality ^ otId) >>> 0;
  const data = Buffer.alloc(48);
  for (let i = 0; i < 48; i += 4) data.writeUInt32LE((buf.readUInt32LE(offset + 0x20 + i) ^ key) >>> 0, i);
  let sum = 0;
  for (let i = 0; i < 48; i += 2) sum = (sum + data.readUInt16LE(i)) & 0xffff;
  if (sum !== buf.readUInt16LE(offset + 0x1c)) return null;
  const order = ORDERS[personality % 24];
  const at = (s: string) => order.indexOf(s) * 12;
  const g = at('G');
  const m = at('M');
  const internal = data.readUInt16LE(g);
  if (internal === 0) return null;
  const ivEggAbility = data.readUInt32LE(m + 4);
  const isEgg = (flags & 0x04) !== 0 || (ivEggAbility & 0x40000000) !== 0;
  return {
    species: gen3ToNational(internal),
    nickname: isEgg ? 'Huevo' : decodeText(buf.subarray(offset + 8, offset + 18)),
    experience: data.readUInt32LE(g + 4),
    heldItem: data.readUInt16LE(g + 2),
    isEgg,
    shiny: isShiny(personality, otId),
    ball: (data.readUInt16LE(m + 2) >> 11) & 0xf,
  };
}

export function parsePartyMon(buf: Buffer, offset = 0): PartyMon | null {
  const box = parseBoxMon(buf, offset);
  if (!box) return null;
  return {
    ...box,
    status: buf.readUInt32LE(offset + 0x50),
    level: buf[offset + 0x54],
    hp: buf.readUInt16LE(offset + 0x56),
    maxHp: buf.readUInt16LE(offset + 0x58),
  };
}

/** gPlayerPartyCount (1 byte) + 3 de relleno + gPlayerParty (6 × 100). */
export const PARTY_READ_LENGTH = 3 + PARTY_SIZE * PARTY_MON_SIZE;

export function parseParty(buf: Buffer): PartyMon[] {
  const count = Math.min(buf[0], PARTY_SIZE);
  const out: PartyMon[] = [];
  for (let i = 0; i < count; i++) {
    const mon = parsePartyMon(buf, 3 + i * PARTY_MON_SIZE);
    if (mon) out.push(mon);
  }
  return out;
}

export interface StorageBox {
  name: string;
  /** Fondo de la caja (WALLPAPER_* del juego). */
  wallpaper: number;
  /** 30 huecos; null si están vacíos. */
  mons: (BoxMon | null)[];
}

export function parseStorage(buf: Buffer): { currentBox: number; boxes: StorageBox[] } {
  const boxes: StorageBox[] = [];
  for (let b = 0; b < BOXES; b++) {
    const mons: (BoxMon | null)[] = [];
    for (let s = 0; s < BOX_CAPACITY; s++) {
      mons.push(parseBoxMon(buf, STORAGE_BOXES_OFFSET + (b * BOX_CAPACITY + s) * BOX_MON_SIZE));
    }
    const nameAt = STORAGE_NAMES_OFFSET + b * 9;
    boxes.push({
      name: decodeText(buf.subarray(nameAt, nameAt + 9)) || `CAJA ${b + 1}`,
      wallpaper: buf[STORAGE_WALLPAPERS_OFFSET + b] ?? 0,
      mons,
    });
  }
  return { currentBox: Math.min(buf[0], BOXES - 1), boxes };
}

// ── Partida: mochila, dinero, medallas y Pokédex ─────────────────────────────

export interface BagItem {
  id: number;
  quantity: number;
}

/**
 * Bolsillos de la mochila a partir de SaveBlock1[0x490..0x848]. Las cantidades
 * y el dinero están cifrados con la clave de SaveBlock2 (16 y 32 bits).
 */
export function parseBag(sb1: Buffer, key: number): { money: number; pockets: Record<PocketId, BagItem[]> } {
  const pockets = {} as Record<PocketId, BagItem[]>;
  for (const p of POCKETS) {
    const items: BagItem[] = [];
    for (let i = 0; i < p.slots; i++) {
      const at = p.offset - SAVE.sb1BagStart + i * 4;
      const id = sb1.readUInt16LE(at);
      if (id === 0) continue;
      items.push({ id, quantity: (sb1.readUInt16LE(at + 2) ^ key) & 0xffff });
    }
    pockets[p.id] = items;
  }
  const money = (sb1.readUInt32LE(SAVE.money - SAVE.sb1BagStart) ^ key) >>> 0;
  return { money, pockets };
}

/** Las 8 medallas a partir de los 2 bytes de banderas que las contienen. */
export function parseBadges(flags: Buffer): boolean[] {
  return HOENN_BADGES.map((_, i) => {
    const flag = SAVE.badgeFlag + i;
    const byte = (flag >> 3) - (SAVE.badgeFlag >> 3);
    return (flags[byte] & (1 << (flag & 7))) !== 0;
  });
}
export const BADGE_BYTES_OFFSET = SAVE.flags + (SAVE.badgeFlag >> 3);

/** Pokédex de la partida: conjuntos de números nacionales vistos y capturados. */
export function parsePokedex(sb2: Buffer): { seen: Set<number>; owned: Set<number> } {
  const read = (offset: number) => {
    const set = new Set<number>();
    const base = offset - SAVE.sb2Start;
    for (let n = 1; n <= 386; n++) {
      if (sb2[base + ((n - 1) >> 3)] & (1 << ((n - 1) & 7))) set.add(n);
    }
    return set;
  };
  return { seen: read(SAVE.pokedexSeen), owned: read(SAVE.pokedexOwned) };
}

export function parsePlayer(sb2: Buffer): { name: string; gender: 'male' | 'female' } {
  const at = SAVE.playerName - SAVE.sb2Start;
  return {
    name: decodeText(sb2.subarray(at, at + 8)),
    gender: sb2[SAVE.playerGender - SAVE.sb2Start] === 1 ? 'female' : 'male',
  };
}

/** Bordes que el juego añade al mapa en gBackupMapLayout (MAP_OFFSET_W y MAP_OFFSET_H). */
const MAP_BORDER_W = 15;
const MAP_BORDER_H = 14;

/**
 * Ubicación del jugador: posición en el mapa (SaveBlock1, 0x00), zona y tipo de
 * mapa (gMapHeader + 0x14) y tamaño del mapa (gBackupMapLayout).
 */
export function parseLocation(pos: Buffer, header: Buffer, layout: Buffer) {
  return {
    x: pos.readInt16LE(0),
    y: pos.readInt16LE(2),
    mapsec: header[0],
    mapType: header[3],
    width: Math.max(0, layout.readInt32LE(0) - MAP_BORDER_W),
    height: Math.max(0, layout.readInt32LE(4) - MAP_BORDER_H),
  };
}

export function encryptionKey(sb2: Buffer): number {
  return sb2.readUInt32LE(SAVE.encryptionKey - SAVE.sb2Start);
}
