import type { RawLocation } from '../shared/hoennMap.js';
import type { AutoDetectProfile, PocketId } from '../shared/types.js';
import {
  BADGE_BYTES_OFFSET,
  PARTY_READ_LENGTH,
  SAVE,
  STORAGE_LENGTH,
  encryptionKey,
  parseBadges,
  parseBag,
  parseLocation,
  parseParty,
  parsePlayer,
  parsePokedex,
  parseStorage,
  type BagItem,
  type PartyMon,
  type StorageBox,
} from './gen3save.js';
import { MemoryReadError, type MemoryReader } from './retroarch.js';

/** Ubicación del jugador (minimapa): cada 0,5 s (≈30 bytes en 4 consultas). */
export const LOCATION_EVERY_MS = 500;
/** Equipo: cada 2 s (≈600 bytes). */
export const PARTY_EVERY_MS = 2000;
/** Mochila, dinero, medallas y Pokédex: cada 5 s (≈1,1 KB en 4 consultas). */
export const SAVE_EVERY_MS = 5000;
/** El PC (≈33 KB) se lee cuando se pide, en bloques de este tamaño. */
export const CHUNK = 2048;
/** Con el overlay /pc fijo en pantalla, el PC se relee solo cada 30 s. */
export const PC_EVERY_MS = 30000;

export interface RawGame {
  player: { name: string; gender: 'male' | 'female' } | null;
  party: PartyMon[] | null;
  badges: boolean[] | null;
  money: number | null;
  pockets: Record<PocketId, BagItem[]> | null;
  seen: Set<number> | null;
  owned: Set<number> | null;
  storage: { currentBox: number; boxes: StorageBox[]; readAt: number } | null;
}

const emptyGame = (): RawGame => ({
  player: null,
  party: null,
  badges: null,
  money: null,
  pockets: null,
  seen: null,
  owned: null,
  storage: null,
});

/** Los bloques de la partida viven en la EWRAM (0x02000000–0x0203FFFF). */
const inEwram = (p: number, length: number) => p >= 0x02000000 && p + length <= 0x02040000;

/**
 * Lee los datos de la partida (equipo, mochila, medallas, Pokédex y PC) de
 * forma escalonada para no cargar RetroArch. Los fallos de lectura de una parte
 * (p. ej. punteros a medio actualizar al cambiar de mapa) solo se saltan esa parte.
 */
export class GameWatcher {
  raw: RawGame = emptyGame();
  private lastParty = -Infinity;
  private lastLocation = -Infinity;
  private locationSignature = '';
  private lastSave = -Infinity;
  private pcRequested = false;
  private lastPc = -Infinity;
  private wasInBattle = false;
  private signature = '';

  constructor(
    private map: AutoDetectProfile,
    private onChange: (raw: RawGame) => void,
    /** La ubicación va aparte: cambia a menudo y es pequeña. */
    private onLocation: (loc: RawLocation | null) => void = () => {},
  ) {}

  requestPc() {
    this.pcRequested = true;
  }

  /**
   * Especies que el jugador no había visto antes de este combate. La Pokédex
   * no se relee durante el combate (el juego marca al rival como visto al
   * empezar), así que se compara con la lectura anterior al combate.
   */
  newSpecies(species: number[]): number[] {
    const seen = this.raw.seen;
    if (!seen) return [];
    const fresh = species.filter((s) => !seen.has(s));
    for (const s of species) seen.add(s);
    return [...new Set(fresh)];
  }

  /** autoPc: releer el PC periódicamente (overlay /pc fijo). */
  async tick(reader: MemoryReader, inBattle: boolean, now: number, autoPc = false) {
    // Al terminar un combate se relee enseguida la Pokédex (para el siguiente).
    if (this.wasInBattle && !inBattle) this.lastSave = -Infinity;
    this.wasInBattle = inBattle;
    if (now - this.lastLocation >= LOCATION_EVERY_MS) {
      this.lastLocation = now;
      await this.part(() => this.readLocation(reader));
      return;
    }
    if (now - this.lastParty >= PARTY_EVERY_MS) {
      this.lastParty = now;
      await this.part(async () => {
        this.raw.party = parseParty(await reader.read(this.map.party, PARTY_READ_LENGTH));
      });
    } else if (now - this.lastSave >= SAVE_EVERY_MS) {
      this.lastSave = now;
      await this.part(() => this.readSave(reader, inBattle));
    } else if (this.pcRequested || (autoPc && now - this.lastPc >= PC_EVERY_MS)) {
      this.pcRequested = false;
      this.lastPc = now;
      await this.part(() => this.readStorage(reader, now));
    } else {
      return; // en esta vuelta no se ha leído nada de la partida
    }
    this.emitIfChanged();
  }

  private async pointers(reader: MemoryReader) {
    const p = await reader.read(this.map.saveBlockPointers, 12);
    return { sb1: p.readUInt32LE(0), sb2: p.readUInt32LE(4), storage: p.readUInt32LE(8) };
  }

  private async readSave(reader: MemoryReader, inBattle: boolean) {
    const { sb1, sb2 } = await this.pointers(reader);
    if (!inEwram(sb1, 0x3d88) || !inEwram(sb2, 0xf2c)) return;
    const save2 = await reader.read(sb2 + SAVE.sb2Start, SAVE.sb2Length);
    const key = encryptionKey(save2);
    this.raw.player = parsePlayer(save2);
    if (!inBattle) {
      const dex = parsePokedex(save2);
      this.raw.seen = dex.seen;
      this.raw.owned = dex.owned;
    }
    this.raw.badges = parseBadges(await reader.read(sb1 + BADGE_BYTES_OFFSET, 2));
    const bag = parseBag(await reader.read(sb1 + SAVE.sb1BagStart, SAVE.sb1BagLength), key);
    this.raw.money = bag.money;
    this.raw.pockets = bag.pockets;
  }

  private async readLocation(reader: MemoryReader) {
    const { sb1 } = await this.pointers(reader);
    if (!inEwram(sb1, 0x3d88)) return;
    const loc = parseLocation(
      await reader.read(sb1, 4),
      await reader.read(this.map.mapHeader + 0x14, 4),
      await reader.read(this.map.backupMapLayout, 8),
    );
    const sig = JSON.stringify(loc);
    if (sig === this.locationSignature) return;
    this.locationSignature = sig;
    this.onLocation(loc);
  }

  private async readStorage(reader: MemoryReader, now: number) {
    const { storage } = await this.pointers(reader);
    if (!inEwram(storage, STORAGE_LENGTH)) return;
    const parts: Buffer[] = [];
    for (let at = 0; at < STORAGE_LENGTH; at += CHUNK) {
      parts.push(await reader.read(storage + at, Math.min(CHUNK, STORAGE_LENGTH - at)));
    }
    this.raw.storage = { ...parseStorage(Buffer.concat(parts)), readAt: now };
  }

  private async part(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof MemoryReadError)) throw err;
    }
  }

  private emitIfChanged() {
    const sig = JSON.stringify(this.raw, (_k, v) => (v instanceof Set ? [...v] : v));
    if (sig === this.signature) return;
    this.signature = sig;
    this.onChange(this.raw);
  }
}
