import type { Clock } from '../src/server/live.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, SpriteCache, type ImageStore, type JsonSource } from '../src/server/pokeapi.js';
import { PokedexService, type LocalTextSource } from '../src/server/pokedex.js';
import { loadProfiles } from '../src/server/profiles.js';
import type { SpanishTextSource, WikiDexEntries } from '../src/server/wikidex.js';
import { parseWikiDexPage } from '../src/server/wikidexParse.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'pokeapi');
export const API = 'https://pokeapi.co/api/v2';

/** Respuestas reales de PokéAPI guardadas con scripts/fetch-fixtures.mjs. */
export class FixtureSource implements JsonSource {
  calls: string[] = [];
  delayMs = 0;
  async getJson<T>(url: string): Promise<T> {
    this.calls.push(url);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const rel = url.slice(API.length + 1).replace(/\/$/, '').replace(/\//g, '_');
    const file = path.join(FIXTURES, `${rel}.json`);
    if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 'El recurso no existe en PokéAPI.', url);
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  }
}

export class FakeImages implements ImageStore {
  failing = new Set<string>();
  async ensure(url: string): Promise<string> {
    if ([...this.failing].some((f) => url.includes(f))) throw new AppError('NETWORK', 'Sin conexión.', url);
    return SpriteCache.localUrl(url);
  }
}

export class MemoryTexts implements LocalTextSource {
  data: Record<string, Record<number, { text: string; source?: string }>> = {};
  get(profileId: string, speciesId: number) {
    return { text: this.data[profileId]?.[speciesId] };
  }
}

const WIKIDEX_FILES: Record<string, string> = {
  Pikachu: 'Pikachu',
  Eevee: 'Eevee',
  'Nidoran♀': 'Nidoran-hembra',
  Wormadam: 'Wormadam',
  Turtwig: 'Turtwig',
};

export function wikidexFixture(title: string): string | null {
  const name = WIKIDEX_FILES[title];
  return name ? fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'wikidex', `${name}.wikitext`), 'utf8') : null;
}

/** WikiDex simulado con secciones reales guardadas; el resto de páginas "no existen". */
export class FixtureWikiDex implements SpanishTextSource {
  calls: string[] = [];
  offline = false;
  async entries(title: string): Promise<WikiDexEntries | null> {
    this.calls.push(title);
    if (this.offline) throw new Error('sin conexión');
    const text = wikidexFixture(title);
    return text ? parseWikiDexPage(text) : null;
  }
}

export function makeService() {
  const api = new FixtureSource();
  const images = new FakeImages();
  const texts = new MemoryTexts();
  const wikidex = new FixtureWikiDex();
  const service = new PokedexService(api, images, texts, API, loadProfiles(path.join(ROOT, 'profiles')), wikidex);
  return { service, api, images, texts, wikidex };
}

/** Reloj manual: el tiempo solo avanza con advance(). */
export class FakeClock implements Clock {
  t = 1_000_000;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers.delete(h as number);
  }
  get pending() {
    return this.timers.size;
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
  }
}
