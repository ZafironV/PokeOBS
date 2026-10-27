import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/server.js y src/server/config.ts están ambos a dos niveles o menos de la raíz:
// se busca la raíz subiendo hasta encontrar package.json.
import fs from 'node:fs';

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export const ROOT = process.env.POKEOBS_ROOT ?? findRoot(path.dirname(fileURLToPath(import.meta.url)));

export const config = {
  host: process.env.POKEOBS_HOST ?? '127.0.0.1',
  port: Number(process.env.POKEOBS_PORT ?? 4520),
  profilesDir: path.join(ROOT, 'profiles'),
  textsDir: path.join(ROOT, 'texts'),
  publicDir: path.join(ROOT, 'public'),
  dataDir: process.env.POKEOBS_DATA ?? path.join(ROOT, 'data'),
  apiBase: 'https://pokeapi.co/api/v2',
  spriteBase: 'https://raw.githubusercontent.com/PokeAPI/sprites/',
  userAgent: 'PokeOBS/1.0 (overlay local para OBS; cache persistente)',
};
