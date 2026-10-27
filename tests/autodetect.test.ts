import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/server/app.js';
import { AutoDetector } from '../src/server/autoDetect.js';
import {
  BATTLE_MON_SIZE,
  BATTLE_TYPE_DOUBLE,
  BATTLE_TYPE_TRAINER,
  BattleTracker,
  STALE_MS,
  gen3ToNational,
  parseBattleMons,
  type BattleMon,
  type BattleSnapshot,
  type Detection,
} from '../src/server/gen3.js';
import { SpriteCache } from '../src/server/pokeapi.js';
import { loadProfiles } from '../src/server/profiles.js';
import { MemoryReadError, NoResponseError, RetroArchClient, type MemoryReader } from '../src/server/retroarch.js';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/server/settings.js';
import type { AutoStatus, ServerMessage, Settings } from '../src/shared/types.js';
import { FakeClock, ROOT, makeService } from './helpers.js';

const emerald = loadProfiles(path.join(ROOT, 'profiles')).find((p) => p.id === 'emerald')!;
const MAP = emerald.autoDetect!;

/** Índice interno Gen III de una especie nacional. */
function internalOf(national: number): number {
  for (let i = 1; i <= 411; i++) if (gen3ToNational(i) === national) return i;
  throw new Error(`sin índice interno para ${national}`);
}

const mon = (national: number, personality: number, hp = 20, maxHp = 20, level = 5): BattleMon => ({
  internal: internalOf(national),
  species: national,
  personality,
  hp,
  maxHp,
  level,
});
const empty: BattleMon = { internal: 0, species: null, personality: 0, hp: 0, maxHp: 0, level: 0 };

function snap(opts: { typeFlags?: number; rivals?: BattleMon[]; own?: BattleMon } | null): BattleSnapshot {
  if (!opts) return { inBattle: false, typeFlags: 0, mons: [] };
  const [r1 = empty, r3 = empty] = opts.rivals ?? [];
  return { inBattle: true, typeFlags: opts.typeFlags ?? 0, mons: [opts.own ?? mon(252, 1), r1, empty, r3] };
}

/** Devuelve solo las detecciones de una serie de lecturas (cada una se repite dos veces: antirrebote). */
function feed(t: BattleTracker, seq: Array<BattleSnapshot>, start = 0, stepMs = 250) {
  const out: Detection[] = [];
  let now = start;
  for (const s of seq) {
    for (let i = 0; i < 2; i++) {
      for (const e of t.update(s, now)) if (e.type === 'detect') out.push(e);
      now += stepMs;
    }
  }
  return { out, now };
}

describe('Gen III: especies', () => {
  it('convierte índices internos a números nacionales', () => {
    expect(gen3ToNational(1)).toBe(1);
    expect(gen3ToNational(251)).toBe(251);
    expect(gen3ToNational(252)).toBeNull(); // huecos sin uso
    expect(gen3ToNational(276)).toBeNull();
    expect(gen3ToNational(277)).toBe(252); // Treecko
    expect(gen3ToNational(288)).toBe(263); // Zigzagoon
    expect(gen3ToNational(411)).toBe(358); // Chimecho
    expect(gen3ToNational(412)).toBeNull();
    expect(gen3ToNational(0)).toBeNull();
  });

  it('la tabla de Hoenn cubre 252..386 sin repetir', () => {
    const nat = Array.from({ length: 135 }, (_, i) => gen3ToNational(277 + i)!).sort((a, b) => a - b);
    expect(nat).toEqual(Array.from({ length: 135 }, (_, i) => 252 + i));
  });

  it('lee las estructuras BattlePokemon de la memoria', () => {
    const buf = Buffer.alloc(BATTLE_MON_SIZE * 4);
    const o = BATTLE_MON_SIZE; // posición 1: rival
    buf.writeUInt16LE(288, o);
    buf.writeUInt16LE(9, o + 0x28);
    buf[o + 0x2a] = 3;
    buf.writeUInt16LE(11, o + 0x2c);
    buf.writeUInt32LE(0xdeadbeef, o + 0x48);
    const mons = parseBattleMons(buf);
    expect(mons).toHaveLength(4);
    expect(mons[1]).toEqual({ internal: 288, species: 263, hp: 9, level: 3, maxHp: 11, personality: 0xdeadbeef });
  });
});

describe('BattleTracker', () => {
  it('detecta al rival salvaje una sola vez por aparición', () => {
    const t = new BattleTracker();
    const wild = snap({ rivals: [mon(263, 111)] });
    const { out } = feed(t, [wild, wild, wild, wild]);
    expect(out).toEqual([{ type: 'detect', species: [263], kind: 'wild', double: false }]);
  });

  it('exige dos lecturas iguales seguidas (antirrebote)', () => {
    const t = new BattleTracker();
    expect(t.update(snap({ rivals: [mon(263, 111)] }), 0).some((e) => e.type === 'detect')).toBe(false);
    expect(t.update(snap({ rivals: [mon(263, 111)] }), 250).some((e) => e.type === 'detect')).toBe(true);
  });

  it('vuelve a mostrar la misma especie en otro combate', () => {
    const t = new BattleTracker();
    let r = feed(t, [snap({ rivals: [mon(263, 111)] }), snap(null)]);
    expect(r.out).toHaveLength(1);
    r = feed(t, [snap({ rivals: [mon(263, 222)] })], r.now);
    expect(r.out.map((d) => d.species)).toEqual([[263]]);
  });

  it('en combates de entrenador muestra cada Pokémon que sale, aunque se repita la especie', () => {
    const t = new BattleTracker();
    const flags = BATTLE_TYPE_TRAINER;
    const { out } = feed(t, [
      snap({ typeFlags: flags, rivals: [mon(261, 1)] }),
      snap({ typeFlags: flags, rivals: [mon(261, 1, 0)] }), // debilitado
      snap({ typeFlags: flags, rivals: [mon(261, 2)] }), // otro Poochyena
      snap({ typeFlags: flags, rivals: [mon(263, 3)] }),
    ]);
    expect(out.map((d) => [d.species, d.kind])).toEqual([
      [[261], 'trainer'],
      [[261], 'trainer'],
      [[263], 'trainer'],
    ]);
  });

  it('en combates dobles muestra a los dos rivales y pone delante al que acaba de salir', () => {
    const t = new BattleTracker();
    const flags = BATTLE_TYPE_TRAINER | BATTLE_TYPE_DOUBLE;
    const { out } = feed(t, [
      snap({ typeFlags: flags, rivals: [mon(261, 1), mon(263, 2)] }),
      snap({ typeFlags: flags, rivals: [mon(265, 3), mon(263, 2)] }), // sale Wurmple en la posición 1
      snap({ typeFlags: flags, rivals: [mon(265, 3), mon(263, 2, 0)] }), // Zigzagoon debilitado
      snap({ typeFlags: flags, rivals: [mon(265, 3), mon(25, 4)] }), // sale Pikachu en la posición 3
    ]);
    expect(out.map((d) => d.species)).toEqual([
      [261, 263],
      [265, 263],
      [25, 265],
    ]);
    expect(out.every((d) => d.double && d.kind === 'trainer')).toBe(true);
  });

  it('no muestra a un compañero debilitado junto al nuevo rival', () => {
    const t = new BattleTracker();
    const flags = BATTLE_TYPE_TRAINER | BATTLE_TYPE_DOUBLE;
    const { out } = feed(t, [
      snap({ typeFlags: flags, rivals: [mon(261, 1), mon(263, 2)] }),
      snap({ typeFlags: flags, rivals: [mon(261, 1, 0), mon(263, 2)] }),
      snap({ typeFlags: flags, rivals: [mon(261, 1, 0), mon(265, 5)] }),
    ]);
    expect(out.map((d) => d.species)).toEqual([[261, 263], [265]]);
  });

  it('ignora los datos del combate anterior que siguen en memoria al empezar otro', () => {
    const t = new BattleTracker();
    let r = feed(t, [snap({ rivals: [mon(263, 111)] }), snap(null)]);
    // Al empezar, gBattleMons aún tiene al Zigzagoon anterior; luego se carga el nuevo rival.
    r = feed(t, [snap({ rivals: [mon(263, 111)] }), snap({ rivals: [mon(265, 999)] })], r.now);
    expect(r.out.map((d) => d.species)).toEqual([[265]]);
  });

  it('si el rival anterior se repite de verdad (revancha), se muestra pasado el margen', () => {
    const t = new BattleTracker();
    let r = feed(t, [snap({ typeFlags: BATTLE_TYPE_TRAINER, rivals: [mon(263, 7)] }), snap(null)]);
    const again = snap({ typeFlags: BATTLE_TYPE_TRAINER, rivals: [mon(263, 7)] });
    r = feed(t, [again], r.now);
    expect(r.out).toHaveLength(0);
    r = feed(t, [again, again], r.now + STALE_MS);
    expect(r.out.map((d) => d.species)).toEqual([[263]]);
  });

  it('descarta lecturas sin sentido (memoria sin inicializar o a medio escribir)', () => {
    const t = new BattleTracker();
    const garbage = [
      { ...mon(263, 1), internal: 300 + 200, species: null },
      { ...mon(263, 1), level: 0 },
      { ...mon(263, 1), maxHp: 0 },
      { ...mon(263, 1), hp: 50, maxHp: 20 },
    ];
    const { out } = feed(
      t,
      garbage.map((g) => snap({ rivals: [g] })),
    );
    expect(out).toHaveLength(0);
  });
});

/** RetroArch simulado en memoria. */
class FakeReader implements MemoryReader {
  mem = new Map<number, number>();
  down = false;
  contentless = false;
  romReadable = true;
  gameCode = 'BPES';
  reads = 0;
  /** Lecturas del indicador de combate (1 byte). */
  flagReads = 0;
  closed = false;
  async version() {
    if (this.down) throw new NoResponseError('sin respuesta');
    return '1.21.0';
  }
  async status() {
    if (this.down) throw new NoResponseError('sin respuesta');
    return this.contentless ? 'CONTENTLESS' : 'PLAYING game_gba,Pokemon - Edicion Esmeralda (Spain),crc32=1f1c08fb';
  }
  async read(address: number, length: number) {
    if (this.down) throw new NoResponseError('sin respuesta');
    if (this.contentless) throw new MemoryReadError('no memory map defined');
    this.reads++;
    if (address === MAP.inBattle.address) this.flagReads++;
    if (address === 0x080000ac) {
      if (!this.romReadable) throw new MemoryReadError('address not mapped');
      return Buffer.from(this.gameCode, 'latin1');
    }
    return Buffer.from(Array.from({ length }, (_, i) => this.mem.get(address + i) ?? 0));
  }
  close() {
    this.closed = true;
  }
  takeStats() {
    return { queries: this.reads, latencyMs: this.reads * 0.3 };
  }
  setBattle(typeFlags: number, rivals: Array<[number, number] | null>) {
    this.mem.clear();
    this.mem.set(MAP.inBattle.address, MAP.inBattle.mask);
    for (let i = 0; i < 4; i++) this.mem.set(MAP.battleTypeFlags + i, (typeFlags >> (8 * i)) & 0xff);
    const put = (slot: number, national: number, personality: number) => {
      const b = Buffer.alloc(BATTLE_MON_SIZE);
      b.writeUInt16LE(internalOf(national), 0);
      b.writeUInt16LE(20, 0x28);
      b[0x2a] = 5;
      b.writeUInt16LE(20, 0x2c);
      b.writeUInt32LE(personality, 0x48);
      b.forEach((v, i) => this.mem.set(MAP.battleMons + slot * BATTLE_MON_SIZE + i, v));
    };
    put(0, 252, 1);
    rivals.forEach((r, i) => r && put(i === 0 ? 1 : 3, r[0], r[1]));
  }
  endBattle() {
    this.mem.delete(MAP.inBattle.address);
  }
}

const settle = () => new Promise((r) => setImmediate(r));

function detector(reader: FakeReader, patch: Partial<Settings> = {}) {
  const clock = new FakeClock();
  let settings: Settings = { ...DEFAULT_SETTINGS, gameId: 'emerald', auto: { ...DEFAULT_SETTINGS.auto, enabled: true }, ...patch };
  const detections: Detection[] = [];
  const statuses: AutoStatus[] = [];
  let created = 0;
  const auto = new AutoDetector({
    settings: () => settings,
    profile: (id) => (id === 'emerald' ? emerald : id === 'red' ? { ...emerald, id: 'red', name: 'Pokémon Rojo', autoDetect: undefined } : undefined),
    createReader: () => {
      created++;
      return reader;
    },
    onDetect: (d) => detections.push(d),
    onStatus: (s) => statuses.push(s),
    speciesNames: async (_g, species) => species.map((n) => `#${n}`),
    clock,
    usage: () => ({ cpuMicros: 0, rssBytes: 64 * 1024 * 1024 }),
  });
  const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      await settle();
      clock.advance(50);
    }
    await settle();
  };
  return {
    auto,
    clock,
    detections,
    statuses,
    advance,
    get created() {
      return created;
    },
    set: (p: Partial<Settings>) => {
      settings = { ...settings, ...p };
      auto.reconfigure();
    },
  };
}

describe('AutoDetector', () => {
  it('desactivada no abre ninguna conexión ni lee nada', async () => {
    const reader = new FakeReader();
    const d = detector(reader, { auto: { ...DEFAULT_SETTINGS.auto, enabled: false } });
    d.auto.reconfigure();
    await d.advance(2000);
    expect(d.created).toBe(0);
    expect(reader.reads).toBe(0);
    expect(d.auto.status.state).toBe('off');
  });

  it('con un juego sin mapa de memoria avisa y no se conecta', async () => {
    const d = detector(new FakeReader(), { gameId: 'red' });
    d.auto.reconfigure();
    expect(d.auto.status.state).toBe('unsupported');
    expect(d.created).toBe(0);
  });

  it('fuera de combate solo lee un byte por consulta', async () => {
    const reader = new FakeReader();
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(100);
    expect(d.auto.status.state).toBe('watching');
    expect(d.auto.status.gameCode).toBe('BPES');
    const before = reader.flagReads;
    await d.advance(1000); // 4 lecturas por segundo del indicador de combate
    expect(reader.flagReads - before).toBeGreaterThanOrEqual(3);
    expect(reader.flagReads - before).toBeLessThanOrEqual(5);
  });

  it('detecta un combate salvaje y avisa una vez', async () => {
    const reader = new FakeReader();
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(300);
    reader.setBattle(0, [[263, 1234]]);
    await d.advance(2000);
    expect(d.detections).toEqual([{ type: 'detect', species: [263], kind: 'wild', double: false }]);
    expect(d.auto.status.state).toBe('battle');
    expect(d.auto.status.lastDetected?.names).toEqual(['#263']);
    reader.endBattle();
    await d.advance(600);
    expect(d.auto.status.state).toBe('watching');
  });

  it('combate doble: los dos rivales en una sola detección', async () => {
    const reader = new FakeReader();
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(300);
    reader.setBattle(BATTLE_TYPE_TRAINER | BATTLE_TYPE_DOUBLE, [
      [265, 1],
      [25, 2],
    ]);
    await d.advance(1500);
    expect(d.detections.map((x) => x.species)).toEqual([[265, 25]]);
  });

  it('si RetroArch no responde, reintenta cada 3 s y se recupera solo', async () => {
    const reader = new FakeReader();
    reader.down = true;
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(100);
    expect(d.auto.status.state).toBe('connecting');
    expect(d.auto.status.message).toMatch(/Comandos de red/);
    reader.down = false;
    await d.advance(3500);
    expect(d.auto.status.state).toBe('watching');
  });

  it('sin juego cargado lo indica y espera', async () => {
    const reader = new FakeReader();
    reader.contentless = true;
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(100);
    expect(d.auto.status.state).toBe('no-game');
  });

  it('con otro juego cargado no lee la memoria del combate', async () => {
    const reader = new FakeReader();
    reader.gameCode = 'BPRS'; // Rojo Fuego
    reader.setBattle(0, [[263, 1]]);
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(2000);
    expect(d.auto.status.state).toBe('wrong-game');
    expect(d.detections).toHaveLength(0);
  });

  it('si el núcleo no deja leer la ROM, continúa sin comprobarla', async () => {
    const reader = new FakeReader();
    reader.romReadable = false;
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(100);
    expect(d.auto.status.state).toBe('watching');
    expect(d.auto.status.gameCode).toBeNull();
  });

  it('al desactivarla cierra la conexión y deja de leer', async () => {
    const reader = new FakeReader();
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(500);
    d.set({ auto: { ...DEFAULT_SETTINGS.auto, enabled: false } });
    const reads = reader.reads;
    await d.advance(2000);
    expect(reader.closed).toBe(true);
    expect(reader.reads).toBe(reads);
    expect(d.clock.pending).toBe(0);
  });

  it('indica si la protección de red (regla temporal del firewall) está activa', async () => {
    const reader = new FakeReader();
    const d = detector(reader);
    let active = true;
    // El detector de pruebas no trae comprobación de firewall: se crea uno con ella.
    const auto = new AutoDetector({
      settings: () => ({ ...DEFAULT_SETTINGS, gameId: 'emerald', auto: { ...DEFAULT_SETTINGS.auto, enabled: true } }),
      profile: () => emerald,
      createReader: () => reader,
      onDetect: () => {},
      onStatus: () => {},
      speciesNames: async () => [],
      clock: d.clock,
      usage: () => ({ cpuMicros: 0, rssBytes: 0 }),
      firewallActive: async () => active,
    });
    auto.reconfigure();
    await d.advance(100);
    expect(auto.status.firewall).toBe(true);
    active = false;
    await d.advance(31000);
    expect(auto.status.firewall).toBe(false);
    expect(auto.status.events.some((e) => e.kind === 'warn' && /Protección de red inactiva/.test(e.text))).toBe(true);
    auto.stop();
  });

  it('informa del consumo de CPU, memoria y lecturas por segundo', async () => {
    const reader = new FakeReader();
    const d = detector(reader);
    d.auto.reconfigure();
    await d.advance(5200);
    const u = d.auto.status.usage!;
    expect(u.memoryMb).toBe(64);
    expect(u.cpuPercent).toBe(0);
    expect(u.readsPerSec).toBeGreaterThan(3);
  });
});

describe('RetroArchClient (UDP)', () => {
  let fake: dgram.Socket | null = null;
  afterEach(() => {
    fake?.close();
    fake = null;
  });

  async function fakeRetroArch(handler: (cmd: string) => string | null) {
    const sock = dgram.createSocket('udp4');
    sock.on('message', (m, r) => {
      const out = handler(m.toString().trim());
      if (out !== null) sock.send(out, r.port, r.address);
    });
    await new Promise<void>((res) => sock.bind(0, '127.0.0.1', res));
    fake = sock;
    return (sock.address() as AddressInfo).port;
  }

  it('habla el protocolo de comandos de red', async () => {
    const port = await fakeRetroArch((cmd) => {
      if (cmd === 'VERSION') return '1.21.0';
      if (cmd === 'GET_STATUS') return 'GET_STATUS PLAYING game_gba,Esmeralda,crc32=1234';
      if (cmd === 'READ_CORE_MEMORY 30026f9 1') return 'READ_CORE_MEMORY 30026f9 02';
      if (cmd === 'READ_CORE_MEMORY 2024084 2') return 'READ_CORE_MEMORY 2024084 20 01';
      if (cmd.startsWith('READ_CORE_MEMORY 9')) return 'READ_CORE_MEMORY 9000000 -1 no memory map defined';
      return null;
    });
    const c = new RetroArchClient(port);
    try {
      expect(await c.version()).toBe('1.21.0');
      expect(await c.status()).toBe('PLAYING game_gba,Esmeralda,crc32=1234');
      expect([...(await c.read(0x030026f9, 1))]).toEqual([2]);
      expect((await c.read(0x02024084, 2)).readUInt16LE(0)).toBe(288);
      await expect(c.read(0x09000000, 4)).rejects.toBeInstanceOf(MemoryReadError);
      expect(c.takeStats().queries).toBe(5);
    } finally {
      c.close();
    }
  });

  it('sin RetroArch, falla por tiempo sin bloquear las siguientes consultas', async () => {
    const port = await fakeRetroArch(() => null);
    const c = new RetroArchClient(port, '127.0.0.1', 100);
    try {
      const results = await Promise.allSettled([c.version(), c.status()]);
      expect(results.every((r) => r.status === 'rejected' && r.reason instanceof NoResponseError)).toBe(true);
    } finally {
      c.close();
    }
  });
});

describe('Integración: detección → overlay', () => {
  it('un combate doble en Esmeralda llega al overlay con dos tarjetas, aunque estén fuera de la Pokédex regional', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-auto-'));
    const reader = new FakeReader();
    const clock = new FakeClock();
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dataDir, ['red', 'emerald']),
      publicDir: path.join(dataDir, 'public'),
      localOnly: true,
      readyTimeoutMs: 500,
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
    try {
      const control = await open('control');
      const overlay = await open('overlay');
      control.ws.send(
        JSON.stringify({
          type: 'settings',
          patch: { gameId: 'emerald', catalogMode: 'regional', auto: { enabled: true, intervalMs: 250, port: 55355 } },
        }),
      );
      // Eevee (133) no está en la Pokédex de Hoenn: la detección usa la Nacional en vez de fallar.
      reader.setBattle(BATTLE_TYPE_TRAINER | BATTLE_TYPE_DOUBLE, [
        [265, 1],
        [133, 2],
      ]);
      let prepare: Extract<ServerMessage, { type: 'prepare' }> | undefined;
      for (let i = 0; i < 100 && !prepare; i++) {
        await new Promise((r) => setTimeout(r, 10));
        clock.advance(100);
        prepare = overlay.inbox.find((m): m is Extract<ServerMessage, { type: 'prepare' }> => m.type === 'prepare');
      }
      expect(prepare?.cards.map((c) => c.name)).toEqual(['Wurmple', 'Eevee']);
      expect(prepare?.cards[1].numberLabel).toBe('Nacional');
      const autoMsgs = control.inbox.filter((m): m is Extract<ServerMessage, { type: 'auto' }> => m.type === 'auto');
      expect(autoMsgs.at(-1)?.status.state).toBe('battle');
      control.ws.close();
      overlay.ws.close();
    } finally {
      app.server.close();
      app.auto.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
