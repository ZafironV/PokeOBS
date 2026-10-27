import type {
  AutoStatus,
  Card,
  Catalog,
  CatalogEntry,
  CatalogMode,
  ErrorInfo,
  GameSummary,
  LiveStatus,
  ServerMessage,
  Settings,
  SpriteMode,
  TextMode,
} from '../shared/types.js';
import { filterCatalog } from '../shared/search.js';
import { padNumber } from '../shared/text.js';
import { renderCard } from './cardView.js';
import { initGamePanel } from './controlGame.js';
import { initDesignPanel } from './designPanel.js';
import { initLivePreview } from './livePreview.js';
import { connectSocket } from './socket.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  pillServer: $('pill-server'),
  pillOverlay: $('pill-overlay'),
  game: $<HTMLSelectElement>('game'),
  gameNotes: $('game-notes'),
  lblRegional: $('lbl-regional'),
  lblNational: $('lbl-national'),
  catalogNotes: $('catalog-notes'),
  search: $<HTMLInputElement>('search'),
  catalogStatus: $('catalog-status'),
  results: $<HTMLUListElement>('results'),
  preview: $('preview'),
  previewName: $('preview-name'),
  warnings: $<HTMLUListElement>('warnings'),
  spriteNotes: $('sprite-notes'),
  textMode: $<HTMLSelectElement>('text-mode'),
  duration: $<HTMLInputElement>('duration'),
  durationValue: $('duration-value'),
  btnShow: $<HTMLButtonElement>('btn-show'),
  btnHide: $<HTMLButtonElement>('btn-hide'),
  liveText: $('live-text'),
  liveBar: $('live-bar'),
  urlControl: $<HTMLInputElement>('url-control'),
  urlOverlay: $<HTMLInputElement>('url-overlay'),
  log: $<HTMLUListElement>('log'),
  logBadge: $('log-badge'),
  pillAuto: $('pill-auto'),
  autoEnabled: $<HTMLInputElement>('auto-enabled'),
  autoBattle: $<HTMLInputElement>('auto-battle'),
  autoState: $('auto-state'),
  autoLast: $('auto-last'),
  autoUsage: $('auto-usage'),
  autoFirewall: $('auto-firewall'),
  autoEvents: $<HTMLUListElement>('auto-events'),
  autoInterval: $<HTMLSelectElement>('auto-interval'),
  autoPort: $<HTMLInputElement>('auto-port'),
  autoCopy: $<HTMLButtonElement>('auto-copy'),
  swap: $<HTMLInputElement>('swap'),
  swapValue: $('swap-value'),
};

let games: GameSummary[] = [];
let settings: Settings;
let catalog: Catalog | null = null;
let selected: CatalogEntry | null = null;
let previewCard: Card | null = null;
let status: LiveStatus | null = null;
let statusAt = 0;
let connected = false;
let autoStatus: AutoStatus | null = null;
let currentPage = 'directo';
let unreadLog = 0;

// ---------- utilidades ----------

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: number | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw { code: 'NETWORK', message: 'No se pudo contactar con el servidor local de PokeOBS.' } satisfies ErrorInfo;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw (body?.error ?? { code: 'INTERNAL', message: `Error ${res.status}` }) as ErrorInfo;
  return body as T;
}

function log(kind: 'error' | 'notice' | 'info', message: string, detail?: string) {
  const first = ui.log.firstElementChild;
  if (first?.classList.contains('muted')) first.remove();
  const li = document.createElement('li');
  li.className = kind;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('es-ES');
  li.append(time, message);
  if (detail) {
    const d = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = 'Detalles técnicos';
    d.append(s, detail);
    li.append(d);
  }
  ui.log.prepend(li);
  while (ui.log.children.length > 40) ui.log.lastElementChild!.remove();
  // Aviso en la pestaña «Registro» de los errores y avisos sin leer.
  if (kind !== 'info' && currentPage !== 'registro') {
    unreadLog++;
    ui.logBadge.textContent = String(unreadLog);
    ui.logBadge.hidden = false;
  }
}

function logError(err: unknown) {
  const e = err as ErrorInfo;
  if (e && typeof e === 'object' && 'message' in e) log('error', e.message, e.detail);
  else log('error', String(err));
}

// ---------- preferencias ----------

let pendingPatch: Partial<Settings> = {};
const flushSettings = () => {
  if (Object.keys(pendingPatch).length && socket.send({ type: 'settings', patch: pendingPatch })) pendingPatch = {};
};
const flushSoon = debounce(flushSettings, 150);
// No perder un cambio hecho justo antes de cerrar o recargar el panel.
window.addEventListener('pagehide', flushSettings);

function saveSettings(patch: Partial<Settings>) {
  settings = {
    ...settings,
    ...patch,
    overlay: { ...settings.overlay, ...patch.overlay },
    auto: { ...settings.auto, ...patch.auto },
    views: { ...settings.views, ...patch.views },
  };
  pendingPatch = {
    ...pendingPatch,
    ...patch,
    overlay: patch.overlay || pendingPatch.overlay ? { ...settings.overlay } : undefined,
    auto: patch.auto || pendingPatch.auto ? { ...settings.auto } : undefined,
    views: patch.views || pendingPatch.views ? { ...settings.views } : undefined,
  };
  if (!pendingPatch.overlay) delete pendingPatch.overlay;
  if (!pendingPatch.auto) delete pendingPatch.auto;
  if (!pendingPatch.views) delete pendingPatch.views;
  flushSoon();
}

function radios(name: string) {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
}

function applySettingsToUi() {
  ui.game.value = settings.gameId;
  radios('catalog').forEach((r) => (r.checked = r.value === settings.catalogMode));
  radios('sprite').forEach((r) => (r.checked = r.value === settings.spriteMode));
  ui.textMode.value = settings.textMode;
  ui.duration.value = String(settings.durationSec);
  ui.durationValue.textContent = `${settings.durationSec} s`;
  ui.autoEnabled.checked = settings.auto.enabled;
  ui.autoBattle.checked = settings.auto.battleCards;
  gamePanel.applySettings();
  designPanel.applySettings();
  ui.autoInterval.value = String(settings.auto.intervalMs);
  ui.autoPort.value = String(settings.auto.port);
  ui.swap.value = String(settings.doubleSwapSec);
  ui.swapValue.textContent = `${settings.doubleSwapSec} s`;
  updateGameTexts();
  renderAuto();
}

function currentGame() {
  return games.find((g) => g.id === settings.gameId)!;
}

function updateGameTexts() {
  const g = currentGame();
  if (!g) return;
  ui.gameNotes.textContent = g.notes ?? '';
  ui.lblRegional.textContent = g.regionalLabel;
  ui.lblNational.textContent = g.nationalAvailable ? g.nationalLabel : 'Pokédex Nacional (no existe en este juego)';
  const nationalRadio = radios('catalog').find((r) => r.value === 'national')!;
  nationalRadio.disabled = !g.nationalAvailable;
  const notes: string[] = [];
  if (settings.catalogMode === 'national') {
    notes.push(
      `Especies introducidas hasta la Generación ${g.generation}. No significa que todas se puedan capturar en ${g.name}.`,
    );
  }
  if (g.regionalEqualsNational) notes.push('En esta edición la Pokédex regional y la nacional coinciden.');
  ui.catalogNotes.textContent = notes.join(' ');
}

// ---------- catálogo y búsqueda ----------

let catalogToken = 0;
async function loadCatalog() {
  const token = ++catalogToken;
  const { gameId, catalogMode } = settings;
  ui.catalogStatus.textContent = 'Cargando catálogo…';
  ui.catalogStatus.classList.remove('warn');
  try {
    const c = await api<Catalog>(`/api/catalog?game=${encodeURIComponent(gameId)}&mode=${catalogMode}`);
    if (token !== catalogToken) return;
    catalog = c;
    ui.catalogStatus.textContent = `${c.label}: ${c.entries.length} especies.`;
    // Limpiar la selección si no pertenece al nuevo catálogo.
    const wanted = selected?.speciesId ?? settings.selectedSpeciesId;
    const match = wanted ? c.entries.find((e) => e.speciesId === wanted) ?? null : null;
    if (wanted && !match) {
      const name = selected?.name ?? `#${wanted}`;
      log('notice', `${name} no está en ${c.label}; se ha quitado la selección.`);
      clearSelection();
    } else if (match) {
      select(match, false);
    } else {
      refreshPreview();
    }
    renderResults();
  } catch (e) {
    if (token !== catalogToken) return;
    catalog = null;
    renderResults();
    ui.catalogStatus.textContent = 'No se pudo cargar el catálogo. Revisa el registro.';
    ui.catalogStatus.classList.add('warn');
    logError(e);
  }
}

function renderResults() {
  ui.results.textContent = '';
  if (!catalog) return;
  const q = ui.search.value;
  const list = filterCatalog(catalog.entries, q, 60);
  if (q.trim() && list.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.style.padding = '6px 8px';
    li.textContent = /^\s*#?\d+\s*$/.test(q)
      ? `Ningún Pokémon con ese número en ${catalog.label}.`
      : `No hay resultados en ${catalog.label}.`;
    ui.results.append(li);
    return;
  }
  const regional = catalog.mode === 'regional';
  for (const e of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(selected?.speciesId === e.speciesId));
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `#${padNumber(regional ? (e.regionalNumber ?? e.speciesId) : e.speciesId)}`;
    const name = document.createElement('span');
    name.textContent = e.name;
    b.append(num, name);
    if (regional && e.regionalNumber !== e.speciesId) {
      const nat = document.createElement('span');
      nat.className = 'nat';
      nat.textContent = `Nac. ${padNumber(e.speciesId)}`;
      b.append(nat);
    }
    b.addEventListener('click', () => select(e));
    li.append(b);
    ui.results.append(li);
  }
}

const renderResultsSoon = debounce(renderResults, 120);

function select(entry: CatalogEntry, persist = true) {
  selected = entry;
  if (persist && settings.selectedSpeciesId !== entry.speciesId) saveSettings({ selectedSpeciesId: entry.speciesId });
  renderResults();
  refreshPreview();
}

function clearSelection() {
  selected = null;
  previewCard = null;
  saveSettings({ selectedSpeciesId: null });
  previewAbort?.abort();
  ui.preview.classList.remove('loading');
  ui.preview.innerHTML = '<p class="placeholder">Selecciona un Pokémon.</p>';
  ui.previewName.textContent = '';
  ui.warnings.textContent = '';
  updateButtons();
}

// ---------- vista previa ----------

let previewAbort: AbortController | null = null;
let previewToken = 0;

function refreshPreview() {
  previewCard = null;
  updateButtons();
  if (!selected) return;
  ui.preview.classList.add('loading');
  loadPreviewSoon();
}

const loadPreviewSoon = debounce(loadPreview, 200);

async function loadPreview() {
  if (!selected) return;
  previewAbort?.abort();
  const ctrl = new AbortController();
  previewAbort = ctrl;
  const token = ++previewToken;
  const { gameId, catalogMode, spriteMode, textMode } = settings;
  const q = `game=${encodeURIComponent(gameId)}&mode=${catalogMode}&sprite=${spriteMode}&text=${textMode}&species=${selected.speciesId}`;
  try {
    const card = await api<Card>(`/api/card?${q}`, ctrl.signal);
    // Una respuesta lenta de una selección anterior no sobrescribe la actual.
    if (token !== previewToken) return;
    previewCard = card;
    ui.previewName.textContent = `· ${card.name}`;
    const { element, ready } = renderCard(card);
    const scaler = document.createElement('div');
    scaler.className = 'scaler';
    scaler.append(element);
    ui.preview.textContent = '';
    ui.preview.append(scaler);
    fitPreview();
    void ready.then(fitPreview);
    ui.warnings.textContent = '';
    for (const w of card.warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      ui.warnings.append(li);
    }
    updateSpriteNotes(card);
  } catch (e) {
    if ((e as Error).name === 'AbortError' || token !== previewToken) return;
    const err = e as ErrorInfo;
    ui.preview.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = err.message ?? 'Error al cargar la ficha.';
    ui.preview.append(p);
    ui.warnings.textContent = '';
    logError(e);
  } finally {
    if (token === previewToken) {
      ui.preview.classList.remove('loading');
      updateButtons();
    }
  }
}

function fitPreview() {
  const scaler = ui.preview.querySelector<HTMLElement>('.scaler');
  const card = scaler?.firstElementChild as HTMLElement | null;
  if (!scaler || !card) return;
  const s = Math.min(1, ui.preview.clientWidth / card.offsetWidth);
  scaler.style.transform = `scale(${s})`;
  ui.preview.style.height = `${Math.ceil(card.offsetHeight * s)}px`;
}
window.addEventListener('resize', fitPreview);

function updateSpriteNotes(card: Card | null) {
  const g = currentGame();
  let text =
    settings.spriteMode === 'game'
      ? `Sprites estáticos de ${g?.name ?? 'la edición'}.`
      : 'Prioriza sprites 2D animados en pixel art; nunca modelos 3D.';
  let warn = false;
  if (card?.sprite) {
    if (settings.spriteMode === 'animated' && !card.sprite.animated) {
      text = 'Este Pokémon no tiene sprite animado disponible: se usa uno estático.';
      warn = true;
    } else {
      text += ` Origen: ${card.sprite.label}.`;
      if (card.sprite.fromOtherGame) warn = true;
    }
  }
  ui.spriteNotes.textContent = text;
  ui.spriteNotes.classList.toggle('warn', warn);
}

// ---------- estado del directo ----------

function updateButtons() {
  ui.btnShow.disabled = !connected || !selected || !previewCard;
  ui.btnHide.disabled = !connected || !status || status.phase === 'idle';
}

function renderStatus() {
  ui.pillServer.textContent = connected ? 'Servidor: conectado' : 'Servidor: desconectado';
  ui.pillServer.className = `pill ${connected ? 'ok' : 'bad'}`;
  const n = connected ? (status?.overlays ?? 0) : 0;
  ui.pillOverlay.textContent = !connected
    ? 'Overlay: desconocido'
    : n === 0
      ? 'Overlay: ninguno'
      : `Overlay: ${n} conectado${n > 1 ? 's' : ''}`;
  ui.pillOverlay.className = `pill ${!connected ? 'bad' : n === 0 ? 'warn' : 'ok'}`;
  tick();
  updateButtons();
}

function tick() {
  if (!status || !connected) {
    ui.liveText.textContent = connected ? 'Oculto' : 'Sin conexión con el servidor';
    ui.liveBar.style.width = '0';
    return;
  }
  const remaining = Math.max(0, status.remainingMs - (performance.now() - statusAt));
  const secs = Math.ceil(remaining / 1000);
  switch (status.phase) {
    case 'idle':
      ui.liveText.textContent = 'Oculto';
      break;
    case 'loading':
      ui.liveText.textContent = 'Cargando datos…';
      break;
    case 'preparing':
      ui.liveText.textContent = `Preparando ${status.pendingName ?? ''} en el overlay…`;
      break;
    case 'live':
      ui.liveText.textContent =
        `En directo: ${status.liveName} · quedan ${secs} s` +
        (status.confirmedByOverlay === false && status.overlays > 0 ? ' (el overlay no confirmó a tiempo)' : '');
      break;
  }
  if (status.phase !== 'live' && status.liveName) {
    ui.liveText.textContent += ` · en pantalla: ${status.liveName} (${secs} s)`;
  }
  ui.liveBar.style.width = status.durationMs ? `${(remaining / status.durationMs) * 100}%` : '0';
}
setInterval(tick, 200);

// ---------- detección automática ----------

const AUTO_LOOK: Record<AutoStatus['state'], { pill: string; cls: string }> = {
  off: { pill: 'RetroArch: apagado', cls: 'off' },
  unsupported: { pill: 'RetroArch: juego no compatible', cls: 'warn' },
  connecting: { pill: 'RetroArch: sin respuesta', cls: 'bad' },
  'no-game': { pill: 'RetroArch: sin juego', cls: 'warn' },
  'wrong-game': { pill: 'RetroArch: otro juego', cls: 'warn' },
  watching: { pill: 'RetroArch: conectado', cls: 'ok' },
  battle: { pill: 'RetroArch: en combate', cls: 'ok' },
};

const clockText = (at: number) => new Date(at).toLocaleTimeString('es-ES');
const num = (n: number) => n.toLocaleString('es-ES');

function renderAuto() {
  const st = autoStatus;
  const g = currentGame();
  const look = AUTO_LOOK[st?.state ?? 'off'];
  ui.pillAuto.textContent = look.pill;
  ui.pillAuto.className = `pill ${look.cls}`;
  ui.autoState.className = `auto-state ${look.cls}`;
  let message = st?.message ?? 'Desactivada.';
  if (!settings.auto.enabled && g && !g.autoDetect) {
    message = `${g.name} aún no se puede leer desde RetroArch. De momento solo funciona con Pokémon Esmeralda.`;
  }
  ui.autoState.textContent = message;
  ui.autoEnabled.disabled = !connected || (!!g && !g.autoDetect && !settings.auto.enabled);
  ui.autoBattle.disabled = !connected || !settings.auto.enabled;
  ui.autoLast.textContent = st?.lastDetected
    ? `${st.lastDetected.names.join(' y ')} (${st.lastDetected.kind}) · ${clockText(st.lastDetected.at)}`
    : '—';
  const u = st?.usage;
  ui.autoUsage.textContent = u
    ? `CPU ${num(u.cpuPercent)} % · memoria ${u.memoryMb} MB · ${num(u.readsPerSec)} lecturas/s` +
      (u.latencyMs ? ` · respuesta ${num(u.latencyMs)} ms` : '')
    : '—';
  ui.autoFirewall.textContent =
    st?.firewall === true
      ? 'Activa: solo este PC puede enviar órdenes a RetroArch. Se quita sola al cerrar PokeOBS.'
      : st?.firewall === false
        ? 'Inactiva: abre PokeOBS con Iniciar-PokeOBS.bat y acepta el aviso de Windows.'
        : '—';
  ui.autoFirewall.className = st?.firewall === false ? 'warn' : '';
  ui.autoEvents.textContent = '';
  for (const e of st?.events ?? []) {
    const li = document.createElement('li');
    li.className = e.kind;
    const time = document.createElement('time');
    time.textContent = clockText(e.at);
    li.append(time, e.text);
    ui.autoEvents.append(li);
  }
  if (!st?.events.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Sin actividad.';
    ui.autoEvents.append(li);
  }
}

/** Texto para pegar en el chat cuando algo no funciona. */
function diagnostic(): string {
  const st = autoStatus;
  return [
    'Diagnóstico de PokeOBS (detección automática)',
    `Fecha: ${new Date().toLocaleString('es-ES')}`,
    `Juego elegido: ${currentGame()?.name ?? settings.gameId}`,
    `Activada: ${settings.auto.enabled ? 'sí' : 'no'} · cada ${settings.auto.intervalMs} ms · puerto ${settings.auto.port}`,
    `Estado: ${st?.state ?? '?'} — ${st?.message ?? ''}`,
    `RetroArch: ${st?.retroarchVersion ?? 'sin respuesta'} · código del juego: ${st?.gameCode ?? 'desconocido'}`,
    `Consumo: ${ui.autoUsage.textContent}`,
    `Protección de red: ${ui.autoFirewall.textContent}`,
    `Overlays conectados: ${status?.overlays ?? 0}`,
    `Partida: ${gamePanel.summary()}`,
    'Actividad:',
    ...(st?.events ?? []).map((e) => `  ${clockText(e.at)} [${e.kind}] ${e.text}`),
  ].join('\n');
}

// ---------- partida ----------

const gamePanel = initGamePanel({
  send: (msg) => socket.send(msg),
  settings: () => settings,
  saveViews: (views) => saveSettings({ views }),
  log,
});

const designPanel = initDesignPanel({
  settings: () => settings,
  save: (patch) => saveSettings(patch),
});

const livePreview = initLivePreview({ send: (msg) => socket.send(msg) });

// ---------- aplicación de escritorio ----------

/** Solo existe dentro de la ventana de la aplicación (electron/preload.cjs). */
interface DesktopApp {
  getAutoStart(): Promise<{ supported: boolean; enabled: boolean }>;
  setAutoStart(enabled: boolean): Promise<{ supported: boolean; enabled: boolean }>;
}
const desktop = (window as unknown as { pokeobsApp?: DesktopApp }).pokeobsApp;
if (desktop) {
  const box = $('app-box');
  const autostart = $<HTMLInputElement>('app-autostart');
  const apply = (s: { supported: boolean; enabled: boolean }) => {
    box.hidden = false;
    autostart.disabled = !s.supported;
    autostart.checked = s.enabled;
  };
  void desktop.getAutoStart().then(apply);
  autostart.addEventListener('change', () => void desktop.setAutoStart(autostart.checked).then(apply));
}

// ---------- pestañas ----------

const PAGE_KEY = 'pokeobs.page';
const pageButtons = [...document.querySelectorAll<HTMLButtonElement>('.nav button')];

function showPage(page: string) {
  if (!pageButtons.some((b) => b.dataset.page === page)) page = 'directo';
  currentPage = page;
  pageButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === page)));
  for (const el of document.querySelectorAll<HTMLElement>('main > .page')) el.hidden = el.dataset.page !== page;
  designPanel.setActive(page === 'diseno');
  if (page === 'registro') {
    unreadLog = 0;
    ui.logBadge.hidden = true;
  }
  try {
    localStorage.setItem(PAGE_KEY, page);
  } catch {
    // sin almacenamiento: no se recuerda
  }
}
pageButtons.forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page!)));
{
  let saved = 'directo';
  try {
    saved = localStorage.getItem(PAGE_KEY) ?? saved;
  } catch {
    // sin almacenamiento: se abre «Directo»
  }
  showPage(saved);
}

// ---------- conexión ----------

const socket = connectSocket(
  'control',
  (msg: ServerMessage) => {
    switch (msg.type) {
      case 'status':
        status = msg.status;
        statusAt = performance.now();
        renderStatus();
        break;
      case 'settings': {
        if (!settings) break;
        // Mantener los cambios locales aún no enviados.
        const prev = settings;
        settings = {
          ...msg.settings,
          ...pendingPatch,
          overlay: { ...msg.settings.overlay, ...pendingPatch.overlay },
          auto: { ...msg.settings.auto, ...pendingPatch.auto },
          views: { ...msg.settings.views, ...pendingPatch.views },
        };
        applySettingsToUi();
        if (prev.gameId !== settings.gameId || prev.catalogMode !== settings.catalogMode) void loadCatalog();
        else if (prev.spriteMode !== settings.spriteMode || prev.textMode !== settings.textMode) refreshPreview();
        break;
      }
      case 'error':
        logError(msg.error);
        break;
      case 'notice':
        log('notice', msg.message);
        break;
      case 'auto':
        autoStatus = msg.status;
        if (settings) renderAuto();
        break;
      case 'game':
        gamePanel.onGame(msg.data);
        designPanel.onGame(!!(msg.data.party || msg.data.bag || msg.data.pc));
        break;
      case 'species':
        gamePanel.onSpecies(msg.entries);
        break;
      case 'location':
        gamePanel.onLocation(msg.location);
        break;
      case 'demo':
        gamePanel.onDemo(msg.enabled);
        livePreview.onDemo(msg.enabled);
        designPanel.onDemo(msg.enabled);
        break;
      case 'test':
        gamePanel.onTest(msg.remainingMs);
        break;
      case 'slots':
        designPanel.onSlots(msg.slots);
        break;
    }
  },
  (isConnected) => {
    connected = isConnected;
    if (isConnected) flushSettings();
    else log('error', 'Se perdió la conexión con el servidor. Reintentando…');
    renderStatus();
    if (settings) renderAuto();
  },
);

// ---------- eventos ----------

ui.game.addEventListener('change', () => {
  const g = games.find((x) => x.id === ui.game.value);
  // Juegos sin Pokédex Nacional (Let's Go): se pasa al catálogo regional.
  if (g && !g.nationalAvailable && settings.catalogMode === 'national') {
    saveSettings({ gameId: ui.game.value, catalogMode: 'regional' });
    radios('catalog').forEach((r) => (r.checked = r.value === 'regional'));
    log('notice', `${g.name} no tiene Pokédex Nacional; se usa ${g.regionalLabel}.`);
  } else {
    saveSettings({ gameId: ui.game.value });
  }
  updateGameTexts();
  renderAuto();
  void loadCatalog();
});
radios('catalog').forEach((r) =>
  r.addEventListener('change', () => {
    saveSettings({ catalogMode: r.value as CatalogMode });
    updateGameTexts();
    void loadCatalog();
  }),
);
radios('sprite').forEach((r) =>
  r.addEventListener('change', () => {
    saveSettings({ spriteMode: r.value as SpriteMode });
    updateSpriteNotes(null);
    refreshPreview();
  }),
);
ui.textMode.addEventListener('change', () => {
  saveSettings({ textMode: ui.textMode.value as TextMode });
  refreshPreview();
});
ui.search.addEventListener('input', renderResultsSoon);
ui.search.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && catalog) {
    const first = filterCatalog(catalog.entries, ui.search.value, 1)[0];
    if (first) select(first);
  }
});
ui.duration.addEventListener('input', () => {
  ui.durationValue.textContent = `${ui.duration.value} s`;
  saveSettings({ durationSec: Number(ui.duration.value) });
});
ui.btnShow.addEventListener('click', () => {
  if (!selected) return;
  flushSettings();
  const ok = socket.send({
    type: 'show',
    request: {
      gameId: settings.gameId,
      catalogMode: settings.catalogMode,
      spriteMode: settings.spriteMode,
      textMode: settings.textMode,
      speciesId: selected.speciesId,
      durationSec: settings.durationSec,
    },
  });
  if (!ok) log('error', 'No hay conexión con el servidor.');
  else if ((status?.overlays ?? 0) === 0) {
    log('notice', 'No hay ningún overlay conectado. Añade la Fuente de navegador en OBS para que se vea la ficha.');
  }
});
ui.btnHide.addEventListener('click', () => socket.send({ type: 'hide' }));

ui.autoEnabled.addEventListener('change', () => {
  saveSettings({ auto: { ...settings.auto, enabled: ui.autoEnabled.checked } });
  flushSettings();
  if (ui.autoEnabled.checked && (status?.overlays ?? 0) === 0) {
    log('notice', 'No hay ningún overlay conectado: las fichas detectadas no se verán hasta añadir la Fuente de navegador en OBS.');
  }
});
for (const [id, double] of [
  ['test-battle', false],
  ['test-battle-double', true],
] as const) {
  $(id).addEventListener('click', () => {
    if (!socket.send({ type: 'testBattle', double })) log('error', 'No hay conexión con el servidor.');
  });
}
ui.autoBattle.addEventListener('change', () =>
  saveSettings({ auto: { ...settings.auto, battleCards: ui.autoBattle.checked } }),
);
ui.autoInterval.addEventListener('change', () =>
  saveSettings({ auto: { ...settings.auto, intervalMs: Number(ui.autoInterval.value) } }),
);
ui.autoPort.addEventListener('change', () => {
  const port = Math.round(Number(ui.autoPort.value));
  if (port >= 1 && port <= 65535) saveSettings({ auto: { ...settings.auto, port } });
  else ui.autoPort.value = String(settings.auto.port);
});
ui.swap.addEventListener('input', () => {
  ui.swapValue.textContent = `${ui.swap.value} s`;
  saveSettings({ doubleSwapSec: Number(ui.swap.value) });
});
ui.autoCopy.addEventListener('click', async () => {
  const text = diagnostic();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  ui.autoCopy.textContent = 'Copiado';
  setTimeout(() => (ui.autoCopy.textContent = 'Copiar diagnóstico'), 1500);
});


for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  b.addEventListener('click', async () => {
    const input = $<HTMLInputElement>(b.dataset.copy!);
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      document.execCommand('copy');
    }
    b.textContent = 'Copiado';
    setTimeout(() => (b.textContent = 'Copiar'), 1500);
  });
}

// ---------- arranque ----------

async function init() {
  ui.urlControl.value = `${location.origin}/control`;
  ui.urlOverlay.value = `${location.origin}/overlay`;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-path]')) {
    input.value = `${location.origin}${input.dataset.path}`;
  }
  try {
    [games, settings] = await Promise.all([api<GameSummary[]>('/api/games'), api<Settings>('/api/settings')]);
  } catch (e) {
    logError(e);
    setTimeout(init, 3000);
    return;
  }
  ui.game.textContent = '';
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const g of games) {
    let group = groups.get(g.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = g.group;
      groups.set(g.group, group);
      ui.game.append(group);
    }
    const o = document.createElement('option');
    o.value = g.id;
    o.textContent = `${g.name} (${g.platform})`;
    group.append(o);
  }
  // Preferencia guardada incompatible (p. ej. Nacional en Let's Go).
  if (!currentGame()?.nationalAvailable && settings.catalogMode === 'national') saveSettings({ catalogMode: 'regional' });
  applySettingsToUi();
  updateSpriteNotes(null);
  renderStatus();
  await loadCatalog();
}
void init();
