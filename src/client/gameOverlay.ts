import type { GameData, GameView, OverlayLayout, PlayerLocation, ServerMessage, Settings, Showcase, SlotState } from '../shared/types.js';
import { applyColorVars, resolveColors } from '../shared/themes.js';
import {
  countBox,
  placeMarker,
  renderBadges,
  renderMap,
  renderParty,
  renderPcBox,
  renderPocket,
  startBouncing,
  startScrolling,
  type SpeciesMap,
} from './gameView.js';
import { connectSocket } from './socket.js';

// Overlays de la partida: /equipo, /medallas, /mochila, /pc y /mapa comparten esta
// página y cada una enseña solo lo suyo, con su posición y escala propias.
// La mochila y el PC pueden estar fijos o aparecer unos segundos al pedirlo, y
// van turnando sus bolsillos y cajas con contenido (los vacíos se saltan).

const VIEW_BY_PATH: Record<string, GameView> = {
  '/equipo': 'party',
  '/medallas': 'badges',
  '/mochila': 'bag',
  '/pc': 'pc',
  '/mapa': 'map',
};
const params = new URLSearchParams(location.search);
/** Vista previa del panel: no cuenta como overlay de OBS. */
const preview = params.has('preview');
/** Vista previa del editor de diseño: enseña siempre su elemento. */
const editor = params.has('editor');
const view: GameView = VIEW_BY_PATH[location.pathname] ?? 'party';
const FADE_MS = 400;

const root = document.getElementById('view-root')!;
const species: SpeciesMap = new Map();
let settings: Settings | null = null;
let data: GameData | null = null;
let showcase: Showcase | null = null;
let playerLocation: PlayerLocation | null = null;
/** «Probar overlays en directo»: se enseña todo, también mochila y PC aunque no estén fijos. */
let testing = false;
let testTimer: number | undefined;
/** Turno de esta vista si está en un grupo de turnos (si no, undefined). */
let slot: SlotState[GameView];
/**
 * ¿Se enseña esta vista? Durante una prueba, siempre; en un grupo de turnos,
 * solo en su turno; si no, según «visible siempre».
 */
const shown = (v: GameView) => editor || testing || (slot ? slot.active : !!settings?.views[v].visible);
let showcaseTimer: number | undefined;
let lastKey = '';
/** Bolsillo (id) o caja (número) que se está enseñando en la rotación. */
let current: string | null = null;
let rotateTimer: number | undefined;
let rotateEvery = 0;
/** Cambio de contenido en curso (salida del anterior y entrada del nuevo). */
let swapToken = 0;
/** Detiene el rebote de los Pokémon del PC y el desplazamiento de la lista de la mochila. */
let stopMotion: () => void = () => {};

function applyLayout(layout: OverlayLayout) {
  const { scale, anchor, offsetX, offsetY } = layout;
  const [v, h] = anchor.split('-') as ['top' | 'bottom' | 'center', 'left' | 'right'];
  root.style.left = root.style.right = root.style.top = root.style.bottom = '';
  root.style[h] = `${offsetX}px`;
  if (v === 'center') {
    root.style.top = '50%';
    root.style.transform = `translateY(-50%) scale(${scale})`;
  } else {
    root.style[v] = `${offsetY}px`;
    root.style.transform = `scale(${scale})`;
  }
  root.style.transformOrigin = `${v === 'center' ? 'center' : v} ${h}`;
}

function title(text: string): HTMLElement {
  const t = document.createElement('h2');
  t.className = 'gm-title';
  t.textContent = text;
  return t;
}

/** ¿Debe verse la mochila o el PC? (fijo, o pedido con «Mostrar en directo») */
function rotatingActive(): boolean {
  if (!settings) return false;
  if (view === 'bag') return showcase?.kind === 'bag' || shown('bag');
  if (view === 'pc') return showcase?.kind === 'pc' || shown('pc');
  return false;
}

/** Bolsillos o cajas con contenido, empezando por el elegido en el panel (o el pedido). */
function candidates(): string[] {
  if (!settings || !data) return [];
  let ids: string[] = [];
  let start: string | null = null;
  if (view === 'bag') {
    ids = (data.bag ?? []).filter((p) => p.items.length > 0).map((p) => p.id);
    start = showcase?.kind === 'bag' ? showcase.pocket : settings.views.pocket;
  } else if (view === 'pc' && data.pc) {
    ids = data.pc.boxes.map((_, i) => String(i)).filter((i) => countBox(data!, Number(i)) > 0);
    start = String(showcase?.kind === 'pc' ? showcase.box : settings.views.box);
  }
  const at = start ? ids.indexOf(start) : -1;
  return at > 0 ? [...ids.slice(at), ...ids.slice(0, at)] : ids;
}

/** Contenido de esta vista, o null si no hay nada que enseñar. */
function content(): { parts: HTMLElement[]; framed: boolean } | null {
  if (!settings || !data || view === 'map') return null;
  const styles = settings.views.styles;
  switch (view) {
    case 'party':
      return shown('party') && data.party ? { parts: [renderParty(data, species, styles.party)], framed: true } : null;
    case 'badges':
      return shown('badges') && data.badges ? { parts: [renderBadges(data, styles.badges)], framed: true } : null;
    case 'bag': {
      const pocket = data.bag?.find((p) => p.id === current);
      if (!rotatingActive() || !pocket) return null;
      const parts = [renderPocket(data, pocket.id, styles.bag)];
      if (styles.bag.showTitle) {
        const t = title(`Mochila · ${pocket.label}`);
        t.style.textAlign = styles.bag.titleAlign;
        parts.unshift(t);
      }
      return { parts, framed: true };
    }
    case 'pc':
      return rotatingActive() && current !== null && data.pc
        ? { parts: [renderPcBox(data, Number(current), species, styles.pc)], framed: false }
        : null;
  }
}

/** Colores de esta vista (los del juego, un tema o los personalizados). */
function paint(part: HTMLElement) {
  applyColorVars(part, resolveColors(settings?.views.colors[view], data?.game ?? null));
}

/** Mantiene la rotación entre bolsillos o cajas: solo si hay más de uno con contenido. */
function updateRotation() {
  if (view !== 'bag' && view !== 'pc') return;
  const list = rotatingActive() ? candidates() : [];
  if (!list.length) current = null;
  else if (current === null || !list.includes(current)) current = list[0];
  const every = list.length > 1 && settings ? settings.views.rotateSec * 1000 : 0;
  if (every === rotateEvery) return;
  clearInterval(rotateTimer);
  rotateEvery = every;
  if (!every) return;
  rotateTimer = window.setInterval(() => {
    const ids = candidates();
    if (ids.length < 2) return;
    current = ids[(ids.indexOf(current ?? '') + 1) % ids.length];
    render();
  }, every);
}

function build(c: { parts: HTMLElement[]; framed: boolean }): HTMLElement {
  const part = document.createElement('div');
  part.className = `view-part view-${view}${c.framed ? ' gm-frame' : ''}`;
  paint(part);
  part.append(...c.parts);
  return part;
}

/** Pone el contenido nuevo; los Pokémon del PC y la lista de la mochila empiezan a moverse. */
function mount(part: HTMLElement) {
  stopMotion();
  root.textContent = '';
  root.append(part);
  const pc = part.querySelector<HTMLElement>('.gm-pc');
  const stops = [pc ? startBouncing(pc) : () => {}, startScrolling(part)];
  stopMotion = () => stops.forEach((stop) => stop());
}

function enter(part: HTMLElement) {
  part.classList.add('entering');
  void part.offsetWidth;
  part.classList.remove('entering');
}

/**
 * Minimapa: el mapa solo se construye al aparecer (o si cambia el personaje);
 * al andar se desplaza el marcador y cambia el nombre de la zona.
 */
function renderMapView() {
  const show = shown('map') && !!playerLocation;
  const existing = root.querySelector<HTMLElement>('.view-map:not(.leaving)');
  if (!show) {
    if (existing) {
      existing.classList.add('leaving');
      setTimeout(() => existing.remove(), FADE_MS);
    }
    return;
  }
  const gender = data?.player?.gender ?? 'male';
  const style = settings!.views.styles.map;
  // El mapa se reconstruye si cambian el personaje, la presentación o los colores.
  const key = JSON.stringify([gender, style, settings!.views.colors.map, data?.game?.accent]);
  let part = existing;
  if (!part || part.dataset.key !== key) {
    part = document.createElement('div');
    part.className = `view-part view-map label-${style.labelPosition} label-align-${style.labelAlign}`;
    part.dataset.key = key;
    paint(part);
    const label = document.createElement('div');
    label.className = 'gm-map-place';
    if (style.labelPosition === 'top') part.append(label, renderMap(gender, style));
    else if (style.labelPosition === 'bottom') part.append(renderMap(gender, style), label);
    else part.append(renderMap(gender, style));
    root.textContent = '';
    root.append(part);
    placeMarker(part.querySelector('.gm-map')!, playerLocation, false);
    if (!existing) enter(part);
  }
  const label = part.querySelector('.gm-map-place');
  if (label) label.textContent = playerLocation!.name || 'Fuera de Hoenn';
  placeMarker(part.querySelector('.gm-map')!, playerLocation);
}

function render() {
  if (!settings) return;
  // En un grupo de lugar compartido, la posición es la del grupo.
  applyLayout(slot?.layout ?? settings.views[view].layout);
  if (view === 'map') return renderMapView();
  updateRotation();
  const c = content();
  // Solo se redibuja si cambia algo visible (evita parpadeos de las imágenes).
  const colors = JSON.stringify([settings.views.colors[view], data?.game?.accent]);
  const key = c ? `${current}|${colors}|${c.parts.map((p) => p.outerHTML).join('')}` : '';
  if (key === lastKey) return;
  const previousKey = lastKey;
  lastKey = key;
  const token = ++swapToken;
  const old = root.firstElementChild as HTMLElement | null;
  if (!c) {
    if (old) {
      old.classList.add('leaving');
      setTimeout(() => {
        if (token !== swapToken) return;
        old.remove();
        stopMotion();
      }, FADE_MS);
    }
    return;
  }
  const part = build(c);
  const sameItem = old && previousKey.split('|')[0] === String(current);
  if (!old || sameItem) {
    // Primera aparición, o el mismo bolsillo/caja con datos nuevos: sin transición.
    mount(part);
    if (!old) enter(part);
    return;
  }
  // Cambio de bolsillo o de caja: sale el anterior y entra el siguiente.
  old.classList.add('leaving');
  setTimeout(() => {
    if (token !== swapToken) return;
    mount(part);
    enter(part);
  }, FADE_MS);
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'settings':
      settings = msg.settings;
      break;
    case 'game':
      data = msg.data.party || msg.data.bag || msg.data.pc ? msg.data : null;
      break;
    case 'species':
      for (const s of msg.entries) species.set(s.id, s);
      break;
    case 'showcase':
      // Una orden nueva empieza por el bolsillo o la caja pedidos; la misma orden
      // repetida (p. ej. al reconectar) no reinicia la rotación.
      if (JSON.stringify(msg.showcase) !== JSON.stringify(showcase)) current = null;
      showcase = msg.showcase;
      clearTimeout(showcaseTimer);
      // Respaldo local por si se pierde la conexión mientras se enseña.
      showcaseTimer = window.setTimeout(() => {
        showcase = null;
        render();
      }, msg.remainingMs + 250);
      break;
    case 'showcaseHide':
      showcase = null;
      clearTimeout(showcaseTimer);
      break;
    case 'location':
      playerLocation = msg.location;
      break;
    case 'slots':
      slot = msg.slots[view];
      break;
    case 'test':
      testing = msg.remainingMs > 0;
      clearTimeout(testTimer);
      // Respaldo local por si se pierde la conexión durante la prueba.
      if (testing) {
        testTimer = window.setTimeout(() => {
          testing = false;
          render();
        }, msg.remainingMs + 500);
      }
      break;
    default:
      return;
  }
  render();
}

connectSocket('team', onMessage, () => {}, preview || editor, editor);
