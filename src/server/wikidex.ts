import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseWikiDexPage, type WikiDexEntry } from './wikidexParse.js';

export type WikiDexEntries = Record<string, WikiDexEntry>;

export interface SpanishTextSource {
  /** Entradas de Pokédex en español de la página de WikiDex del Pokémon, o null si no hay. */
  entries(title: string): Promise<WikiDexEntries | null>;
}

const API = 'https://www.wikidex.net/api.php';

/**
 * Textos oficiales en español transcritos en WikiDex (wikidex.net).
 * Solo se pide la página del Pokémon seleccionado, de una en una, y el
 * resultado (ya analizado) se guarda para siempre en data/cache/wikidex.
 * También se guarda que una página no existe, para no volver a pedirla.
 */
export class WikiDexClient implements SpanishTextSource {
  private dir: string;
  private memory = new Map<string, WikiDexEntries | null>();
  private inflight = new Map<string, Promise<WikiDexEntries | null>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(cacheDir: string, private userAgent: string) {
    this.dir = path.join(cacheDir, 'wikidex');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(title: string) {
    return path.join(this.dir, `${crypto.createHash('sha1').update(title).digest('hex')}.json`);
  }

  async entries(title: string): Promise<WikiDexEntries | null> {
    if (this.memory.has(title)) return this.memory.get(title)!;
    try {
      const stored = JSON.parse(fs.readFileSync(this.file(title), 'utf8'));
      this.memory.set(title, stored.entries);
      return stored.entries;
    } catch {
      /* no está en caché */
    }
    const running = this.inflight.get(title);
    if (running) return running;
    // Una petición cada vez, para no cargar el servidor de WikiDex.
    const p = (this.queue = this.queue.then(() => this.download(title), () => this.download(title))) as Promise<
      WikiDexEntries | null
    >;
    this.inflight.set(title, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(title);
    }
  }

  private async download(title: string): Promise<WikiDexEntries | null> {
    const url = new URL(API);
    url.search = new URLSearchParams({
      action: 'parse',
      page: title,
      prop: 'wikitext',
      redirects: '1',
      format: 'json',
      formatversion: '2',
    }).toString();
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`WikiDex respondió ${res.status}`);
    const body = (await res.json()) as { parse?: { title: string; wikitext: string }; error?: { code: string } };
    let entries: WikiDexEntries | null = null;
    if (body.parse) entries = parseWikiDexPage(body.parse.wikitext);
    else if (body.error?.code !== 'missingtitle') throw new Error(`WikiDex: ${body.error?.code ?? 'respuesta inesperada'}`);
    this.memory.set(title, entries);
    const tmp = `${this.file(title)}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ title, page: body.parse?.title ?? null, fetchedAt: new Date().toISOString(), entries }),
    );
    fs.renameSync(tmp, this.file(title));
    return entries;
  }
}
