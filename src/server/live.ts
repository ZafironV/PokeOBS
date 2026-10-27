import type { Card, LivePhase, LiveStatus, ServerMessage, ShowRequest } from '../shared/types.js';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface LiveDeps {
  /** Una tarjeta por Pokémon: la primera va delante (dos en combates dobles). */
  buildCards(req: ShowRequest): Promise<Card[]>;
  /** Envía un mensaje a todos los overlays conectados. */
  toOverlays(msg: ServerMessage): void;
  /** Cambió el estado: se notifica a los paneles. */
  onStatus(status: LiveStatus): void;
  onError(err: unknown, req: ShowRequest): void;
  overlayCount(): number;
  clock?: Clock;
  /** Tiempo máximo esperando a que un overlay confirme que tiene la ficha lista. */
  readyTimeoutMs?: number;
}

interface Pending {
  seq: number;
  req: ShowRequest;
  phase: 'loading' | 'preparing';
  cards?: Card[];
  readyTimer?: unknown;
}

interface Live {
  seq: number;
  cards: Card[];
  endsAt: number;
  durationMs: number;
  timer: unknown;
  confirmed: boolean;
}

/**
 * Máquina de estados del directo.
 *
 * - Cada "Mostrar" u "Ocultar" incrementa `seq`; cualquier carga con un `seq`
 *   anterior se descarta al terminar, así una petición lenta nunca sobrescribe
 *   una selección más reciente ni reaparece tras "Ocultar".
 * - El temporizador empieza cuando la ficha está lista: datos y sprites en la
 *   caché del servidor y confirmación de un overlay (o tiempo de espera agotado).
 * - La ficha anterior sigue visible mientras carga la nueva y se reemplaza al
 *   estar lista; su temporizador se cancela en ese momento.
 */
export class LiveController {
  private seq = 0;
  private pending: Pending | null = null;
  private live: Live | null = null;
  private clock: Clock;
  private readyTimeoutMs: number;

  constructor(private deps: LiveDeps) {
    this.clock = deps.clock ?? realClock;
    this.readyTimeoutMs = deps.readyTimeoutMs ?? 4000;
  }

  get phase(): LivePhase {
    if (this.pending) return this.pending.phase;
    return this.live ? 'live' : 'idle';
  }

  status(): LiveStatus {
    const remainingMs = this.live ? Math.max(0, this.live.endsAt - this.clock.now()) : 0;
    return {
      phase: this.phase,
      liveName: this.live ? names(this.live.cards) : null,
      pendingName: this.pending?.cards ? names(this.pending.cards) : null,
      remainingMs,
      durationMs: this.live?.durationMs ?? 0,
      overlays: this.deps.overlayCount(),
      confirmedByOverlay: this.live ? this.live.confirmed : null,
    };
  }

  private notify() {
    this.deps.onStatus(this.status());
  }

  async show(req: ShowRequest): Promise<void> {
    const seq = ++this.seq;
    this.clearPending();
    this.pending = { seq, req, phase: 'loading' };
    this.notify();

    let cards: Card[];
    try {
      cards = await this.deps.buildCards(req);
    } catch (err) {
      if (this.pending?.seq === seq) {
        this.pending = null;
        this.deps.onError(err, req);
        this.notify();
      }
      return;
    }
    if (this.pending?.seq !== seq) return; // reemplazada u ocultada mientras cargaba

    this.pending.phase = 'preparing';
    this.pending.cards = cards;
    if (this.deps.overlayCount() === 0) {
      this.goLive(seq, false);
      return;
    }
    this.deps.toOverlays({ type: 'prepare', seq, cards });
    this.pending.readyTimer = this.clock.setTimeout(() => this.goLive(seq, false), this.readyTimeoutMs);
    this.notify();
  }

  /** Un overlay confirma que ha precargado la ficha `seq`. */
  overlayReady(seq: number): void {
    if (this.pending?.seq === seq && this.pending.phase === 'preparing') this.goLive(seq, true);
  }

  private goLive(seq: number, confirmed: boolean) {
    const p = this.pending;
    if (!p || p.seq !== seq || !p.cards) return;
    this.clearPending();
    this.clearLive();
    const durationMs = Math.round(p.req.durationSec * 1000);
    const live: Live = {
      seq,
      cards: p.cards,
      durationMs,
      endsAt: this.clock.now() + durationMs,
      confirmed,
      timer: this.clock.setTimeout(() => this.expire(seq), durationMs),
    };
    this.live = live;
    this.deps.toOverlays({ type: 'show', seq, cards: live.cards, remainingMs: durationMs });
    this.notify();
  }

  private expire(seq: number) {
    if (this.live?.seq !== seq) return;
    this.live = null;
    this.deps.toOverlays({ type: 'hide', seq });
    this.notify();
  }

  hide(): void {
    const seq = ++this.seq;
    this.clearPending();
    this.clearLive();
    this.deps.toOverlays({ type: 'hide', seq });
    this.notify();
  }

  /** Mensajes para un overlay que acaba de conectarse (o reconectarse). */
  snapshotForOverlay(): ServerMessage[] {
    const msgs: ServerMessage[] = [];
    const remainingMs = this.live ? this.live.endsAt - this.clock.now() : 0;
    if (this.live && remainingMs > 0) {
      msgs.push({ type: 'show', seq: this.live.seq, cards: this.live.cards, remainingMs });
    } else {
      msgs.push({ type: 'hide', seq: this.seq });
    }
    if (this.pending?.phase === 'preparing' && this.pending.cards) {
      msgs.push({ type: 'prepare', seq: this.pending.seq, cards: this.pending.cards });
    }
    return msgs;
  }

  private clearPending() {
    if (this.pending?.readyTimer !== undefined) this.clock.clearTimeout(this.pending.readyTimer);
    this.pending = null;
  }

  private clearLive() {
    if (this.live) this.clock.clearTimeout(this.live.timer);
    this.live = null;
  }
}

const names = (cards: Card[]) => cards.map((c) => c.name).join(' y ');
