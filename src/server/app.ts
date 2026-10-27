import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  Card,
  CatalogMode,
  ClientMessage,
  ErrorInfo,
  ServerMessage,
  ShowRequest,
  SpriteMode,
  TextMode,
} from '../shared/types.js';
import { AutoDetector } from './autoDetect.js';
import { demoGame, demoLocation } from './demo.js';
import { GameHub } from './gameHub.js';
import type { GbaAssets } from './gbaAssets.js';
import type { ItemCatalog } from './items.js';
import { LiveController, type Clock } from './live.js';
import { AppError, SpriteCache } from './pokeapi.js';
import { RetroArchClient, type MemoryReader } from './retroarch.js';
import { SlotScheduler } from './slots.js';
import type { PokedexService } from './pokedex.js';
import { summarize } from './profiles.js';
import type { SettingsStore } from './settings.js';

export interface AppOptions {
  service: PokedexService;
  sprites: SpriteCache;
  settings: SettingsStore;
  publicDir: string;
  /** Si es true, solo se aceptan peticiones con Host/Origin locales (protección frente a DNS rebinding). */
  localOnly: boolean;
  clock?: Clock;
  readyTimeoutMs?: number;
  log?: (msg: string) => void;
  /** Conexión con el emulador para la detección automática (sustituible en las pruebas). */
  createReader?: (port: number) => MemoryReader;
  autoClock?: Clock;
  /** Comprobación de la regla temporal del firewall (solo en el arranque real). */
  firewallActive?: () => Promise<boolean | null>;
  /** Nombres e iconos de los objetos de la mochila (null para no descargarlos). */
  items?: ItemCatalog | null;
  /** Gráficos originales de Esmeralda (mapa, mochila, medallas, PC…); null para no servirlos. */
  gba?: GbaAssets | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

/** Overlays de la partida: comparten página; cada una enseña lo que indica su dirección. */
export const GAME_OVERLAYS = ['/equipo', '/medallas', '/mochila', '/pc', '/mapa'];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTS.has(host);
}

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof AppError) return { code: err.code, message: err.message, detail: err.detail };
  return { code: 'INTERNAL', message: 'Error interno inesperado.', detail: err instanceof Error ? err.stack : String(err) };
}

function statusFor(code: ErrorInfo['code']) {
  return { NOT_FOUND: 404, OUT_OF_CATALOG: 422, INVALID: 400, NETWORK: 502, INTERNAL: 500 }[code];
}

function parseMode(v: unknown): CatalogMode {
  if (v === 'regional' || v === 'national') return v;
  throw new AppError('INVALID', 'Modo de catálogo no válido.');
}

function parseTextMode(v: unknown): TextMode {
  if (v === undefined || v === null) return 'es-aprox';
  if (v === 'es-aprox' || v === 'es-exacto' || v === 'pokeapi') return v;
  throw new AppError('INVALID', 'Modo de textos no válido.');
}

function parseSprite(v: unknown): SpriteMode {
  if (v === 'game' || v === 'animated') return v;
  throw new AppError('INVALID', 'Modo de sprites no válido.');
}

export function validateShowRequest(r: any, gameIds: string[]): ShowRequest {
  if (!r || typeof r !== 'object') throw new AppError('INVALID', 'Petición vacía.');
  if (!gameIds.includes(r.gameId)) throw new AppError('INVALID', 'Juego desconocido.');
  const durationSec = Number(r.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < 5 || durationSec > 60) {
    throw new AppError('INVALID', 'La duración debe estar entre 5 y 60 segundos.');
  }
  const speciesId = Number(r.speciesId);
  if (!Number.isInteger(speciesId) || speciesId < 1) throw new AppError('INVALID', 'Pokémon no válido.');
  const req: ShowRequest = {
    gameId: r.gameId,
    catalogMode: parseMode(r.catalogMode),
    spriteMode: parseSprite(r.spriteMode),
    textMode: parseTextMode(r.textMode),
    speciesId,
    durationSec,
  };
  if (r.partnerSpeciesId !== undefined && r.partnerSpeciesId !== null) {
    const partner = Number(r.partnerSpeciesId);
    if (!Number.isInteger(partner) || partner < 1) throw new AppError('INVALID', 'Segundo Pokémon no válido.');
    req.partnerSpeciesId = partner;
  }
  return req;
}

export function createApp(opts: AppOptions) {
  const { service, sprites, settings, publicDir } = opts;
  const log = opts.log ?? (() => {});
  const gameIds = service.profiles.map((p) => p.id);
  const overlays = new Set<WebSocket>();
  const controls = new Set<WebSocket>();
  /** Overlays de la partida (/equipo, /medallas, /mochila, /pc y /mapa). */
  const teams = new Set<WebSocket>();
  /**
   * Vista previa del panel: reciben lo mismo que los overlays, pero no cuentan
   * como overlays de OBS ni confirman fichas. Con la partida de ejemplo activa,
   * solo ellas (y el panel) la reciben; el directo nunca.
   */
  const previewOverlays = new Set<WebSocket>();
  const previewTeams = new Set<WebSocket>();
  /** Vistas previas del editor de diseño: la partida real si la hay; si no, la de ejemplo. */
  const editorTeams = new Set<WebSocket>();
  let demo = false;
  let demoTimer: NodeJS.Timeout | null = null;

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const sendAll = (set: Set<WebSocket>, msg: ServerMessage) => set.forEach((ws) => send(ws, msg));

  /**
   * Las peticiones automáticas no fallan por el catálogo: un Pokémon fuera de la
   * Pokédex regional (p. ej. en el Frente Batalla) se muestra con la Nacional.
   */
  const buildOne = async (req: ShowRequest, speciesId: number): Promise<Card> => {
    let card: Card;
    try {
      card = await service.buildCard(req.gameId, req.catalogMode, req.spriteMode, speciesId, req.textMode);
    } catch (err) {
      const national = service.profiles.find((p) => p.id === req.gameId)?.nationalDex.available;
      if (!req.auto || req.catalogMode === 'national' || !national) throw err;
      if (!(err instanceof AppError) || err.code !== 'OUT_OF_CATALOG') throw err;
      card = await service.buildCard(req.gameId, 'national', req.spriteMode, speciesId, req.textMode);
    }
    return req.newSpeciesIds?.includes(speciesId) ? { ...card, isNew: true } : card;
  };

  const live = new LiveController({
    buildCards: (req) =>
      Promise.all([req.speciesId, req.partnerSpeciesId].filter((n): n is number => n !== undefined).map((n) => buildOne(req, n))),
    toOverlays: (msg) => {
      sendAll(overlays, msg);
      sendAll(previewOverlays, msg);
    },
    onStatus: (status) => {
      sendAll(controls, { type: 'status', status });
      // Con la ficha en pantalla, los demás elementos de su grupo de turnos se apartan.
      slots.setCardLive(status.phase === 'live' || status.phase === 'preparing');
    },
    onError: (err) => sendAll(controls, { type: 'error', error: toErrorInfo(err) }),
    overlayCount: () => overlays.size,
    clock: opts.clock,
    readyTimeoutMs: opts.readyTimeoutMs,
  });

  /**
   * Quién recibe cada partida:
   * - la real: los overlays de OBS (salvo durante una prueba), y el panel y la
   *   vista previa cuando no está activa la partida de ejemplo;
   * - la de ejemplo: el panel y la vista previa cuando está activa, y los overlays
   *   de OBS solo durante «Probar overlays en directo».
   */
  let testing: { endsAt: number; timer: NodeJS.Timeout } | null = null;
  const editorUsesDemo = () => demo || !!testing || !hub.hasData();
  const realAudience = () => [
    ...(testing ? [] : teams),
    ...(demo ? [] : controls),
    ...(demo || testing ? [] : previewTeams),
    ...(editorUsesDemo() ? [] : editorTeams),
  ];
  const demoAudience = () => [
    ...(testing ? teams : []),
    ...(demo ? controls : []),
    ...(demo || testing ? previewTeams : []),
    ...(editorUsesDemo() ? editorTeams : []),
  ];

  const hub = new GameHub({
    speciesBrief: (gameId, id) => service.speciesBrief(gameId, id),
    items: opts.items ?? null,
    settings: () => settings.current,
    broadcast: (msg) => {
      realAudience().forEach((ws) => send(ws, msg));
      if (msg.type === 'game' || msg.type === 'location') slots.dataChanged();
    },
    clock: opts.autoClock,
  });
  const demoHub = new GameHub({
    speciesBrief: (gameId, id) => service.speciesBrief(gameId, id),
    items: opts.items ?? null,
    settings: () => settings.current,
    broadcast: (msg) => {
      demoAudience().forEach((ws) => send(ws, msg));
      if (msg.type === 'game' || msg.type === 'location') slots.dataChanged();
    },
    clock: opts.autoClock,
  });
  const activeHub = () => (demo ? demoHub : hub);
  /** Partida que reciben los overlays de OBS y la vista previa. */
  const teamHub = (preview: boolean) => (testing || (preview && demo) ? demoHub : hub);

  /**
   * Turnos entre elementos (grupos del panel). Un turno se salta si su elemento
   * no tiene nada que enseñar en la partida que se está viendo.
   */
  const slots = new SlotScheduler({
    groups: () => settings.current.groups,
    available: (item) => (testing || demo ? demoHub : hub).hasContent(item),
    onChange: (state) => {
      for (const set of [teams, previewTeams, editorTeams, overlays, previewOverlays, controls]) sendAll(set, { type: 'slots', slots: state });
    },
    clock: opts.autoClock,
  });
  slots.reconfigure();

  /** La partida de ejemplo (con su paseo por el mapa) funciona mientras la usa alguien. */
  function syncDemoData() {
    const needed = demo || !!testing || (editorTeams.size > 0 && !hub.hasData());
    if (needed && !demoTimer) {
      const profile = service.profiles.find((p) => p.autoDetect) ?? service.profiles[0];
      demoHub.update(demoGame(Date.now()), profile);
      demoHub.updateLocation(demoLocation(Date.now()));
      demoTimer = setInterval(() => demoHub.updateLocation(demoLocation(Date.now())), 500);
      demoTimer.unref();
    } else if (!needed && demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
      demoHub.hideShowcase(false);
      demoHub.update(null, null);
    }
  }

  /** Reenvía a cada cliente la partida que le toca ahora (tras activar o quitar la de ejemplo o la prueba). */
  function resendGame(targets: Iterable<WebSocket>, pick: (ws: WebSocket) => GameHub) {
    for (const ws of targets) {
      send(ws, { type: 'showcaseHide' });
      for (const m of pick(ws).snapshot()) send(ws, m);
    }
  }

  /** Las vistas previas del editor cambian entre la partida real y la de ejemplo según haya datos. */
  let editorSource: GameHub | null = null;
  function syncEditors() {
    syncDemoData();
    const source = editorUsesDemo() ? demoHub : hub;
    if (source === editorSource) return;
    editorSource = source;
    resendGame(editorTeams, () => source);
  }

  function setDemo(on: boolean) {
    if (on === demo) return;
    demo = on;
    syncDemoData();
    resendGame(controls, () => activeHub());
    resendGame(previewTeams, () => teamHub(true));
    for (const ws of [...controls, ...previewTeams]) send(ws, { type: 'demo', enabled: demo });
    syncEditors();
  }

  /** «Probar overlays en directo»: la partida de ejemplo en OBS durante unos segundos. */
  function setTesting(on: boolean) {
    if (on === !!testing && !on) return;
    if (testing) clearTimeout(testing.timer);
    testing = null;
    if (on) {
      const ms = settings.current.views.showcaseSec * 1000;
      testing = { endsAt: Date.now() + ms, timer: setTimeout(() => setTesting(false), ms) };
      testing.timer.unref();
    }
    syncDemoData();
    const remainingMs = testing ? testing.endsAt - Date.now() : 0;
    resendGame(teams, () => teamHub(false));
    resendGame(previewTeams, () => teamHub(true));
    for (const ws of [...teams, ...previewTeams, ...controls]) send(ws, { type: 'test', remainingMs });
    syncEditors();
  }

  /** «Probar combate»: un rival al azar de la Pokédex del juego elegido, como si se hubiera detectado. */
  async function testBattle(double: boolean) {
    const s = settings.current;
    const catalog = await service.catalog(s.gameId, 'regional');
    const pool = catalog.entries.map((e) => e.speciesId);
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    const first = pick();
    let second = pick();
    while (double && pool.length > 1 && second === first) second = pick();
    await live.show({
      gameId: s.gameId,
      catalogMode: s.catalogMode,
      spriteMode: s.spriteMode,
      textMode: s.textMode,
      durationSec: s.durationSec,
      speciesId: first,
      partnerSpeciesId: double ? second : undefined,
      auto: true,
      newSpeciesIds: [first],
    });
  }

  const auto = new AutoDetector({
    settings: () => settings.current,
    profile: (id) => service.profiles.find((p) => p.id === id),
    createReader: opts.createReader ?? ((port) => new RetroArchClient(port)),
    clock: opts.autoClock,
    firewallActive: opts.firewallActive,
    onStatus: (status) => sendAll(controls, { type: 'auto', status }),
    onGame: (raw, profile) => {
      hub.update(raw, profile);
      syncEditors();
    },
    onLocation: (loc) => hub.updateLocation(loc),
    onDetect: (d, profile, newSpecies) => {
      const s = settings.current;
      if (!s.auto.battleCards) return;
      void live.show({
        gameId: profile.id,
        catalogMode: s.catalogMode,
        spriteMode: s.spriteMode,
        textMode: s.textMode,
        durationSec: s.durationSec,
        speciesId: d.species[0],
        partnerSpeciesId: d.species[1],
        auto: true,
        newSpeciesIds: newSpecies,
      });
    },
    speciesNames: async (gameId, species) => {
      const p = service.profiles.find((x) => x.id === gameId);
      const c = await service.catalog(gameId, p?.nationalDex.available ? 'national' : 'regional');
      return species.map((n) => c.entries.find((e) => e.speciesId === n)?.name ?? `n.º ${n}`);
    },
  });
  auto.reconfigure();

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const serveFile = (res: http.ServerResponse, file: string, type: string, cache = 'no-cache') => {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache }).end(data);
    });
  };

  async function handleApi(url: URL, res: http.ServerResponse) {
    const q = url.searchParams;
    switch (url.pathname) {
      case '/api/health':
        return json(res, 200, { ok: true });
      case '/api/games': {
        const games = await Promise.all(
          service.profiles.map(async (p) => {
            let same = false;
            try {
              same = await service.regionalEqualsNational(p.id);
            } catch {
              /* sin red: se resuelve al cargar el catálogo */
            }
            return summarize(p, same);
          }),
        );
        return json(res, 200, games);
      }
      case '/api/settings':
        return json(res, 200, settings.current);
      case '/api/catalog':
        return json(res, 200, await service.catalog(q.get('game') ?? '', parseMode(q.get('mode'))));
      case '/api/card': {
        const card = await service.buildCard(
          q.get('game') ?? '',
          parseMode(q.get('mode')),
          parseSprite(q.get('sprite')),
          Number(q.get('species')),
          parseTextMode(q.get('text') ?? undefined),
        );
        return json(res, 200, card);
      }
      case '/api/status':
        return json(res, 200, live.status());
      default:
        throw new AppError('NOT_FOUND', 'Ruta desconocida.');
    }
  }

  const server = http.createServer(async (req, res) => {
    if (opts.localOnly && !isLocalHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Solo se admite acceso local.');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/control' }).end();
      } else if (url.pathname === '/control' || url.pathname === '/overlay') {
        serveFile(res, path.join(publicDir, `${url.pathname.slice(1)}.html`), MIME['.html']);
      } else if (GAME_OVERLAYS.includes(url.pathname)) {
        serveFile(res, path.join(publicDir, 'partida.html'), MIME['.html']);
      } else if (url.pathname.startsWith('/api/')) {
        await handleApi(url, res);
      } else if (url.pathname.startsWith('/gba/') && url.pathname.endsWith('.png')) {
        if (!opts.gba) throw new AppError('NOT_FOUND', 'No encontrado.');
        const png = await opts.gba.get(url.pathname.slice(5, -4));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' }).end(png);
      } else if (url.pathname === '/img') {
        const src = url.searchParams.get('src') ?? '';
        if (!sprites.isAllowed(src)) throw new AppError('INVALID', 'Origen de imagen no permitido.');
        await sprites.ensure(src);
        const target = sprites.localPath(src)!;
        serveFile(res, target.file, target.type, 'public, max-age=31536000, immutable');
      } else {
        const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
        const file = path.join(publicDir, rel);
        if (!file.startsWith(publicDir + path.sep) || rel.includes('..')) throw new AppError('NOT_FOUND', 'No encontrado.');
        serveFile(res, file, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      }
    } catch (err) {
      const info = toErrorInfo(err);
      if (info.code === 'INTERNAL') log(`Error en ${url.pathname}: ${info.detail}`);
      json(res, statusFor(info.code), { error: info });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    let originOk = !origin || origin === 'null';
    try {
      originOk ||= isLocalHost(new URL(origin!).host);
    } catch {
      /* Origin mal formado: se rechaza */
    }
    if (url.pathname !== '/ws' || (opts.localOnly && (!isLocalHost(req.headers.host) || !originOk))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        handleMessage(ws, msg);
      } catch (err) {
        send(ws, { type: 'error', error: toErrorInfo(err) });
      }
    });
    ws.on('close', () => {
      const wasOverlay = overlays.delete(ws);
      controls.delete(ws);
      teams.delete(ws);
      previewOverlays.delete(ws);
      previewTeams.delete(ws);
      if (editorTeams.delete(ws)) syncEditors();
      if (wasOverlay) sendAll(controls, { type: 'status', status: live.status() });
    });
  });

  function handleMessage(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case 'hello':
        if (msg.role === 'team' && msg.editor) {
          editorTeams.add(ws);
          syncDemoData();
          editorSource = editorUsesDemo() ? demoHub : hub;
          send(ws, { type: 'settings', settings: settings.current });
          for (const m of editorSource.snapshot()) send(ws, m);
          send(ws, { type: 'slots', slots: slots.state });
        } else if (msg.role === 'team') {
          (msg.preview ? previewTeams : teams).add(ws);
          send(ws, { type: 'settings', settings: settings.current });
          for (const m of teamHub(!!msg.preview).snapshot()) send(ws, m);
          if (msg.preview) send(ws, { type: 'demo', enabled: demo });
          if (testing) send(ws, { type: 'test', remainingMs: testing.endsAt - Date.now() });
          send(ws, { type: 'slots', slots: slots.state });
        } else if (msg.role === 'overlay' && msg.preview) {
          previewOverlays.add(ws);
          send(ws, { type: 'settings', settings: settings.current });
          send(ws, { type: 'slots', slots: slots.state });
          for (const m of live.snapshotForOverlay()) send(ws, m);
        } else if (msg.role === 'overlay') {
          overlays.add(ws);
          send(ws, { type: 'settings', settings: settings.current });
          send(ws, { type: 'slots', slots: slots.state });
          for (const m of live.snapshotForOverlay()) send(ws, m);
          sendAll(controls, { type: 'status', status: live.status() });
        } else {
          controls.add(ws);
          send(ws, { type: 'settings', settings: settings.current });
          send(ws, { type: 'status', status: live.status() });
          send(ws, { type: 'auto', status: auto.status });
          for (const m of activeHub().snapshot()) send(ws, m);
          send(ws, { type: 'demo', enabled: demo });
          send(ws, { type: 'slots', slots: slots.state });
        }
        return;
      case 'show':
        if (!controls.has(ws)) return;
        void live.show(validateShowRequest(msg.request, gameIds));
        return;
      case 'hide':
        if (controls.has(ws)) live.hide();
        return;
      case 'settings': {
        if (!controls.has(ws)) return;
        const next = settings.update(msg.patch ?? {});
        sendAll(overlays, { type: 'settings', settings: next });
        sendAll(controls, { type: 'settings', settings: next });
        sendAll(teams, { type: 'settings', settings: next });
        sendAll(previewOverlays, { type: 'settings', settings: next });
        sendAll(previewTeams, { type: 'settings', settings: next });
        sendAll(editorTeams, { type: 'settings', settings: next });
        auto.reconfigure();
        slots.reconfigure();
        return;
      }
      case 'demo':
        if (controls.has(ws)) setDemo(msg.enabled === true);
        return;
      case 'testOverlays':
        if (controls.has(ws)) setTesting(msg.enabled === true);
        if (controls.has(ws) && msg.enabled && teams.size === 0) {
          send(ws, {
            type: 'notice',
            message: 'No hay ningún overlay de la partida conectado en OBS: la prueba solo se verá en la vista previa.',
          });
        }
        return;
      case 'testBattle':
        if (!controls.has(ws)) return;
        testBattle(msg.double === true).catch((err) => send(ws, { type: 'error', error: toErrorInfo(err) }));
        if (overlays.size === 0) {
          send(ws, { type: 'notice', message: 'No hay ningún overlay conectado: añade /overlay en OBS para ver la ficha.' });
        }
        return;
      case 'refreshPc':
        if (demo) return; // la partida de ejemplo ya trae el PC
        if (controls.has(ws) && !auto.requestPc()) {
          send(ws, { type: 'notice', message: 'Para leer el PC hay que estar conectado con RetroArch y con el juego cargado.' });
        }
        return;
      case 'showcase': {
        if (!controls.has(ws)) return;
        const sc = msg.showcase;
        const valid =
          (sc?.kind === 'bag' && ['items', 'balls', 'tmhm', 'berries', 'key'].includes(sc.pocket)) ||
          (sc?.kind === 'pc' && Number.isInteger(sc.box) && sc.box >= 0 && sc.box < 14);
        if (!valid) throw new AppError('INVALID', 'Petición no válida.');
        if (!activeHub().showShowcase(sc)) send(ws, { type: 'notice', message: 'Aún no hay datos de la partida que mostrar.' });
        if (!demo && teams.size === 0) {
          send(ws, {
            type: 'notice',
            message: `No hay ningún overlay de la partida conectado: añade ${sc.kind === 'bag' ? '/mochila' : '/pc'} como Fuente de navegador en OBS.`,
          });
        }
        return;
      }
      case 'showcaseHide':
        if (controls.has(ws)) activeHub().hideShowcase();
        return;
      case 'ready':
        if (!overlays.has(ws)) return;
        live.overlayReady(msg.seq);
        if (msg.overflow) {
          sendAll(controls, {
            type: 'notice',
            message: 'La ficha se sale del lienzo de 1920 × 1080. Reduce la escala o el desplazamiento.',
          });
        }
        return;
      case 'overlayError':
        if (overlays.has(ws)) {
          sendAll(controls, { type: 'error', error: { code: 'INTERNAL', message: `Overlay: ${msg.message}` } });
        }
        return;
    }
  }

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 10000);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    auto.stop();
    hub.hideShowcase(false);
    demoHub.hideShowcase(false);
    if (demoTimer) clearInterval(demoTimer);
    if (testing) clearTimeout(testing.timer);
    slots.stop();
    wss.clients.forEach((ws) => ws.terminate());
  });

  return { server, live, auto, hub, demoHub };
}
