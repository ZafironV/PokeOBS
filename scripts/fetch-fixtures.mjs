// Descarga respuestas reales de PokéAPI para las pruebas automatizadas (tests/fixtures).
// Se eliminan campos voluminosos que las pruebas no usan (movimientos, índices de juego).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests', 'fixtures', 'pokeapi');
const API = 'https://pokeapi.co/api/v2/';
// Hasta la Gen. VII (Let's Go): cubre todos los perfiles incluidos.
const MAX_SPECIES = 809;
// Especies con casos interesantes: ramas, preevoluciones posteriores, tipos históricos.
const SPECIES = [25, 35, 39, 44, 60, 79, 81, 133, 183, 265, 1, 808, 387, 494, 439, 29, 413];

fs.mkdirSync(dir, { recursive: true });
const fileFor = (url) => path.join(dir, `${url.slice(API.length).replace(/\/$/, '').replace(/\//g, '_')}.json`);

async function get(url) {
  const file = fileFor(url);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url, { headers: { 'User-Agent': 'PokeOBS fixtures' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const body = await res.json();
  delete body.moves;
  delete body.game_indices;
  delete body.held_items;
  delete body.location_area_encounters;
  delete body.genera;
  if (body.pokemon_entries && url.includes('/national/')) {
    body.pokemon_entries = body.pokemon_entries.filter((e) => e.entry_number <= MAX_SPECIES + 1);
  }
  fs.writeFileSync(file, JSON.stringify(body));
  return body;
}

const idOf = (url) => Number(/\/(\d+)\/?$/.exec(url)[1]);
const walk = (link, out) => {
  out.push(idOf(link.species.url));
  link.evolves_to.forEach((c) => walk(c, out));
  return out;
};

const POKEDEXES = ['kanto', 'hoenn', 'national', 'original-johto', 'updated-johto', 'updated-hoenn', 'letsgo-kanto', 'original-sinnoh', 'extended-sinnoh', 'original-unova', 'updated-unova'];
for (const p of POKEDEXES) await get(`${API}pokedex/${p}/`);
const done = new Set();
for (const id of SPECIES) {
  const sp = await get(`${API}pokemon-species/${id}/`);
  const chain = await get(sp.evolution_chain.url);
  for (const member of walk(chain.chain, [])) {
    if (member > MAX_SPECIES || done.has(member)) continue;
    done.add(member);
    const msp = await get(`${API}pokemon-species/${member}/`);
    await get(msp.varieties.find((v) => v.is_default).pokemon.url);
  }
}
console.log(`Fixtures en ${dir}: ${fs.readdirSync(dir).length} archivos`);
