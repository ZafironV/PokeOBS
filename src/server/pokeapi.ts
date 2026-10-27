import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class AppError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'OUT_OF_CATALOG' | 'NETWORK' | 'INVALID' | 'INTERNAL',
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

/** Interfaz mínima que usan los servicios; en las pruebas se sustituye por fixtures. */
export interface JsonSource {
  getJson<T = any>(url: string): Promise<T>;
  /** Devuelve el JSON solo si ya está en caché (sin red). */
  peekJson?<T = any>(url: string): T | undefined;
}

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

/** Limita las peticiones simultáneas para respetar la política de uso justo de PokéAPI. */
class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

async function fetchWithRetry(url: string, userAgent: string, accept: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: accept },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status >= 500 && attempt === 0) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new AppError(
    'NETWORK',
    'No se pudo contactar con PokéAPI. Revisa la conexión a Internet.',
    `${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * Cliente HTTP con caché persistente en disco. Los datos de PokéAPI son
 * prácticamente estáticos, así que una respuesta guardada se reutiliza
 * indefinidamente (borra data/cache para forzar una recarga).
 */
export class PokeApiClient implements JsonSource {
  private memory = new Map<string, unknown>();
  private inflight = new Map<string, Promise<unknown>>();
  private limiter = new Limiter(4);
  private dir: string;

  constructor(cacheDir: string, private userAgent: string) {
    this.dir = path.join(cacheDir, 'api');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(url: string) {
    return path.join(this.dir, `${hash(url)}.json`);
  }

  peekJson<T>(url: string): T | undefined {
    if (this.memory.has(url)) return this.memory.get(url) as T;
    try {
      const stored = JSON.parse(fs.readFileSync(this.file(url), 'utf8'));
      this.memory.set(url, stored.body);
      return stored.body as T;
    } catch {
      return undefined;
    }
  }

  async getJson<T>(url: string): Promise<T> {
    const cached = this.peekJson<T>(url);
    if (cached !== undefined) return cached;
    const running = this.inflight.get(url);
    if (running) return running as Promise<T>;
    const p = this.limiter
      .run(async () => {
        const res = await fetchWithRetry(url, this.userAgent, 'application/json');
        if (res.status === 404) throw new AppError('NOT_FOUND', 'El recurso no existe en PokéAPI.', url);
        if (!res.ok) throw new AppError('NETWORK', `PokéAPI respondió con un error (${res.status}).`, url);
        const body = await res.json();
        this.memory.set(url, body);
        const tmp = `${this.file(url)}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
        fs.renameSync(tmp, this.file(url));
        return body as T;
      })
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }

  /** Texto (p. ej. las tablas CSV de PokéAPI) con la misma caché persistente. */
  async getText(url: string): Promise<string> {
    const cached = this.peekJson<string>(url);
    if (typeof cached === 'string') return cached;
    const res = await this.limiter.run(() => fetchWithRetry(url, this.userAgent, 'text/plain'));
    if (!res.ok) throw new AppError('NETWORK', `No se pudo descargar ${path.basename(url)} (${res.status}).`, url);
    const body = await res.text();
    this.memory.set(url, body);
    const tmp = `${this.file(url)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
    fs.renameSync(tmp, this.file(url));
    return body;
  }
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface ImageStore {
  /** Descarga (si hace falta) y devuelve la URL local que sirve la imagen. */
  ensure(remoteUrl: string): Promise<string>;
}

/** Caché persistente de sprites; solo admite el repositorio oficial de sprites de PokéAPI. */
export class SpriteCache implements ImageStore {
  private dir: string;
  private inflight = new Map<string, Promise<string>>();
  private limiter = new Limiter(4);

  constructor(cacheDir: string, private allowedPrefix: string, private userAgent: string) {
    this.dir = path.join(cacheDir, 'img');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  isAllowed(url: string): boolean {
    return url.startsWith(this.allowedPrefix) && !url.includes('..');
  }

  localPath(remoteUrl: string): { file: string; type: string } | null {
    const ext = path.extname(new URL(remoteUrl).pathname).toLowerCase();
    const type = IMAGE_TYPES[ext];
    if (!type) return null;
    return { file: path.join(this.dir, `${hash(remoteUrl)}${ext}`), type };
  }

  static localUrl(remoteUrl: string): string {
    return `/img?src=${encodeURIComponent(remoteUrl)}`;
  }

  async ensure(remoteUrl: string): Promise<string> {
    if (!this.isAllowed(remoteUrl)) throw new AppError('INVALID', 'Origen de imagen no permitido.', remoteUrl);
    const target = this.localPath(remoteUrl);
    if (!target) throw new AppError('INVALID', 'Formato de imagen no admitido.', remoteUrl);
    if (fs.existsSync(target.file)) return SpriteCache.localUrl(remoteUrl);
    const running = this.inflight.get(remoteUrl);
    if (running) return running;
    const p = this.limiter
      .run(async () => {
        const res = await fetchWithRetry(remoteUrl, this.userAgent, 'image/*');
        if (res.status === 404) throw new AppError('NOT_FOUND', 'El sprite no existe en el repositorio.', remoteUrl);
        if (!res.ok) throw new AppError('NETWORK', `No se pudo descargar el sprite (${res.status}).`, remoteUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmp = `${target.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, target.file);
        return SpriteCache.localUrl(remoteUrl);
      })
      .finally(() => this.inflight.delete(remoteUrl));
    this.inflight.set(remoteUrl, p);
    return p;
  }
}
