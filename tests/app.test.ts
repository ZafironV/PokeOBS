import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/server/app.js';
import { SpriteCache } from '../src/server/pokeapi.js';
import { SettingsStore } from '../src/server/settings.js';
import type { ServerMessage } from '../src/shared/types.js';
import { makeService } from './helpers.js';

let server: http.Server;
let base: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-test-'));
  const { service } = makeService();
  const app = createApp({
    service,
    sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
    settings: new SettingsStore(dataDir, ['red', 'emerald']),
    publicDir: path.join(dataDir, 'public'),
    localOnly: true,
    readyTimeoutMs: 2000,
  });
  server = app.server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Cliente WebSocket de prueba que guarda los mensajes recibidos. */
async function client(role: 'control' | 'overlay', origin?: string) {
  const ws = new WebSocket(`ws://${base}/ws`, origin ? { origin } : {});
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => {
    inbox.push(JSON.parse(String(d)));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', role }));
  const waitFor = async <T extends ServerMessage['type']>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeout = 3000,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    const deadline = Date.now() + timeout;
    let seen = 0;
    for (;;) {
      for (; seen < inbox.length; seen++) {
        const m = inbox[seen];
        if (m.type === type && pred(m as any)) {
          inbox.splice(0, seen + 1);
          return m as any;
        }
      }
      if (Date.now() > deadline) throw new Error(`Timeout esperando ${type}; recibido: ${JSON.stringify(inbox)}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, inbox, waitFor, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

function get(p: string, host = base) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const [h, port] = base.split(':');
    http
      .get({ host: h, port, path: p, headers: { Host: host } }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve({ status: res.statusCode!, body: s.startsWith('{') || s.startsWith('[') ? JSON.parse(s) : s }));
      })
      .on('error', reject);
  });
}

describe('servidor', () => {
  it('flujo completo: mostrar, reconectar, ocultar', async () => {
    const control = await client('control');
    await control.waitFor('status');
    const a = await client('overlay');
    await a.waitFor('settings');
    await a.waitFor('hide'); // estado inicial: nada en pantalla

    control.send({
      type: 'show',
      request: { gameId: 'red', catalogMode: 'regional', spriteMode: 'game', speciesId: 133, durationSec: 5 },
    });
    const prep = await a.waitFor('prepare');
    expect(prep.cards[0].name).toBe('Eevee');
    expect(prep.cards[0].family[0].children).toHaveLength(3);
    a.send({ type: 'ready', seq: prep.seq, overflow: false });
    const shown = await a.waitFor('show');
    expect(shown.remainingMs).toBe(5000);
    const st = await control.waitFor('status', (m) => m.status.phase === 'live');
    expect(st.status).toMatchObject({ liveName: 'Eevee', overlays: 1, confirmedByOverlay: true });

    // Un overlay que se conecta tarde recibe el tiempo restante, no el total.
    await new Promise((r) => setTimeout(r, 300));
    const b = await client('overlay');
    const late = await b.waitFor('show');
    expect(late.seq).toBe(shown.seq);
    expect(late.remainingMs).toBeLessThan(4800);
    expect(late.remainingMs).toBeGreaterThan(3000);

    control.send({ type: 'hide' });
    await a.waitFor('hide');
    await b.waitFor('hide');

    // Tras ocultar, un overlay nuevo no recibe ninguna ficha.
    const c = await client('overlay');
    await c.waitFor('hide');
    await new Promise((r) => setTimeout(r, 100));
    expect(c.inbox.some((m) => m.type === 'show')).toBe(false);

    for (const x of [control, a, b, c]) x.ws.close();
  });

  it('los errores detallados van al panel, nunca al overlay', async () => {
    const control = await client('control');
    const overlay = await client('overlay');
    await overlay.waitFor('hide');
    control.send({
      type: 'show',
      request: { gameId: 'emerald', catalogMode: 'regional', spriteMode: 'game', speciesId: 133, durationSec: 5 },
    });
    const err = await control.waitFor('error');
    expect(err.error.code).toBe('OUT_OF_CATALOG');
    await new Promise((r) => setTimeout(r, 100));
    expect(overlay.inbox.some((m) => m.type === 'error' || m.type === 'prepare')).toBe(false);
    control.ws.close();
    overlay.ws.close();
  });

  it('un overlay no puede controlar el directo', async () => {
    const overlay = await client('overlay');
    await overlay.waitFor('hide');
    overlay.send({
      type: 'show',
      request: { gameId: 'red', catalogMode: 'regional', spriteMode: 'game', speciesId: 25, durationSec: 5 },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(overlay.inbox.some((m) => m.type === 'prepare')).toBe(false);
    overlay.ws.close();
  });

  it('las preferencias se guardan en disco y se difunden', async () => {
    const control = await client('control');
    const overlay = await client('overlay');
    await overlay.waitFor('settings');
    control.send({ type: 'settings', patch: { durationSec: 30, overlay: { scale: 1.5 } } });
    const s = await overlay.waitFor('settings', (m) => m.settings.durationSec === 30);
    expect(s.settings.overlay.scale).toBe(1.5);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    expect(saved.durationSec).toBe(30);
    control.ws.close();
    overlay.ws.close();
  });

  it('API REST: códigos de error comprensibles', async () => {
    expect((await get('/api/card?game=red&mode=regional&sprite=game&species=99999')).status).toBe(404);
    const out = await get('/api/card?game=red&mode=regional&sprite=game&species=183');
    expect(out.status).toBe(422);
    expect(out.body.error.message).toMatch(/Marill/);
    expect((await get('/api/card?game=red&mode=xx&sprite=game&species=1')).status).toBe(400);
    expect((await get('/api/catalog?game=emerald&mode=regional')).body.entries).toHaveLength(202);
  });

  it('solo acepta acceso local (Host y Origin)', async () => {
    expect((await get('/api/health', 'evil.example:80')).status).toBe(403);
    await expect(client('control', 'http://evil.example')).rejects.toBeTruthy();
    const ok = await client('control', `http://${base}`);
    ok.ws.close();
  });

  it('el proxy de imágenes solo admite el repositorio de sprites de PokéAPI', async () => {
    const r = await get(`/img?src=${encodeURIComponent('https://example.com/x.png')}`);
    expect(r.status).toBe(400);
  });
});
