// Dibuja el icono de la aplicación (una Poké Ball de 256 × 256) en build/icon.png.
// Uso: node scripts/make-icon.mjs   (solo hace falta al cambiar el diseño)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 256;
const png = new PNG({ width: S, height: S });
const c = S / 2;
const R = 120; // radio exterior
const LINE = 14; // grosor del borde y de la franja
const BTN = 34; // radio del botón (con su borde)

const INK = [24, 24, 28];
const RED = [222, 48, 48];
const RED_DARK = [170, 30, 36];
const WHITE = [244, 244, 240];
const WHITE_DARK = [206, 208, 212];

// Supermuestreo 4 × 4 para bordes suaves.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4 - c;
        const py = y + (sy + 0.5) / 4 - c;
        const d = Math.hypot(px, py);
        if (d > R) continue;
        let col;
        if (d > R - LINE || (Math.abs(py) < LINE / 2 && d > BTN - 4)) col = INK;
        else if (d < BTN - 14) col = WHITE;
        else if (d < BTN) col = INK;
        else {
          // Sombra en media luna abajo a la derecha, como la luz de arriba a la izquierda.
          const shade = Math.hypot(px + 30, py + 30) > R * 1.08;
          col = py < 0 ? (shade ? RED_DARK : RED) : shade ? WHITE_DARK : WHITE;
        }
        r += col[0];
        g += col[1];
        b += col[2];
        a += 1;
      }
    }
    const i = (y * S + x) * 4;
    png.data[i] = a ? r / a : 0;
    png.data[i + 1] = a ? g / a : 0;
    png.data[i + 2] = a ? b / a : 0;
    png.data[i + 3] = Math.round((a / 16) * 255);
  }
}

fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), PNG.sync.write(png));
console.log('build/icon.png');
