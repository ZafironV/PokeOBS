// Gráficos de GBA: lectura de PNG indexados (como los guarda pokeemerald),
// paletas y composición de imágenes por piezas de 8 × 8 píxeles. Funciones puras.
import zlib from 'node:zlib';
import { PNG } from 'pngjs';

export type Rgba = [number, number, number, number];

/** Imagen con un índice de paleta por píxel. */
export interface IndexedImage {
  width: number;
  height: number;
  indices: Uint8Array;
  palette: Rgba[];
}

/** Lee un PNG de paleta (tipo de color 3, 1–8 bits por píxel, sin entrelazado). */
export function decodeIndexedPng(buf: Buffer): IndexedImage {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
  let width = 0;
  let height = 0;
  let depth = 0;
  let palette: Rgba[] = [];
  const idat: Buffer[] = [];
  let alpha: Buffer | null = null;
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      if (data[9] !== 3) throw new Error('el PNG no es de paleta');
      if (data[12] !== 0) throw new Error('PNG entrelazado no admitido');
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2], 255]);
    } else if (type === 'tRNS') {
      alpha = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    o += 12 + len;
  }
  if (alpha) alpha.forEach((a, i) => palette[i] && (palette[i][3] = a));
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * depth) / 8);
  const rows = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? out[x - 1] : 0; // bytes por píxel = 1 con ≤ 8 bits
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
    prev = out;
  }
  const indices = new Uint8Array(width * height);
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = rows[y * stride + Math.floor(x / perByte)];
      const shift = 8 - depth * ((x % perByte) + 1);
      indices[y * width + x] = (byte >> shift) & mask;
    }
  }
  return { width, height, indices, palette };
}

/** Paleta JASC-PAL (formato de los .pal de pokeemerald). */
export function parseJascPal(text: string): Rgba[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines[0] !== 'JASC-PAL') throw new Error('paleta no JASC');
  const n = Number(lines[2]);
  return lines.slice(3, 3 + n).map((l) => {
    const [r, g, b] = l.trim().split(/\s+/).map(Number);
    return [r, g, b, 255];
  });
}

/** Imagen RGBA lista para codificar como PNG. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Buffer;
}

export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

/**
 * Pinta una imagen indexada (o un trozo) con una paleta. transparent0: el índice
 * 0 es transparente, como en los sprites y fondos de GBA.
 */
export function paint(
  src: IndexedImage,
  palette: Rgba[],
  opts: { sx?: number; sy?: number; w?: number; h?: number; transparent0?: boolean } = {},
): RgbaImage {
  const { sx = 0, sy = 0, w = src.width, h = src.height, transparent0 = true } = opts;
  const out = blankImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = src.indices[(sy + y) * src.width + sx + x];
      if (idx === 0 && transparent0) continue;
      const c = palette[idx] ?? [0, 0, 0, 0];
      out.data.set(c, (y * w + x) * 4);
    }
  }
  return out;
}

/** Pieza n.º `tile` (8 × 8) de una hoja, recorrida por filas. */
function tileOrigin(sheet: IndexedImage, tile: number): [number, number] {
  const perRow = sheet.width / 8;
  return [(tile % perRow) * 8, Math.floor(tile / perRow) * 8];
}

export interface TileSource {
  sheet: IndexedImage;
  /** Primera pieza de esta hoja en la numeración del mapa de piezas. */
  first: number;
  count: number;
}

/**
 * Compone un mapa de piezas de 16 bits de GBA (pieza en los bits 0–9, volteo
 * horizontal 10, vertical 11, paleta 12–15). Las piezas pueden venir de varias
 * hojas concatenadas (p. ej. marco + fondo de las cajas del PC).
 */
export function composeTilemap16(
  map: Buffer,
  cols: number,
  sources: TileSource[],
  palettes: Record<number, Rgba[]>,
): RgbaImage {
  const n = map.length / 2;
  const rows = Math.ceil(n / cols);
  const out = blankImage(cols * 8, rows * 8);
  for (let i = 0; i < n; i++) {
    const e = map.readUInt16LE(i * 2);
    const tile = e & 0x3ff;
    const src = sources.find((s) => tile >= s.first && tile < s.first + s.count);
    const pal = palettes[e >> 12];
    if (!src || !pal) continue;
    const [sx, sy] = tileOrigin(src.sheet, tile - src.first);
    const tx = (i % cols) * 8;
    const ty = Math.floor(i / cols) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const px = e & 0x400 ? 7 - x : x;
        const py = e & 0x800 ? 7 - y : y;
        const idx = src.sheet.indices[(sy + py) * src.sheet.width + sx + px];
        if (idx === 0) continue;
        out.data.set(pal[idx] ?? [0, 0, 0, 0], ((ty + y) * out.width + tx + x) * 4);
      }
    }
  }
  return out;
}

/** Compone un mapa de piezas de 8 bits (fondo afín de 256 colores, como el mapa de Hoenn). */
export function composeTilemap8(map: Buffer, cols: number, sheet: IndexedImage, crop?: { w: number; h: number }): RgbaImage {
  const w = crop?.w ?? cols;
  const h = crop?.h ?? Math.ceil(map.length / cols);
  const out = blankImage(w * 8, h * 8);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const [sx, sy] = tileOrigin(sheet, map[ty * cols + tx]);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const idx = sheet.indices[(sy + y) * sheet.width + sx + x];
          out.data.set(sheet.palette[idx] ?? [0, 0, 0, 255], ((ty * 8 + y) * out.width + tx * 8 + x) * 4);
        }
      }
    }
  }
  return out;
}

export function encodePng(img: RgbaImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png);
}
