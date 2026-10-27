import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/server/app.js';
import { AutoDetector } from '../src/server/autoDetect.js';
import { GameWatcher, PARTY_EVERY_MS, SAVE_EVERY_MS, type RawGame } from '../src/server/gameWatch.js';
import { BATTLE_TYPE_TRAINER } from '../src/server/gen3.js';
import {
  decodeText,
  encodeText,
  isShiny,
  parseBadges,
  parseBag,
  parseBoxMon,
  parseParty,
  parsePokedex,
  parseStorage,
  PARTY_READ_LENGTH,
  SAVE,
  STORAGE_LENGTH,
} from '../src/server/gen3save.js';
import { CSV_BASE, ItemCatalog } from '../src/server/items.js';
import { SpriteCache } from '../src/server/pokeapi.js';
import { loadProfiles } from '../src/server/profiles.js';
import { NoResponseError, type MemoryReader } from '../src/server/retroarch.js';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/server/settings.js';
import { expForLevel, levelFromExp } from '../src/shared/growth.js';
import { HOENN_SECTIONS, mapSection, regionPosition, type RawLocation } from '../src/shared/hoennMap.js';
import type { ServerMessage, Settings } from '../src/shared/types.js';
import { ADDR, encodeBoxMon, encodePartyMon, FakeMemory, type FakeGame } from './gen3fake.js';
import { FakeClock, ROOT, makeService } from './helpers.js';

const emerald = loadProfiles(path.join(ROOT, 'profiles')).find((p) => p.id === 'emerald')!;

class MemoryReaderFake implements MemoryReader {
  reads: Array<[number, number]> = [];
  down = false;
  constructor(public mem: FakeMemory) {}
  async version() {
    if (this.down) throw new NoResponseError('sin respuesta');
    return '1.21.0';
  }
  async status() {
    if (this.down) throw new NoResponseError('sin respuesta');
    return 'PLAYING game_gba,Pokemon - Edicion Esmeralda (Spain)';
  }
  async read(address: number, length: number) {
    if (this.down) throw new NoResponseError('sin respuesta');
    this.reads.push([address, length]);
    return this.mem.read(address, length);
  }
  close() {}
  takeStats() {
    return { queries: this.reads.length, latencyMs: 0 };
  }
}

const GAME: FakeGame = {
  player: { name: 'Bruno', gender: 'male' },
  location: { mapsec: 19, mapType: 3, x: 10, y: 40, width: 30, height: 80 }, // Ruta 104
  party: [
    { species: 265, nickname: 'Gusanito', level: 36, hp: 98, maxHp: 120, experience: 45000, personality: 7 },
    { species: 263, nickname: 'ZIGZAGOON', level: 12, hp: 0, maxHp: 34, personality: 0x81234567, status: 0 },
    { species: 280, nickname: 'Ralts', level: 9, hp: 20, maxHp: 25, status: 0x08, otId: 0, personality: 3 },
    { species: 1, isEgg: true, personality: 23 },
  ],
  badges: 3,
  money: 12345,
  pockets: { items: [[13, 5], [20, 1]], balls: [[4, 10]], key: [[259, 1]] },
  seen: [252, 253, 263, 265, 280],
  owned: [252, 263, 265],
  boxes: [{ name: 'Favoritos', mons: [{ species: 25, nickname: 'PIKACHU', experience: 1000 }, null, { species: 133, nickname: 'EEVEE', experience: 125 }] }],
  currentBox: 0,
};

describe('Gen III: texto', () => {
  it('codifica y descodifica con acentos, eñes y símbolos', () => {
    for (const t of ['Pequeñín', 'ÑANDÚ', '¿Qué?', 'NIDORAN♂', 'Pokémon 25', 'Ácido']) {
      expect(decodeText(encodeText(t, 12))).toBe(t);
    }
  });

  it('se detiene en el terminador 0xFF', () => {
    expect(decodeText(Buffer.from([0xbb, 0xbc, 0xff, 0xbd]))).toBe('AB');
  });
});

describe('Gen III: Pokémon cifrados', () => {
  it('descifra las 24 ordenaciones de subestructuras', () => {
    for (let p = 0; p < 24; p++) {
      const mon = parseBoxMon(encodeBoxMon({ species: 280 + (p % 3), nickname: 'X', personality: p, experience: 1000 + p, heldItem: 13 }));
      expect(mon).toMatchObject({ species: 280 + (p % 3), nickname: 'X', experience: 1000 + p, heldItem: 13, isEgg: false });
    }
  });

  it('reconoce huevos y Pokémon variocolor', () => {
    expect(parseBoxMon(encodeBoxMon({ species: 25, isEgg: true }))).toMatchObject({ isEgg: true, nickname: 'Huevo' });
    expect(isShiny(0x00000000, 0x00000000)).toBe(true);
    expect(isShiny(0x12345678, 0x0badcafe)).toBe(false);
  });

  it('descarta huecos vacíos y datos corruptos (suma de comprobación)', () => {
    expect(parseBoxMon(Buffer.alloc(80))).toBeNull();
    const bad = encodeBoxMon({ species: 25 });
    bad[0x30] ^= 0xff;
    expect(parseBoxMon(bad)).toBeNull();
  });

  it('lee el equipo con nivel, PS y estado', () => {
    const mem = new FakeMemory();
    mem.load(GAME);
    const party = parseParty(mem.read(ADDR.party, PARTY_READ_LENGTH));
    expect(party.map((m) => [m.species, m.nickname, m.level, m.hp, m.maxHp])).toEqual([
      [265, 'Gusanito', 36, 98, 120],
      [263, 'ZIGZAGOON', 12, 0, 34],
      [280, 'Ralts', 9, 20, 25],
      [1, 'Huevo', 5, 20, 20],
    ]);
    expect(party[2].status).toBe(0x08);
    expect(party[3].isEgg).toBe(true);
  });

  it('el PC: nombres de caja y Pokémon por hueco', () => {
    const mem = new FakeMemory();
    mem.load(GAME);
    const st = parseStorage(mem.read(ADDR.storage, STORAGE_LENGTH));
    expect(st.boxes).toHaveLength(14);
    expect(st.boxes[0].name).toBe('Favoritos');
    expect(st.boxes[1].name).toBe('CAJA 2');
    expect(st.boxes[0].mons[0]).toMatchObject({ species: 25, nickname: 'PIKACHU', experience: 1000 });
    expect(st.boxes[0].mons[1]).toBeNull();
    expect(st.boxes[0].mons[2]?.species).toBe(133);
  });
});

describe('Gen III: partida', () => {
  const mem = new FakeMemory();
  mem.load(GAME);
  const sb2 = mem.read(ADDR.sb2 + SAVE.sb2Start, SAVE.sb2Length);
  const key = sb2.readUInt32LE(SAVE.encryptionKey - SAVE.sb2Start);

  it('mochila y dinero, descifrados con la clave de la partida', () => {
    const bag = parseBag(mem.read(ADDR.sb1 + SAVE.sb1BagStart, SAVE.sb1BagLength), key);
    expect(bag.money).toBe(12345);
    expect(bag.pockets.items).toEqual([
      { id: 13, quantity: 5 },
      { id: 20, quantity: 1 },
    ]);
    expect(bag.pockets.balls).toEqual([{ id: 4, quantity: 10 }]);
    expect(bag.pockets.key).toEqual([{ id: 259, quantity: 1 }]);
    expect(bag.pockets.berries).toEqual([]);
  });

  it('medallas', () => {
    const flags = mem.read(ADDR.sb1 + SAVE.flags + (SAVE.badgeFlag >> 3), 2);
    expect(parseBadges(flags)).toEqual([true, true, true, false, false, false, false, false]);
  });

  it('Pokédex: vistos y capturados', () => {
    const dex = parsePokedex(sb2);
    expect([...dex.seen]).toEqual([252, 253, 263, 265, 280]);
    expect([...dex.owned]).toEqual([252, 263, 265]);
  });
});

describe('Nivel a partir de la experiencia', () => {
  it('coincide con las tablas oficiales en el nivel 100', () => {
    expect(expForLevel('fast', 100)).toBe(800000);
    expect(expForLevel('medium', 100)).toBe(1000000);
    expect(expForLevel('medium-slow', 100)).toBe(1059860);
    expect(expForLevel('slow', 100)).toBe(1250000);
    expect(expForLevel('slow-then-very-fast', 100)).toBe(600000);
    expect(expForLevel('fast-then-very-slow', 100)).toBe(1640000);
  });

  it('calcula el nivel', () => {
    expect(levelFromExp('medium', 1000)).toBe(10);
    expect(levelFromExp('medium', 999)).toBe(9);
    expect(levelFromExp('medium-slow', 135)).toBe(5);
    expect(levelFromExp('medium-slow', 0)).toBe(1);
    expect(levelFromExp('slow', 2_000_000)).toBe(100);
  });
});

describe('GameWatcher', () => {
  function setup(game: FakeGame = GAME) {
    const mem = new FakeMemory();
    mem.load(game);
    const reader = new MemoryReaderFake(mem);
    const changes: RawGame[] = [];
    const watcher = new GameWatcher(emerald.autoDetect!, (raw) => changes.push(raw));
    return { mem, reader, watcher, changes };
  }
  /** Primeras vueltas: ubicación, equipo, ubicación y partida. */
  async function prime(t: ReturnType<typeof setup>) {
    for (const now of [0, 250, 500, 750]) await t.watcher.tick(t.reader, false, now);
  }

  it('reparte las lecturas: ubicación, equipo, partida; el PC solo si se pide', async () => {
    const t = setup();
    await t.watcher.tick(t.reader, false, 0);
    expect(t.reader.reads.length).toBe(4); // punteros, posición, cabecera del mapa, tamaño del mapa
    t.reader.reads = [];
    await t.watcher.tick(t.reader, false, 250);
    expect(t.reader.reads).toEqual([[ADDR.party, PARTY_READ_LENGTH]]);
    t.reader.reads = [];
    await t.watcher.tick(t.reader, false, 500);
    expect(t.reader.reads.length).toBe(4); // ubicación otra vez (cada 0,5 s)
    t.reader.reads = [];
    await t.watcher.tick(t.reader, false, 750);
    expect(t.reader.reads.length).toBe(4); // punteros, SaveBlock2, medallas, mochila
    t.reader.reads = [];
    await t.watcher.tick(t.reader, false, 900);
    expect(t.reader.reads).toEqual([]); // nada pendiente
    t.watcher.requestPc();
    await t.watcher.tick(t.reader, false, 950);
    expect(t.reader.reads.length).toBe(1 + Math.ceil(STORAGE_LENGTH / 2048));
    expect(t.watcher.raw.storage?.boxes[0].name).toBe('Favoritos');
    expect(t.watcher.raw.party?.length).toBe(4);
    expect(t.watcher.raw.badges?.filter(Boolean)).toHaveLength(3);
    expect(t.watcher.raw.money).toBe(12345);
  });

  it('con el overlay /pc fijo, relee el PC cada 30 s; si no, nunca por su cuenta', async () => {
    const t = setup();
    const pcReads = () => t.reader.reads.filter(([a]) => a >= ADDR.storage && a < ADDR.storage + STORAGE_LENGTH).length;
    for (let now = 0; now < 70000; now += 250) await t.watcher.tick(t.reader, false, now, false);
    expect(pcReads()).toBe(0);
    for (let now = 70000; now < 140000; now += 250) await t.watcher.tick(t.reader, false, now, true);
    expect(pcReads()).toBe(3 * Math.ceil(STORAGE_LENGTH / 2048)); // a los 0, 30 y 60 s
  });

  it('solo avisa cuando cambian los datos', async () => {
    const t = setup();
    await prime(t);
    const n = t.changes.length;
    for (let now = 1000; now < SAVE_EVERY_MS + 1000; now += 250) await t.watcher.tick(t.reader, false, now);
    expect(t.changes.length).toBe(n);
    t.mem.load({ ...GAME, money: 99 });
    // En cada vuelta se lee una sola parte; en 5 s seguro que toca la partida.
    for (let now = SAVE_EVERY_MS + 1000; now < 2 * SAVE_EVERY_MS + 1000; now += 250) await t.watcher.tick(t.reader, false, now);
    expect(t.changes.length).toBe(n + 1);
    expect(t.watcher.raw.money).toBe(99);
  });

  it('«¡Nuevo!»: compara con la Pokédex de antes del combate, una sola vez por especie', async () => {
    const t = setup();
    await prime(t);
    expect(t.watcher.newSpecies([263])).toEqual([]); // ya visto
    expect(t.watcher.newSpecies([25, 263])).toEqual([25]);
    expect(t.watcher.newSpecies([25])).toEqual([]); // ya contado en este combate
  });

  it('no relee la Pokédex durante el combate (el juego marca al rival como visto al empezar)', async () => {
    const t = setup();
    await prime(t);
    t.mem.load({ ...GAME, seen: [...GAME.seen!, 270] }); // el juego marca a Lotad como visto
    for (let now = 1000; now < SAVE_EVERY_MS + 1500; now += 250) await t.watcher.tick(t.reader, true, now);
    expect(t.watcher.newSpecies([270])).toEqual([270]);
  });

  it('ignora punteros fuera de la EWRAM (cambio de mapa a medias)', async () => {
    const t = setup();
    const bad = Buffer.alloc(12, 0xff);
    t.mem.write(ADDR.pointers, bad);
    await prime(t);
    expect(t.watcher.raw.badges).toBeNull();
    expect(t.watcher.raw.party?.length).toBe(4);
  });
});

describe('Minimapa: ubicación del jugador', () => {
  it('lee la zona, la posición y el tamaño del mapa, y el nombre y sexo del jugador', async () => {
    const mem = new FakeMemory();
    mem.load(GAME);
    const reader = new MemoryReaderFake(mem);
    const locs: Array<RawLocation | null> = [];
    const watcher = new GameWatcher(emerald.autoDetect!, () => {}, (l) => locs.push(l));
    for (const now of [0, 250, 500, 750]) await watcher.tick(reader, false, now);
    expect(locs).toEqual([{ mapsec: 19, mapType: 3, x: 10, y: 40, width: 30, height: 80 }]); // sin cambios: un solo aviso
    expect(watcher.raw.player).toEqual({ name: 'Bruno', gender: 'male' });
    mem.setLocation({ mapsec: 10, mapType: 2, x: 5, y: 7, width: 40, height: 60 });
    await watcher.tick(reader, false, 1000);
    expect(locs.at(-1)).toMatchObject({ mapsec: 10, x: 5, y: 7 });
  });

  it('posición en el mapa de Hoenn: continua en exteriores, centro de la zona en interiores', () => {
    // Ruta 104: casillas (0, 7) a (1, 10) del mapa de Hoenn
    expect(regionPosition({ mapsec: 19, mapType: 3, x: 14.5, y: 39.5, width: 30, height: 80 })).toEqual({ x: 0.5, y: 8.5 });
    expect(regionPosition({ mapsec: 19, mapType: 3, x: 0, y: 0, width: 30, height: 80 })!.y).toBeCloseTo(7.019, 3);
    // Gimnasio de Petalia (interior): centro de Ciudad Petalia (1, 9)
    expect(regionPosition({ mapsec: 7, mapType: 8, x: 3, y: 3, width: 10, height: 10 })).toEqual({ x: 1.5, y: 9.5 });
    // Zona sin sitio en el mapa de Hoenn (p. ej. Kanto)
    expect(regionPosition({ mapsec: 88, mapType: 1, x: 3, y: 3, width: 10, height: 10 })).toBeNull();
    expect(mapSection(0)?.name).toBe('VILLA RAÍZ');
    expect(HOENN_SECTIONS.every((s) => s.x + s.w <= 28 && s.y + s.h <= 15)).toBe(true);
  });
});

describe('AutoDetector + partida', () => {
  it('la detección indica qué especies son nuevas en la Pokédex', async () => {
    const mem = new FakeMemory();
    mem.load(GAME);
    const reader = new MemoryReaderFake(mem);
    const clock = new FakeClock();
    const detections: Array<[number[], number[]]> = [];
    const games: Array<RawGame | null> = [];
    const settings: Settings = { ...DEFAULT_SETTINGS, gameId: 'emerald', auto: { ...DEFAULT_SETTINGS.auto, enabled: true } };
    const auto = new AutoDetector({
      settings: () => settings,
      profile: () => emerald,
      createReader: () => reader,
      onDetect: (d, _p, fresh) => detections.push([d.species, fresh]),
      onGame: (raw) => games.push(raw),
      onStatus: () => {},
      speciesNames: async (_g, s) => s.map(String),
      clock,
      usage: () => ({ cpuMicros: 0, rssBytes: 0 }),
    });
    const advance = async (ms: number) => {
      for (let t = 0; t < ms; t += 50) {
        await new Promise((r) => setImmediate(r));
        clock.advance(50);
      }
    };
    auto.reconfigure();
    await advance(1500);
    expect(games.at(-1)?.party?.length).toBe(4);
    mem.setBattle(BATTLE_TYPE_TRAINER, [{ species: 263, personality: 5 }]);
    await advance(1000);
    mem.endBattle();
    await advance(600);
    mem.setBattle(0, [{ species: 270, personality: 6 }]);
    await advance(1000);
    expect(detections).toEqual([
      [[263], []],
      [[270], [270]],
    ]);
    auto.stop();
    expect(games.at(-1)).toBeNull();
  });
});

describe('ItemCatalog', () => {
  it('nombres en español e iconos de la Gen III a partir de las tablas de PokéAPI', async () => {
    const csv: Record<string, string> = {
      'item_game_indices.csv': 'item_id,generation_id,game_index\n17,3,13\n17,4,17\n4,3,4\n',
      'item_names.csv': 'item_id,local_language_id,name\n17,9,Potion\n17,7,Poción\n4,7,Poké Ball\n',
      'items.csv': 'id,identifier,category_id,cost,fling_power,fling_effect_id\n17,potion,27,300,30,\n4,poke-ball,34,200,,\n',
    };
    const urls: string[] = [];
    const items = new ItemCatalog({
      getText: async (url) => {
        urls.push(url);
        return csv[url.slice(CSV_BASE.length)];
      },
    });
    expect(items.peek()).toBeNull();
    const map = await items.load();
    expect(map.get(13)).toEqual({
      name: 'Poción',
      icon: SpriteCache.localUrl('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/potion.png'),
    });
    expect(map.get(4)?.name).toBe('Poké Ball');
    expect(map.get(17)).toBeUndefined(); // el 17 es de la Gen IV
    await items.load();
    expect(urls).toHaveLength(3); // se descargan una sola vez
  });
});

describe('Integración: partida → panel y overlay del equipo', () => {
  it('envía equipo, medallas, mochila y PC, y enseña la mochila en el directo', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-game-'));
    const mem = new FakeMemory();
    mem.load(GAME);
    const reader = new MemoryReaderFake(mem);
    const clock = new FakeClock();
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dataDir, ['red', 'emerald']),
      publicDir: path.join(dataDir, 'public'),
      localOnly: true,
      createReader: () => reader,
      autoClock: clock,
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
    const open = async (role: string) => {
      const ws = new WebSocket(base);
      const inbox: ServerMessage[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'hello', role }));
      return { ws, inbox };
    };
    const until = async (pred: () => boolean) => {
      for (let i = 0; i < 200 && !pred(); i++) {
        await new Promise((r) => setTimeout(r, 5));
        clock.advance(100);
      }
      return pred();
    };
    try {
      const control = await open('control');
      const team = await open('team');
      control.ws.send(JSON.stringify({ type: 'settings', patch: { gameId: 'emerald', auto: { ...DEFAULT_SETTINGS.auto, enabled: true } } }));
      const lastGame = () => [...team.inbox].reverse().find((m) => m.type === 'game') as Extract<ServerMessage, { type: 'game' }> | undefined;
      expect(await until(() => !!lastGame()?.data.bag)).toBe(true);
      const data = lastGame()!.data;
      expect(data.game?.name).toBe('Pokémon Esmeralda');
      expect(data.party?.map((m) => m.nickname)).toEqual(['Gusanito', 'ZIGZAGOON', 'Ralts', 'Huevo']);
      expect(data.badges?.filter((b) => b.owned).map((b) => b.name)).toEqual(['Piedra', 'Puño', 'Dinamo']);
      expect(data.pokedex).toEqual({ seen: 5, owned: 3 });
      expect(data.money).toBe(12345);
      expect(data.bag?.find((p) => p.id === 'items')?.items.map((i) => i.quantity)).toEqual([5, 1]);
      // Nombres, sprites y ritmo de crecimiento de las especies (Wurmple está en los datos de prueba).
      const brief = () =>
        team.inbox.flatMap((m) => (m.type === 'species' ? m.entries : [])).find((e) => e.id === 265);
      expect(await until(() => !!brief())).toBe(true);
      expect(brief()).toMatchObject({ name: 'Wurmple', growthRate: 'medium' });
      expect(brief()!.sprite).toMatch(/generation-iii.*emerald/);

      // PC bajo demanda
      control.ws.send(JSON.stringify({ type: 'refreshPc' }));
      expect(await until(() => !!lastGame()?.data.pc)).toBe(true);
      expect(lastGame()!.data.pc!.boxes[0].name).toBe('Favoritos');

      // Mochila en el directo durante showcaseSec y luego se quita sola
      control.ws.send(JSON.stringify({ type: 'showcase', showcase: { kind: 'bag', pocket: 'items' } }));
      expect(await until(() => team.inbox.some((m) => m.type === 'showcase'))).toBe(true);
      expect(await until(() => team.inbox.some((m) => m.type === 'showcaseHide'))).toBe(true);

      // Datos no válidos: se rechazan
      control.ws.send(JSON.stringify({ type: 'showcase', showcase: { kind: 'pc', box: 99 } }));
      expect(await until(() => control.inbox.some((m) => m.type === 'error'))).toBe(true);

      // Rival que el jugador no había visto (Eevee) y otro que sí (Wurmple): solo el primero lleva «¡Nuevo!».
      const overlay = await open('overlay');
      const prepares = () => overlay.inbox.filter((m) => m.type === 'prepare') as Extract<ServerMessage, { type: 'prepare' }>[];
      mem.setBattle(0, [{ species: 133, personality: 77 }]);
      expect(await until(() => prepares().length === 1)).toBe(true);
      expect(prepares()[0].cards[0]).toMatchObject({ name: 'Eevee', isNew: true });
      mem.endBattle();
      await until(() => false); // fin del combate y relectura de la Pokédex
      mem.setBattle(0, [{ species: 265, personality: 78 }]);
      expect(await until(() => prepares().length === 2)).toBe(true);
      expect(prepares()[1].cards[0].name).toBe('Wurmple');
      expect(prepares()[1].cards[0].isNew).toBeUndefined();
      overlay.ws.close();
      control.ws.close();
      team.ws.close();
    } finally {
      app.server.close();
      app.auto.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Vista previa y partida de ejemplo', () => {
  it('la partida de ejemplo solo llega al panel y a la vista previa; la vista previa no cuenta como overlay de OBS', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-demo-'));
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dataDir, ['red', 'emerald']),
      publicDir: path.join(dataDir, 'public'),
      localOnly: true,
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
    const open = async (role: string, preview = false) => {
      const ws = new WebSocket(base);
      const inbox: ServerMessage[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'hello', role, preview }));
      return { ws, inbox };
    };
    const wait = async (pred: () => boolean) => {
      for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
      return pred();
    };
    const games = (c: { inbox: ServerMessage[] }) =>
      c.inbox.filter((m): m is Extract<ServerMessage, { type: 'game' }> => m.type === 'game');
    try {
      const control = await open('control');
      const team = await open('team');
      const previewTeam = await open('team', true);
      const previewOverlay = await open('overlay', true);
      await wait(() => control.inbox.some((m) => m.type === 'demo'));
      const lastStatus = () =>
        [...control.inbox].reverse().find((m): m is Extract<ServerMessage, { type: 'status' }> => m.type === 'status');
      expect(lastStatus()?.status.overlays).toBe(0); // la vista previa no cuenta

      control.ws.send(JSON.stringify({ type: 'demo', enabled: true }));
      expect(await wait(() => games(previewTeam).some((g) => g.data.player?.name === 'ALEX'))).toBe(true);
      expect(games(control).some((g) => g.data.party?.length === 6)).toBe(true);
      expect(await wait(() => previewTeam.inbox.some((m) => m.type === 'location' && !!m.location?.name && m.location.x !== null))).toBe(true);
      // El directo no recibe nada de la partida de ejemplo.
      expect(games(team).every((g) => g.data.party === null)).toBe(true);
      expect(team.inbox.some((m) => m.type === 'location' && m.location)).toBe(false);

      // «Mostrar en directo» con la partida de ejemplo: solo en la vista previa.
      control.ws.send(JSON.stringify({ type: 'showcase', showcase: { kind: 'bag', pocket: 'items' } }));
      expect(await wait(() => previewTeam.inbox.some((m) => m.type === 'showcase'))).toBe(true);
      expect(team.inbox.some((m) => m.type === 'showcase')).toBe(false);

      control.ws.send(JSON.stringify({ type: 'demo', enabled: false }));
      expect(await wait(() => games(previewTeam).at(-1)?.data.party === null)).toBe(true);
      expect(previewTeam.inbox.at(-1)).toEqual({ type: 'demo', enabled: false });
      for (const c of [control, team, previewTeam, previewOverlay]) c.ws.close();
    } finally {
      app.server.close();
      app.auto.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('el editor de diseño ve la partida de ejemplo si no hay partida real, sin que llegue al directo', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-editor-'));
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dataDir, ['red', 'emerald']),
      publicDir: path.join(dataDir, 'public'),
      localOnly: true,
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
    const open = async (hello: object) => {
      const ws = new WebSocket(base);
      const inbox: ServerMessage[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'hello', ...hello }));
      return { ws, inbox };
    };
    const wait = async (pred: () => boolean) => {
      for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
      return pred();
    };
    const games = (c: { inbox: ServerMessage[] }) =>
      c.inbox.filter((m): m is Extract<ServerMessage, { type: 'game' }> => m.type === 'game');
    try {
      const control = await open({ role: 'control' });
      const team = await open({ role: 'team' });
      const editor = await open({ role: 'team', preview: true, editor: true });
      expect(await wait(() => games(editor).some((g) => g.data.party?.length === 6))).toBe(true);
      expect(editor.inbox.some((m) => m.type === 'settings')).toBe(true);
      expect(editor.inbox.some((m) => m.type === 'slots')).toBe(true);
      // Ni el directo ni el panel reciben la partida de ejemplo, y el editor no cuenta como overlay.
      await wait(() => control.inbox.some((m) => m.type === 'status'));
      expect(games(team).every((g) => g.data.party === null)).toBe(true);
      expect(games(control).every((g) => g.data.party === null)).toBe(true);
      const lastStatus = [...control.inbox].reverse().find((m): m is Extract<ServerMessage, { type: 'status' }> => m.type === 'status');
      expect(lastStatus?.status.overlays).toBe(0);
      // Los cambios de diseño también llegan al editor.
      const before = editor.inbox.filter((m) => m.type === 'settings').length;
      control.ws.send(JSON.stringify({ type: 'settings', patch: { views: { ...DEFAULT_SETTINGS.views, rotateSec: 9 } } }));
      expect(await wait(() => editor.inbox.filter((m) => m.type === 'settings').length > before)).toBe(true);
      for (const c of [control, team, editor]) c.ws.close();
    } finally {
      app.server.close();
      app.auto.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Botones de prueba', () => {
  it('«Probar overlays en directo» enseña la partida de ejemplo en OBS y luego vuelve sola a los datos reales', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-test-btn-'));
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dataDir, ['red', 'emerald']),
      publicDir: path.join(dataDir, 'public'),
      localOnly: true,
      readyTimeoutMs: 200,
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
    const open = async (role: string) => {
      const ws = new WebSocket(base);
      const inbox: ServerMessage[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'hello', role }));
      return { ws, inbox };
    };
    const wait = async (pred: () => boolean, ms = 5000) => {
      for (let t = 0; t < ms && !pred(); t += 10) await new Promise((r) => setTimeout(r, 10));
      return pred();
    };
    const lastGame = (c: { inbox: ServerMessage[] }) =>
      [...c.inbox].reverse().find((m): m is Extract<ServerMessage, { type: 'game' }> => m.type === 'game');
    try {
      const control = await open('control');
      const team = await open('team');
      const overlay = await open('overlay');
      const views = { ...DEFAULT_SETTINGS.views, showcaseSec: 3 };
      control.ws.send(JSON.stringify({ type: 'settings', patch: { views } }));
      await wait(() => control.inbox.filter((m) => m.type === 'settings').length >= 2);

      control.ws.send(JSON.stringify({ type: 'testOverlays', enabled: true }));
      expect(await wait(() => lastGame(team)?.data.player?.name === 'ALEX')).toBe(true);
      expect(team.inbox.some((m) => m.type === 'test' && m.remainingMs > 2000)).toBe(true);
      expect(control.inbox.some((m) => m.type === 'test' && m.remainingMs > 0)).toBe(true);
      // Se termina sola (3 s) y el directo vuelve a los datos reales (aquí, vacíos).
      expect(await wait(() => team.inbox.at(-1)?.type === 'test' && (team.inbox.at(-1) as { remainingMs: number }).remainingMs === 0, 5000)).toBe(true);
      expect(lastGame(team)?.data.party).toBeNull();

      // «Probar combate doble»: dos tarjetas y la primera con «¡Nuevo!» (Pikachu y Eevee de Kanto).
      const random = vi.spyOn(Math, 'random').mockReturnValueOnce(24.5 / 151).mockReturnValueOnce(132.5 / 151);
      control.ws.send(JSON.stringify({ type: 'testBattle', double: true }));
      const prepare = () => overlay.inbox.find((m): m is Extract<ServerMessage, { type: 'prepare' }> => m.type === 'prepare');
      expect(await wait(() => !!prepare())).toBe(true);
      random.mockRestore();
      expect(prepare()!.cards.map((c) => [c.name, c.isNew ?? false])).toEqual([
        ['Pikachu', true],
        ['Eevee', false],
      ]);
      for (const c of [control, team, overlay]) c.ws.close();
    } finally {
      app.server.close();
      app.auto.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 15000);
});
