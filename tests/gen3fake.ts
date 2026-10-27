// Memoria simulada de Pokémon Esmeralda para las pruebas y la comprobación visual:
// equipo, partida (mochila, medallas, Pokédex), PC y combate, con el mismo
// cifrado y las mismas posiciones que el juego.
import { BATTLE_MON_SIZE, gen3ToNational } from '../src/server/gen3.js';
import {
  BOX_CAPACITY,
  BOX_MON_SIZE,
  PARTY_MON_SIZE,
  POCKETS,
  SAVE,
  STORAGE_BOXES_OFFSET,
  STORAGE_NAMES_OFFSET,
  STORAGE_WALLPAPERS_OFFSET,
  encodeText,
} from '../src/server/gen3save.js';

export const ADDR = {
  inBattle: 0x030026f9,
  battleTypeFlags: 0x02022fec,
  battleMons: 0x02024084,
  party: 0x020244e9,
  pointers: 0x03005d8c,
  mapHeader: 0x02037318,
  backupMapLayout: 0x03005dc0,
  gameCode: 0x080000ac,
  /** Posiciones típicas de los bloques de la partida (en el juego se desplazan). */
  sb2: 0x02024a54,
  sb1: 0x02025a00,
  storage: 0x02029808,
};

const ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
];

export function internalOf(national: number): number {
  for (let i = 1; i <= 411; i++) if (gen3ToNational(i) === national) return i;
  throw new Error(`sin índice interno para ${national}`);
}

export interface FakeMon {
  species: number;
  nickname?: string;
  personality?: number;
  otId?: number;
  experience?: number;
  heldItem?: number;
  isEgg?: boolean;
  /** Poké Ball de captura (4 = Poké Ball por defecto). */
  ball?: number;
  level?: number;
  hp?: number;
  maxHp?: number;
  status?: number;
}

export function encodeBoxMon(m: FakeMon): Buffer {
  const buf = Buffer.alloc(BOX_MON_SIZE);
  const personality = m.personality ?? 0x12345678;
  const otId = m.otId ?? 0x0badcafe;
  buf.writeUInt32LE(personality >>> 0, 0);
  buf.writeUInt32LE(otId >>> 0, 4);
  encodeText(m.nickname ?? '', 10).copy(buf, 8);
  buf[0x12] = 7; // idioma: español
  buf[0x13] = 0x02 | (m.isEgg ? 0x04 : 0);
  const data = Buffer.alloc(48);
  const order = ORDERS[(personality >>> 0) % 24];
  const g = order.indexOf('G') * 12;
  const misc = order.indexOf('M') * 12;
  data.writeUInt16LE(internalOf(m.species), g);
  data.writeUInt16LE(m.heldItem ?? 0, g + 2);
  data.writeUInt32LE(m.experience ?? 0, g + 4);
  data.writeUInt16LE((m.ball ?? 4) << 11, misc + 2);
  data.writeUInt32LE(m.isEgg ? 0x40000000 : 0, misc + 4);
  let sum = 0;
  for (let i = 0; i < 48; i += 2) sum = (sum + data.readUInt16LE(i)) & 0xffff;
  buf.writeUInt16LE(sum, 0x1c);
  const key = (personality ^ otId) >>> 0;
  for (let i = 0; i < 48; i += 4) buf.writeUInt32LE((data.readUInt32LE(i) ^ key) >>> 0, 0x20 + i);
  return buf;
}

export function encodePartyMon(m: FakeMon): Buffer {
  const buf = Buffer.alloc(PARTY_MON_SIZE);
  encodeBoxMon(m).copy(buf, 0);
  buf.writeUInt32LE(m.status ?? 0, 0x50);
  buf[0x54] = m.level ?? 5;
  buf.writeUInt16LE(m.hp ?? 20, 0x56);
  buf.writeUInt16LE(m.maxHp ?? 20, 0x58);
  return buf;
}

export interface FakeGame {
  player?: { name: string; gender: 'male' | 'female' };
  /** Ubicación: zona del mapa, tipo de mapa, posición y tamaño del mapa en casillas. */
  location?: { mapsec: number; mapType: number; x: number; y: number; width: number; height: number };
  party?: FakeMon[];
  badges?: number;
  money?: number;
  encryptionKey?: number;
  pockets?: Partial<Record<(typeof POCKETS)[number]['id'], Array<[number, number]>>>;
  seen?: number[];
  owned?: number[];
  boxes?: Array<{ name?: string; wallpaper?: number; mons: Array<FakeMon | null> }>;
  currentBox?: number;
  battle?: { typeFlags: number; rivals: Array<FakeMon | null> };
}

/** Memoria byte a byte (solo las zonas escritas; el resto se lee como 0). */
export class FakeMemory {
  bytes = new Map<number, number>();

  write(address: number, buf: Buffer) {
    buf.forEach((v, i) => this.bytes.set(address + i, v));
  }

  read(address: number, length: number): Buffer {
    return Buffer.from(Array.from({ length }, (_, i) => this.bytes.get(address + i) ?? 0));
  }

  load(game: FakeGame) {
    this.bytes.clear();
    this.write(ADDR.gameCode, Buffer.from('BPES', 'latin1'));
    const ptrs = Buffer.alloc(12);
    ptrs.writeUInt32LE(ADDR.sb1, 0);
    ptrs.writeUInt32LE(ADDR.sb2, 4);
    ptrs.writeUInt32LE(ADDR.storage, 8);
    this.write(ADDR.pointers, ptrs);

    const party = game.party ?? [];
    this.write(ADDR.party, Buffer.from([party.length, 0, 0]));
    party.forEach((m, i) => this.write(ADDR.party + 3 + i * PARTY_MON_SIZE, encodePartyMon(m)));

    const key = game.encryptionKey ?? 0x1234abcd;
    const sb2 = Buffer.alloc(0xb0);
    const setFlags = (offset: number, list: number[]) => {
      for (const n of list) sb2[offset + ((n - 1) >> 3)] |= 1 << ((n - 1) & 7);
    };
    setFlags(SAVE.pokedexSeen, game.seen ?? []);
    setFlags(SAVE.pokedexOwned, game.owned ?? []);
    sb2.writeUInt32LE(key >>> 0, SAVE.encryptionKey);
    encodeText(game.player?.name ?? 'ALEX', 8).copy(sb2, SAVE.playerName);
    sb2[SAVE.playerGender] = game.player?.gender === 'female' ? 1 : 0;
    this.write(ADDR.sb2, sb2);
    if (game.location) this.setLocation(game.location);

    const badges = Buffer.alloc(2);
    for (let i = 0; i < (game.badges ?? 0); i++) {
      const flag = SAVE.badgeFlag + i;
      badges[(flag >> 3) - (SAVE.badgeFlag >> 3)] |= 1 << (flag & 7);
    }
    this.write(ADDR.sb1 + SAVE.flags + (SAVE.badgeFlag >> 3), badges);

    const bag = Buffer.alloc(SAVE.sb1BagLength);
    bag.writeUInt32LE(((game.money ?? 0) ^ key) >>> 0, 0);
    for (const p of POCKETS) {
      (game.pockets?.[p.id] ?? []).forEach(([id, qty], i) => {
        const at = p.offset - SAVE.sb1BagStart + i * 4;
        bag.writeUInt16LE(id, at);
        bag.writeUInt16LE((qty ^ key) & 0xffff, at + 2);
      });
    }
    this.write(ADDR.sb1 + SAVE.sb1BagStart, bag);

    const storage = Buffer.alloc(STORAGE_WALLPAPERS_OFFSET + 14);
    storage[0] = game.currentBox ?? 0;
    for (let b = 0; b < 14; b++) {
      const box = game.boxes?.[b];
      encodeText(box?.name ?? `CAJA ${b + 1}`, 9).copy(storage, STORAGE_NAMES_OFFSET + b * 9);
      storage[STORAGE_WALLPAPERS_OFFSET + b] = box?.wallpaper ?? b % 4; // el juego empieza con bosque, ciudad, desierto y sabana
      box?.mons.forEach((m, s) => {
        if (m) encodeBoxMon(m).copy(storage, STORAGE_BOXES_OFFSET + (b * BOX_CAPACITY + s) * BOX_MON_SIZE);
      });
    }
    this.write(ADDR.storage, storage);

    if (game.battle) this.setBattle(game.battle.typeFlags, game.battle.rivals);
  }

  setBattle(typeFlags: number, rivals: Array<FakeMon | null>) {
    this.bytes.set(ADDR.inBattle, 0x02);
    const flags = Buffer.alloc(4);
    flags.writeUInt32LE(typeFlags >>> 0);
    this.write(ADDR.battleTypeFlags, flags);
    const put = (slot: number, m: FakeMon) => {
      const b = Buffer.alloc(BATTLE_MON_SIZE);
      b.writeUInt16LE(internalOf(m.species), 0);
      b.writeUInt16LE(m.hp ?? 20, 0x28);
      b[0x2a] = m.level ?? 5;
      b.writeUInt16LE(m.maxHp ?? 20, 0x2c);
      b.writeUInt32LE((m.personality ?? 1) >>> 0, 0x48);
      this.write(ADDR.battleMons + slot * BATTLE_MON_SIZE, b);
    };
    put(0, { species: 252, personality: 1 });
    rivals.forEach((r, i) => r && put(i === 0 ? 1 : 3, r));
  }

  /** Mueve al jugador (como haría el juego al andar o cambiar de mapa). */
  setLocation(loc: NonNullable<FakeGame['location']>) {
    const pos = Buffer.alloc(4);
    pos.writeInt16LE(loc.x, 0);
    pos.writeInt16LE(loc.y, 2);
    this.write(ADDR.sb1, pos);
    this.write(ADDR.mapHeader + 0x14, Buffer.from([loc.mapsec, 0, 0, loc.mapType]));
    const layout = Buffer.alloc(8);
    layout.writeInt32LE(loc.width + 15, 0);
    layout.writeInt32LE(loc.height + 14, 4);
    this.write(ADDR.backupMapLayout, layout);
  }

  endBattle() {
    this.bytes.delete(ADDR.inBattle);
  }

  /** Marca una especie como vista en la Pokédex, como hace el juego al empezar un combate. */
  markSeen(national: number) {
    const at = ADDR.sb2 + SAVE.pokedexSeen + ((national - 1) >> 3);
    this.bytes.set(at, (this.bytes.get(at) ?? 0) | (1 << ((national - 1) & 7)));
  }
}
