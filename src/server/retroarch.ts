import dgram from 'node:dgram';

/** RetroArch respondió, pero rechazó la lectura (sin juego cargado, dirección no mapeada…). */
export class MemoryReadError extends Error {}
/** RetroArch no respondió a tiempo (cerrado o con los comandos de red desactivados). */
export class NoResponseError extends Error {}

export interface MemoryReader {
  /** Versión de RetroArch; lanza NoResponseError si no contesta. */
  version(): Promise<string>;
  /** Estado: "PLAYING game_gba,<nombre>,crc32=…", "PAUSED …" o "CONTENTLESS". */
  status(): Promise<string>;
  read(address: number, length: number): Promise<Buffer>;
  close(): void;
  /** Consultas respondidas y latencia acumulada desde la última llamada. */
  takeStats(): { queries: number; latencyMs: number };
}

/**
 * Comandos de red de RetroArch (UDP, solo 127.0.0.1). Una consulta cada vez:
 * la siguiente espera a que la anterior responda o caduque.
 */
export class RetroArchClient implements MemoryReader {
  private sock: dgram.Socket;
  private waiting: { accept: (text: string) => boolean; resolve: (t: string) => void; timer: NodeJS.Timeout } | null =
    null;
  private queue: Promise<unknown> = Promise.resolve();
  private queries = 0;
  private latencyMs = 0;

  constructor(
    private port: number,
    private host = '127.0.0.1',
    private timeoutMs = 400,
  ) {
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (buf) => {
      const text = buf.toString('latin1').trim();
      const w = this.waiting;
      if (w && w.accept(text)) {
        clearTimeout(w.timer);
        this.waiting = null;
        w.resolve(text);
      }
    });
    this.sock.on('error', () => {
      /* p. ej. ICMP "puerto inalcanzable": se trata como falta de respuesta */
    });
    // Solo en la interfaz local: sin esto, Node abriría el puerto de respuesta en todas las interfaces.
    this.sock.bind(0, '127.0.0.1');
    this.sock.unref();
  }

  private command(cmd: string, accept: (text: string) => boolean): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const started = performance.now();
        this.waiting = {
          accept,
          resolve: (t) => {
            this.queries++;
            this.latencyMs += performance.now() - started;
            resolve(t);
          },
          timer: setTimeout(() => {
            this.waiting = null;
            reject(new NoResponseError(`Sin respuesta a ${cmd.split(' ')[0]}`));
          }, this.timeoutMs),
        };
        this.sock.send(`${cmd}\n`, this.port, this.host, (err) => {
          if (err && this.waiting) {
            clearTimeout(this.waiting.timer);
            this.waiting = null;
            reject(new NoResponseError(err.message));
          }
        });
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async version(): Promise<string> {
    // RetroArch responde solo con el número de versión, sin prefijo.
    return this.command('VERSION', (t) => /^\d+\.\d+/.test(t));
  }

  async status(): Promise<string> {
    const t = await this.command('GET_STATUS', (t) => t.startsWith('GET_STATUS'));
    return t.replace(/^GET_STATUS\s*/, '');
  }

  async read(address: number, length: number): Promise<Buffer> {
    const reply = await this.command(`READ_CORE_MEMORY ${address.toString(16)} ${length}`, (t) => {
      const [cmd, addr] = t.split(/\s+/);
      return cmd === 'READ_CORE_MEMORY' && parseInt(addr, 16) === address;
    });
    let parts = reply.split(/\s+/).slice(2);
    if (parts[0] === '-1') throw new MemoryReadError(parts.slice(1).join(' ') || 'lectura rechazada');
    // Las versiones recientes añaden "TRUNCATED <n>" si la región era más corta.
    const cut = parts.indexOf('TRUNCATED');
    if (cut >= 0) parts = parts.slice(0, cut);
    const buf = Buffer.from(parts.map((p) => parseInt(p, 16)));
    if (buf.length < length) throw new MemoryReadError(`se pidieron ${length} bytes y llegaron ${buf.length}`);
    return buf;
  }

  takeStats() {
    const s = { queries: this.queries, latencyMs: this.latencyMs };
    this.queries = 0;
    this.latencyMs = 0;
    return s;
  }

  close() {
    if (this.waiting) clearTimeout(this.waiting.timer);
    this.waiting = null;
    this.sock.close();
  }
}
