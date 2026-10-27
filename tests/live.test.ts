import { describe, expect, it } from 'vitest';
import { LiveController } from '../src/server/live.js';
import type { Card, LiveStatus, ServerMessage, ShowRequest } from '../src/shared/types.js';
import { FakeClock } from './helpers.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

const card = (name: string) => ({ name }) as Card;
const req = (speciesId: number, durationSec = 15): ShowRequest => ({
  gameId: 'red',
  catalogMode: 'regional',
  spriteMode: 'game',
  textMode: 'es-aprox',
  speciesId,
  durationSec,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(overlays = 1) {
  const clock = new FakeClock();
  const sent: ServerMessage[] = [];
  const statuses: LiveStatus[] = [];
  const errors: unknown[] = [];
  const loads = new Map<number, ReturnType<typeof deferred<Card>>>();
  const state = { overlays };
  const live = new LiveController({
    buildCards: (r) => {
      const d = deferred<Card>();
      loads.set(r.speciesId, d);
      const partner = r.partnerSpeciesId;
      if (partner === undefined) return d.promise.then((c) => [c]);
      const p = deferred<Card>();
      loads.set(partner, p);
      return Promise.all([d.promise, p.promise]);
    },
    toOverlays: (m) => sent.push(m),
    onStatus: (s) => statuses.push(s),
    onError: (e) => errors.push(e),
    overlayCount: () => state.overlays,
    clock,
    readyTimeoutMs: 4000,
  });
  const last = (type: ServerMessage['type']) => [...sent].reverse().find((m) => m.type === type) as any;
  return { live, clock, sent, statuses, errors, loads, state, last };
}

describe('LiveController', () => {
  it('el temporizador empieza cuando el overlay confirma que la ficha está lista', async () => {
    const t = setup();
    void t.live.show(req(25, 10));
    expect(t.live.phase).toBe('loading');
    t.clock.advance(3000); // carga lenta: no consume tiempo de exposición
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    expect(t.live.phase).toBe('preparing');
    expect(t.last('prepare')).toMatchObject({ seq: 1 });
    t.clock.advance(500);
    t.live.overlayReady(1);
    expect(t.live.phase).toBe('live');
    expect(t.last('show')).toMatchObject({ seq: 1, remainingMs: 10000 });
    expect(t.live.status().confirmedByOverlay).toBe(true);
    t.clock.advance(9999);
    expect(t.live.phase).toBe('live');
    t.clock.advance(1);
    expect(t.live.phase).toBe('idle');
    expect(t.sent.at(-1)).toEqual({ type: 'hide', seq: 1 });
  });

  it('si el overlay no confirma, arranca tras el tiempo de espera', async () => {
    const t = setup();
    void t.live.show(req(25));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.clock.advance(4000);
    expect(t.live.phase).toBe('live');
    expect(t.live.status().confirmedByOverlay).toBe(false);
  });

  it('sin overlays conectados no espera confirmación', async () => {
    const t = setup(0);
    void t.live.show(req(25));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    expect(t.live.phase).toBe('live');
  });

  it('reemplazar una ficha reinicia el temporizador y cancela el anterior', async () => {
    const t = setup();
    void t.live.show(req(25, 10));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.overlayReady(1);
    t.clock.advance(8000);

    void t.live.show(req(133, 10));
    // Mientras carga la nueva, la anterior sigue visible con su tiempo.
    expect(t.live.status()).toMatchObject({ phase: 'loading', liveName: 'Pikachu', remainingMs: 2000 });
    t.loads.get(133)!.resolve(card('Eevee'));
    await flush();
    t.live.overlayReady(2);
    expect(t.last('show')).toMatchObject({ seq: 2, remainingMs: 10000 });
    t.clock.advance(5000); // aquí habría vencido el temporizador de Pikachu
    expect(t.live.status()).toMatchObject({ phase: 'live', liveName: 'Eevee', remainingMs: 5000 });
    expect(t.sent.filter((m) => m.type === 'hide')).toHaveLength(0);
    expect(t.clock.pending).toBe(1);
    t.clock.advance(5000);
    expect(t.live.phase).toBe('idle');
  });

  it('una petición lenta no sobrescribe una selección más reciente', async () => {
    const t = setup();
    void t.live.show(req(1));
    void t.live.show(req(4));
    t.loads.get(4)!.resolve(card('Charmander'));
    await flush();
    t.live.overlayReady(2);
    t.loads.get(1)!.resolve(card('Bulbasaur')); // llega tarde
    await flush();
    t.live.overlayReady(1);
    expect(t.live.status().liveName).toBe('Charmander');
    expect(t.sent.filter((m) => m.type === 'prepare' || m.type === 'show').every((m: any) => m.seq === 2)).toBe(true);
  });

  it('Ocultar funciona durante la carga y la ficha no aparece después', async () => {
    const t = setup();
    void t.live.show(req(25));
    t.live.hide();
    expect(t.live.phase).toBe('idle');
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.overlayReady(1);
    expect(t.live.phase).toBe('idle');
    expect(t.sent.some((m) => m.type === 'show' || m.type === 'prepare')).toBe(false);
  });

  it('Ocultar durante la preparación cancela la espera del overlay', async () => {
    const t = setup();
    void t.live.show(req(25));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.hide();
    t.clock.advance(10000);
    expect(t.live.phase).toBe('idle');
    expect(t.sent.some((m) => m.type === 'show')).toBe(false);
    expect(t.clock.pending).toBe(0);
  });

  it('Ocultar en directo cancela el temporizador', async () => {
    const t = setup();
    void t.live.show(req(25));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.overlayReady(1);
    t.live.hide();
    expect(t.clock.pending).toBe(0);
    expect(t.sent.at(-1)).toMatchObject({ type: 'hide' });
  });

  it('un overlay que se reconecta recibe la ficha vigente con el tiempo restante', async () => {
    const t = setup();
    void t.live.show(req(25, 20));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.overlayReady(1);
    t.clock.advance(12000);
    expect(t.live.snapshotForOverlay()).toEqual([
      { type: 'show', seq: 1, cards: [card('Pikachu')], remainingMs: 8000 },
    ]);
  });

  it('no vuelve a mostrar una ficha cuyo tiempo ya terminó', async () => {
    const t = setup();
    void t.live.show(req(25, 5));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.overlayReady(1);
    t.clock.advance(6000);
    expect(t.live.snapshotForOverlay()).toEqual([{ type: 'hide', seq: 1 }]);
  });

  it('un overlay que conecta durante la preparación recibe la ficha pendiente', async () => {
    const t = setup();
    void t.live.show(req(25));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    const snap = t.live.snapshotForOverlay();
    expect(snap.map((m) => m.type)).toEqual(['hide', 'prepare']);
  });

  it('un combate doble envía las dos tarjetas, la nueva delante', async () => {
    const t = setup();
    void t.live.show({ ...req(263), partnerSpeciesId: 261 });
    t.loads.get(263)!.resolve(card('Zigzagoon'));
    t.loads.get(261)!.resolve(card('Poochyena'));
    await flush();
    expect(t.last('prepare').cards.map((c: Card) => c.name)).toEqual(['Zigzagoon', 'Poochyena']);
    t.live.overlayReady(1);
    expect(t.last('show').cards).toHaveLength(2);
    expect(t.live.status().liveName).toBe('Zigzagoon y Poochyena');
  });

  it('un error de carga se comunica al panel y no altera la ficha visible', async () => {
    const t = setup();
    void t.live.show(req(25));
    t.loads.get(25)!.resolve(card('Pikachu'));
    await flush();
    t.live.overlayReady(1);
    void t.live.show(req(9999));
    t.loads.get(9999)!.reject(new Error('404'));
    await flush();
    expect(t.errors).toHaveLength(1);
    expect(t.live.status()).toMatchObject({ phase: 'live', liveName: 'Pikachu' });
  });
});
