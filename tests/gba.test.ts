import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import {
  GbaAssets,
  parseItemIcons,
  parseWallpaperTileCounts,
  POKEEMERALD_BASE,
  type BinarySource,
} from '../src/server/gbaAssets.js';
import { composeTilemap16, composeTilemap8, decodeIndexedPng, paint, parseJascPal, type IndexedImage } from '../src/server/gbaGfx.js';
import { parseBoxMon, parseStorage, STORAGE_LENGTH } from '../src/server/gen3save.js';
import { SpriteCache } from '../src/server/pokeapi.js';
import { SettingsStore } from '../src/server/settings.js';
import { ADDR, encodeBoxMon, FakeMemory } from './gen3fake.js';
import { makeService } from './helpers.js';

// ── PNG de paleta sintéticos (como los de pokeemerald) ──────────────────────

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** PNG indexado con el filtro indicado por fila (0 ninguno, 1 Sub, 2 Up, 3 Average, 4 Paeth). */
function indexedPng(width: number, height: number, depth: 4 | 8, indices: number[], palette: number[][], filters: number[] = [], trns?: number[]): Buffer {
  const stride = Math.ceil((width * depth) / 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      const v = indices[y * width + x];
      if (depth === 8) row[x] = v;
      else row[x >> 1] |= x % 2 === 0 ? v << 4 : v;
    }
    rows.push(row);
  }
  const raw: Buffer[] = [];
  rows.forEach((row, y) => {
    const f = filters[y] ?? 0;
    const prev = y > 0 ? rows[y - 1] : Buffer.alloc(stride);
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? row[x - 1] : 0;
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f];
      out[x] = (row[x] - pred) & 0xff;
    }
    raw.push(Buffer.from([f]), out);
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = 3;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette.flat())),
    ...(trns ? [chunk('tRNS', Buffer.from(trns))] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PAL = Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, i * 8]);

/** Hoja de piezas 8 × 8 de 4 bits: la pieza n está rellena del índice n + 1. */
function tileSheet(tiles: number, perRow = tiles): Buffer {
  const w = perRow * 8;
  const h = Math.ceil(tiles / perRow) * 8;
  const idx = Array.from({ length: w * h }, (_, i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    const t = Math.floor(y / 8) * perRow + Math.floor(x / 8);
    return t < tiles ? (t + 1) % 16 : 0;
  });
  return indexedPng(w, h, 4, idx, PAL);
}

const pixel = (img: { width: number; data: Buffer }, x: number, y: number) =>
  [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('PNG de paleta', () => {
  it('lee índices de 4 y 8 bits con todos los filtros de fila', () => {
    const idx4 = Array.from({ length: 6 * 5 }, (_, i) => (i * 7) % 16);
    const img4 = decodeIndexedPng(indexedPng(6, 5, 4, idx4, PAL, [0, 1, 2, 3, 4]));
    expect([...img4.indices]).toEqual(idx4);
    const idx8 = Array.from({ length: 5 * 5 }, (_, i) => (i * 37) % 200);
    const pal8 = Array.from({ length: 200 }, (_, i) => [i, i, i]);
    const img8 = decodeIndexedPng(indexedPng(5, 5, 8, idx8, pal8, [4, 3, 2, 1, 0]));
    expect([...img8.indices]).toEqual(idx8);
    expect(img8.palette[150]).toEqual([150, 150, 150, 255]);
  });

  it('respeta la transparencia de la paleta (tRNS) y rechaza PNG que no son de paleta', () => {
    const img = decodeIndexedPng(indexedPng(2, 1, 4, [0, 1], PAL, [], [0, 128]));
    expect(img.palette[0][3]).toBe(0);
    expect(img.palette[1][3]).toBe(128);
    const rgba = new PNG({ width: 1, height: 1 });
    expect(() => decodeIndexedPng(PNG.sync.write(rgba))).toThrow(/paleta/);
  });

  it('paleta JASC de pokeemerald', () => {
    expect(parseJascPal('JASC-PAL\r\n0100\r\n2\r\n255 0 0\r\n0 0 255\r\n')).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
  });

  it('pinta con el índice 0 transparente (sprites) y recorta', () => {
    const img = decodeIndexedPng(indexedPng(4, 1, 4, [0, 1, 2, 3], PAL));
    const out = paint(img, img.palette, { sx: 0, w: 2, h: 1 });
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 1, 0)).toEqual([16, 239, 8, 255]);
  });
});

describe('Composición por piezas', () => {
  it('mapa de 16 bits: piezas de dos hojas, volteos y paleta por casilla', () => {
    const a = decodeIndexedPng(tileSheet(2)); // piezas 0 y 1 (índices 1 y 2)
    const b = decodeIndexedPng(tileSheet(1)); // pieza 0 (índice 1)
    const red: [number, number, number, number][] = PAL.map(() => [255, 0, 0, 255]);
    const map = Buffer.alloc(8);
    map.writeUInt16LE(1 | (1 << 12), 0); // pieza 1 de la hoja A, paleta 1
    map.writeUInt16LE(2 | 0x400 | (2 << 12), 2); // pieza 0 de la hoja B, volteada, paleta 2
    map.writeUInt16LE(0, 4); // pieza 0 con paleta 0 (no cargada): se queda vacía
    map.writeUInt16LE(99 | (1 << 12), 6); // pieza inexistente: vacía
    const out = composeTilemap16(map, 2, [
      { sheet: a, first: 0, count: 2 },
      { sheet: b, first: 2, count: 1 },
    ], { 1: a.palette, 2: red });
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
    expect(pixel(out, 0, 0)).toEqual([...a.palette[2]]);
    expect(pixel(out, 8, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 0, 8)[3]).toBe(0);
    expect(pixel(out, 8, 8)[3]).toBe(0);
  });

  it('mapa de 8 bits (fondo afín) con recorte', () => {
    const sheet: IndexedImage = decodeIndexedPng(
      indexedPng(16, 8, 8, Array.from({ length: 128 }, (_, i) => ((i % 16) < 8 ? 3 : 4)), Array.from({ length: 5 }, (_, i) => [i * 50, 0, 0])),
    );
    const out = composeTilemap8(Buffer.from([1, 0, 0, 1]), 2, sheet, { w: 1, h: 2 });
    expect([out.width, out.height]).toEqual([8, 16]);
    expect(pixel(out, 0, 0)).toEqual([200, 0, 0, 255]);
    expect(pixel(out, 0, 8)).toEqual([150, 0, 0, 255]);
  });
});

describe('Tablas de pokeemerald', () => {
  it('icono y paleta de cada objeto por su número del juego', () => {
    const constants = 'enum {\n    ITEM_NONE,\n    ITEM_MASTER_BALL,\n    ITEM_POTION = 13,\n    ITEM_ANTIDOTE,\n};';
    const table = '[ITEM_NONE] = {gItemIcon_QuestionMark, gItemIconPalette_QuestionMark},\n[ITEM_POTION] = {gItemIcon_Potion, gItemIconPalette_Potion},';
    const graphics =
      'const u32 gItemIcon_Potion[] = INCGFX_U32("graphics/items/icons/potion.png", ".4bpp.lz");\n' +
      'const u32 gItemIconPalette_Potion[] = INCGFX_U32("graphics/items/icon_palettes/potion.pal", ".gbapal.lz");\n' +
      'const u32 gItemIcon_QuestionMark[] = INCGFX_U32("graphics/items/icons/question_mark.png", ".4bpp.lz");\n' +
      'const u32 gItemIconPalette_QuestionMark[] = INCGFX_U32("graphics/items/icon_palettes/question_mark.pal", ".gbapal.lz");';
    const icons = parseItemIcons(constants, table, graphics);
    expect(icons.get(13)).toEqual(['graphics/items/icons/potion.png', 'graphics/items/icon_palettes/potion.pal']);
    expect(icons.get(0)?.[0]).toMatch(/question_mark/);
    expect(icons.has(14)).toBe(false);
  });

  it('número de piezas del marco y del fondo de cada caja', () => {
    const rules =
      '$(WALLPAPERGFXDIR)/savanna/frame.4bpp: %.4bpp: %.png\n\t$(GFX) $< $@ -num_tiles 45 -Wnum_tiles\n' +
      '$(WALLPAPERGFXDIR)/savanna/bg.4bpp: %.4bpp: %.png\n\t$(GFX) $< $@ -num_tiles 23 -Wnum_tiles\n' +
      '$(WALLPAPERGFXDIR)/desert/tiles.4bpp: $(WALLPAPERGFXDIR)/desert/frame.4bpp $(WALLPAPERGFXDIR)/desert/bg.4bpp\n\t@cat $^ >$@\n';
    expect(parseWallpaperTileCounts(rules)).toEqual({ savanna: { frame: 45, bg: 23 } });
  });
});

describe('Datos de la partida para el diseño', () => {
  it('Poké Ball de captura de cada Pokémon', () => {
    expect(parseBoxMon(encodeBoxMon({ species: 25, ball: 2 }))?.ball).toBe(2);
    expect(parseBoxMon(encodeBoxMon({ species: 25 }))?.ball).toBe(4);
    for (let p = 0; p < 24; p++) expect(parseBoxMon(encodeBoxMon({ species: 1, personality: p, ball: 12 }))?.ball).toBe(12);
  });

  it('fondo de cada caja del PC', () => {
    const mem = new FakeMemory();
    mem.load({ boxes: [{ wallpaper: 3, mons: [] }, { wallpaper: 15, mons: [] }] });
    const st = parseStorage(mem.read(ADDR.storage, STORAGE_LENGTH));
    expect(st.boxes.map((b) => b.wallpaper).slice(0, 4)).toEqual([3, 15, 2, 3]);
  });
});

// ── Servicio de gráficos con archivos sintéticos ─────────────────────────────

class FakeRepo implements BinarySource {
  calls: string[] = [];
  files = new Map<string, Buffer>();
  constructor() {
    const put = (p: string, b: Buffer | string) => this.files.set(POKEEMERALD_BASE + p, Buffer.from(b));
    put('graphics/pokenav/region_map/map.png', indexedPng(16, 8, 8, Array.from({ length: 128 }, (_, i) => (i % 16 < 8 ? 1 : 2)), [[0, 0, 0], [0, 0, 200], [0, 200, 0]]));
    put('graphics/pokenav/region_map/map.bin', Buffer.alloc(64 * 64, 1));
    put('graphics/pokenav/region_map/brendan_icon.png', indexedPng(16, 16, 4, Array(256).fill(1), PAL));
    put('graphics/bag/bag_female.png', indexedPng(64, 384, 4, Array.from({ length: 64 * 384 }, (_, i) => Math.floor(i / (64 * 64)) + 1), PAL));
    put('graphics/balls/poke.png', indexedPng(16, 48, 4, Array(16 * 48).fill(5), PAL));
    put('graphics/trainer_card/badges.png', indexedPng(128, 16, 4, Array.from({ length: 128 * 16 }, (_, i) => Math.floor((i % 128) / 16) + 1), PAL));
    put('graphics_file_rules.mk', '$(WALLPAPERGFXDIR)/savanna/frame.4bpp: %.4bpp: %.png\n\t$(GFX) $< $@ -num_tiles 2 -Wnum_tiles\n');
    put('graphics/pokemon_storage/wallpapers/savanna/frame.png', tileSheet(4, 2));
    put('graphics/pokemon_storage/wallpapers/savanna/bg.png', tileSheet(1));
    const tm = Buffer.alloc(360 * 2);
    for (let i = 0; i < 360; i++) tm.writeUInt16LE(i < 60 ? 1 | (1 << 12) : 2 | (2 << 12), i * 2);
    put('graphics/pokemon_storage/wallpapers/savanna/tilemap.bin', tm);
    put('include/constants/items.h', 'enum {\n ITEM_NONE,\n ITEM_POTION = 13,\n};');
    put('src/data/item_icon_table.h', '[ITEM_POTION] = {gItemIcon_Potion, gItemIconPalette_Potion},');
    put('src/data/graphics/items.h', 'gItemIcon_Potion[] = INCGFX_U32("graphics/items/icons/potion.png", "");\ngItemIconPalette_Potion[] = INCGFX_U32("graphics/items/icon_palettes/potion.pal", "");');
    put('graphics/items/icons/potion.png', indexedPng(24, 24, 4, Array(576).fill(1), PAL));
    put('graphics/items/icon_palettes/potion.pal', 'JASC-PAL\n0100\n2\n0 0 0\n1 2 3\n');
  }
  async get(url: string) {
    this.calls.push(url);
    const f = this.files.get(url);
    if (!f) throw new Error(`no existe ${url}`);
    return f;
  }
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-gba-'));
  dirs.push(d);
  return d;
};
const png = (b: Buffer) => PNG.sync.read(b);

describe('GbaAssets', () => {
  it('compone cada recurso con su tamaño y lo guarda en caché', async () => {
    const repo = new FakeRepo();
    const assets = new GbaAssets(tmp(), repo);
    expect([png(await assets.get('region-map')).width, png(await assets.get('region-map')).height]).toEqual([240, 160]);
    expect(png(await assets.get('face-male')).width).toBe(16);
    const bag = png(await assets.get('bag-female-4'));
    expect([bag.width, bag.height]).toEqual([64, 64]);
    expect([...bag.data.subarray(0, 3)]).toEqual(PAL[5]); // postura 4 → índice 5
    expect([png(await assets.get('ball-4')).width, png(await assets.get('ball-4')).height]).toEqual([16, 16]);
    const badge = png(await assets.get('badge-3'));
    expect([...badge.data.subarray(0, 3)]).toEqual(PAL[4]);
    const wall = png(await assets.get('wallpaper-3'));
    expect([wall.width, wall.height]).toEqual([160, 144]);
    expect([...wall.data.subarray(0, 3)]).toEqual(PAL[2]); // pieza 1 del marco, paleta del marco
    const lastRow = (143 * 160) * 4;
    expect([...wall.data.subarray(lastRow, lastRow + 3)]).toEqual(PAL[1]); // pieza 0 del fondo (índice 1)
    expect([...png(await assets.get('item-13')).data.subarray(0, 3)]).toEqual([1, 2, 3]);
    const calls = repo.calls.length;
    await assets.get('wallpaper-3');
    expect(repo.calls.length).toBe(calls); // de la caché
  });

  it('solo admite nombres conocidos', async () => {
    const assets = new GbaAssets(tmp(), new FakeRepo());
    for (const bad of ['../secreto', 'ball-13', 'wallpaper-16', 'badge-8', 'bag-male-6', 'mapa']) {
      await expect(assets.get(bad)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('el servidor los sirve en /gba/<nombre>.png', async () => {
    const dir = tmp();
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dir, ['red', 'emerald']),
      publicDir: path.join(dir, 'public'),
      localOnly: true,
      gba: new GbaAssets(dir, new FakeRepo()),
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/gba/ball-4.png`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('image/png');
      expect(png(Buffer.from(await ok.arrayBuffer())).width).toBe(16);
      expect((await fetch(`${base}/gba/nada.png`)).status).toBe(404);
    } finally {
      app.server.close();
      app.auto.stop();
    }
  });
});
