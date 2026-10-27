// Gráficos originales de Pokémon Esmeralda para los overlays: mapa de Hoenn,
// caras del personaje, mochila, Poké Balls, medallas, fondos de las cajas del PC
// e iconos de objetos. Se descargan del proyecto pokeemerald (versión fija),
// se componen como en el juego y se guardan en caché en disco.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  composeTilemap16,
  composeTilemap8,
  decodeIndexedPng,
  encodePng,
  paint,
  parseJascPal,
  type IndexedImage,
} from './gbaGfx.js';
import { AppError } from './pokeapi.js';

/** Versión fija de pokeemerald: una actualización del proyecto no cambia los gráficos. */
export const POKEEMERALD_COMMIT = '731ad5bfd6e6f265508d0efcca0ba42f9dcf5881';
export const POKEEMERALD_BASE = `https://raw.githubusercontent.com/pret/pokeemerald/${POKEEMERALD_COMMIT}/`;

/** Fondos de las cajas del PC, en el orden de WALLPAPER_* del juego. */
export const WALLPAPERS = [
  'forest', 'city', 'desert', 'savanna', 'crag', 'volcano', 'snow', 'cave',
  'beach', 'seafloor', 'river', 'sky', 'polkadot', 'pokecenter', 'machine', 'plain',
];

/** Poké Ball de captura (origins, bits 11–14) → gráfico de graphics/balls. */
export const BALLS: Record<number, string> = {
  1: 'master', 2: 'ultra', 3: 'great', 4: 'poke', 5: 'safari', 6: 'net',
  7: 'dive', 8: 'nest', 9: 'repeat', 10: 'timer', 11: 'luxury', 12: 'premier',
};

/** Bolsillo → postura de la mochila (0 es la mochila cerrada). */
export const BAG_FRAMES: Record<string, number> = { items: 1, balls: 2, tmhm: 3, berries: 4, key: 5 };

/** Nombres de recurso válidos: así nunca se piden rutas arbitrarias. */
const NAME = /^(region-map|face-(male|female)|bag-(male|female)-[0-5]|ball-([1-9]|1[0-2])|badge-[0-7]|wallpaper-([0-9]|1[0-5])|item-\d{1,3})$/;

export interface BinarySource {
  get(url: string): Promise<Buffer>;
}

/** Descarga con caché permanente en disco (los archivos de una versión fija no cambian). */
export class CachedFetcher implements BinarySource {
  private dir: string;
  constructor(cacheDir: string, private userAgent: string) {
    this.dir = path.join(cacheDir, 'gba', 'src');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  async get(url: string): Promise<Buffer> {
    const file = path.join(this.dir, crypto.createHash('sha1').update(url).digest('hex'));
    if (fs.existsSync(file)) return fs.readFileSync(file);
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new AppError('NETWORK', 'No se pudieron descargar los gráficos del juego.', `${url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new AppError(res.status === 404 ? 'NOT_FOUND' : 'NETWORK', 'Gráfico del juego no disponible.', url);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(`${file}.${process.pid}.tmp`, buf);
    fs.renameSync(`${file}.${process.pid}.tmp`, file);
    return buf;
  }
}

/** Índice del objeto → [icono, paleta] (rutas en pokeemerald), a partir de sus tablas de código. */
export function parseItemIcons(constants: string, table: string, graphics: string): Map<number, [string, string]> {
  const enumStart = constants.indexOf('enum');
  const body = constants.slice(enumStart, constants.indexOf('};', enumStart));
  const ids: Record<string, number> = {};
  let n = -1;
  for (const m of body.matchAll(/\b(ITEM_[A-Z0-9_]+)\s*(?:=\s*([^,\n]+))?\s*,/g)) {
    const v = m[2]?.trim();
    n = v === undefined ? n + 1 : /^\d+$/.test(v) ? Number(v) : (ids[v] ?? NaN);
    ids[m[1]] = n;
  }
  const files: Record<string, string> = {};
  for (const m of graphics.matchAll(/(gItemIcon(?:Palette)?_\w+)\[\]\s*=\s*INC\w+\("([^"]+)"/g)) files[m[1]] = m[2];
  const out = new Map<number, [string, string]>();
  for (const m of table.matchAll(/\[(ITEM_[A-Z0-9_]+)\]\s*=\s*\{(\w+),\s*(\w+)\}/g)) {
    const id = ids[m[1]];
    const icon = files[m[2]];
    const pal = files[m[3]];
    if (Number.isInteger(id) && icon && pal) out.set(id, [icon, pal]);
  }
  return out;
}

/** Piezas del marco y del fondo de cada fondo de caja (reglas de compilación de pokeemerald). */
export function parseWallpaperTileCounts(rules: string): Record<string, { frame?: number; bg?: number }> {
  const out: Record<string, { frame?: number; bg?: number }> = {};
  for (const m of rules.matchAll(/\$\(WALLPAPERGFXDIR\)\/(\w+)\/(frame|bg)\.4bpp:[^\n]*\n\s*\$\(GFX\)[^\n]*-num_tiles (\d+)/g)) {
    (out[m[1]] ??= {})[m[2] as 'frame' | 'bg'] = Number(m[3]);
  }
  return out;
}

export class GbaAssets {
  private outDir: string;
  private building = new Map<string, Promise<Buffer>>();
  private itemIcons: Promise<Map<number, [string, string]>> | null = null;
  private tileCounts: Promise<Record<string, { frame?: number; bg?: number }>> | null = null;

  constructor(
    cacheDir: string,
    private source: BinarySource,
    private base = POKEEMERALD_BASE,
  ) {
    this.outDir = path.join(cacheDir, 'gba', 'out');
    fs.mkdirSync(this.outDir, { recursive: true });
  }

  static isValidName(name: string): boolean {
    return NAME.test(name);
  }

  /** PNG del recurso (compuesto una vez y guardado). */
  async get(name: string): Promise<Buffer> {
    if (!GbaAssets.isValidName(name)) throw new AppError('NOT_FOUND', 'Recurso desconocido.');
    const file = path.join(this.outDir, `${name}.png`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    let p = this.building.get(name);
    if (!p) {
      p = this.build(name).then((png) => {
        fs.writeFileSync(file, png);
        return png;
      });
      p.finally(() => this.building.delete(name)).catch(() => {});
      this.building.set(name, p);
    }
    return p;
  }

  private png = async (p: string): Promise<IndexedImage> => decodeIndexedPng(await this.source.get(this.base + p));
  private text = async (p: string): Promise<string> => (await this.source.get(this.base + p)).toString('utf8');

  private async build(name: string): Promise<Buffer> {
    const [kind, ...rest] = name.split('-');
    switch (kind) {
      case 'region': {
        // Mapa de Hoenn: fondo afín de 64 × 64 piezas; la parte visible son 30 × 20 (240 × 160 px).
        const sheet = await this.png('graphics/pokenav/region_map/map.png');
        const map = await this.source.get(this.base + 'graphics/pokenav/region_map/map.bin');
        return encodePng(composeTilemap8(map, 64, sheet, { w: 30, h: 20 }));
      }
      case 'face': {
        const img = await this.png(`graphics/pokenav/region_map/${rest[0] === 'female' ? 'may' : 'brendan'}_icon.png`);
        return encodePng(paint(img, img.palette));
      }
      case 'bag': {
        const img = await this.png(`graphics/bag/bag_${rest[0]}.png`);
        return encodePng(paint(img, img.palette, { sy: Number(rest[1]) * 64, w: 64, h: 64 }));
      }
      case 'ball': {
        // Primera imagen (bola cerrada) de la hoja de la Poké Ball.
        const img = await this.png(`graphics/balls/${BALLS[Number(rest[0])]}.png`);
        return encodePng(paint(img, img.palette, { w: 16, h: 16 }));
      }
      case 'badge': {
        // Medallas de Hoenn de la tarjeta de entrenador (16 × 16 cada una, con su paleta).
        const img = await this.png('graphics/trainer_card/badges.png');
        return encodePng(paint(img, img.palette, { sx: Number(rest[0]) * 16, w: 16, h: 16 }));
      }
      case 'wallpaper':
        return encodePng(await this.wallpaper(WALLPAPERS[Number(rest[0])]));
      case 'item': {
        const icons = await this.loadItemIcons();
        const entry = icons.get(Number(rest[0])) ?? icons.get(0);
        if (!entry) throw new AppError('NOT_FOUND', 'Objeto sin icono.');
        const icon = await this.png(entry[0]);
        const pal = parseJascPal(await this.text(entry[1]));
        return encodePng(paint(icon, pal));
      }
    }
    throw new AppError('NOT_FOUND', 'Recurso desconocido.');
  }

  /**
   * Fondo de caja: barra del nombre + caja (20 × 18 piezas). Las piezas son las
   * del marco seguidas de las del fondo; la paleta 1 es la del marco y la 2 la del fondo.
   */
  private async wallpaper(id: string) {
    const dir = `graphics/pokemon_storage/wallpapers/${id}`;
    const [frame, bg, map, counts] = await Promise.all([
      this.png(`${dir}/frame.png`),
      this.png(`${dir}/bg.png`),
      this.source.get(`${this.base}${dir}/tilemap.bin`),
      this.loadTileCounts(),
    ]);
    const frameCount = counts[id]?.frame ?? (frame.width / 8) * (frame.height / 8);
    const bgCount = counts[id]?.bg ?? (bg.width / 8) * (bg.height / 8);
    return composeTilemap16(
      map,
      20,
      [
        { sheet: frame, first: 0, count: frameCount },
        { sheet: bg, first: frameCount, count: bgCount },
      ],
      { 1: frame.palette, 2: bg.palette },
    );
  }

  private loadItemIcons() {
    this.itemIcons ??= Promise.all([
      this.text('include/constants/items.h'),
      this.text('src/data/item_icon_table.h'),
      this.text('src/data/graphics/items.h'),
    ]).then(([c, t, g]) => parseItemIcons(c, t, g));
    this.itemIcons.catch(() => (this.itemIcons = null));
    return this.itemIcons;
  }

  private loadTileCounts() {
    this.tileCounts ??= this.text('graphics_file_rules.mk').then(parseWallpaperTileCounts);
    this.tileCounts.catch(() => (this.tileCounts = null));
    return this.tileCounts;
  }
}
