import type {
  BadgesStyle,
  BagEntry,
  BagStyle,
  BoxSlot,
  GameData,
  MapStyle,
  PartySlot,
  PartyStyle,
  PcStyle,
  PlayerLocation,
  SpeciesBrief,
} from '../shared/types.js';
import { levelFromExp, type GrowthRate } from '../shared/growth.js';
import { DEFAULT_STYLES } from '../shared/styles.js';

// Piezas visuales de la partida, con los gráficos originales de Esmeralda que
// sirve el servidor en /gba/… (mapa, caras, mochila, Poké Balls, medallas, fondos
// de caja e iconos de objetos). Las comparten los overlays y el panel.

export type SpeciesMap = Map<number, SpeciesBrief>;
type Gender = 'male' | 'female';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Imagen pixel art (sin suavizado); si no carga, desaparece. */
function pixelImg(src: string, cls: string, alt = ''): HTMLImageElement {
  const img = el('img', cls);
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  img.onerror = () => img.remove();
  return img;
}

const genderOf = (data: GameData): Gender => data.player?.gender ?? 'male';

/** Estado alterado de la Gen III (bits de status): abreviatura en español. */
function statusLabel(status: number): string | null {
  if (status & 0x7) return 'DOR';
  if (status & 0x80) return 'GRA';
  if (status & 0x8) return 'ENV';
  if (status & 0x10) return 'QUE';
  if (status & 0x20) return 'CON';
  if (status & 0x40) return 'PAR';
  return null;
}

/** Sprite de una especie (normal o variocolor), un huevo, o un hueco si aún no se ha cargado. */
function sprite(species: SpeciesMap, id: number | null, shiny: boolean, egg: boolean, cls: string): HTMLElement {
  const box = el('div', cls);
  if (egg) {
    box.append(el('span', 'gm-egg'));
    return box;
  }
  const info = id ? species.get(id) : undefined;
  const src = (shiny && info?.spriteShiny) || info?.sprite;
  if (src) box.append(pixelImg(src, '', info!.name));
  else box.append(el('span', 'gm-missing', '?'));
  return box;
}

export function speciesName(species: SpeciesMap, id: number | null): string {
  if (!id) return '???';
  return species.get(id)?.name ?? `N.º ${id}`;
}

function hpBar(hp: number, max: number): HTMLElement {
  const ratio = max ? hp / max : 0;
  const bar = el('div', 'gm-hp');
  const fill = el('div', `gm-hp-fill ${ratio > 0.5 ? 'high' : ratio > 0.2 ? 'mid' : 'low'}`);
  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  bar.append(fill);
  return bar;
}

// ── Equipo: Poké Ball de captura · datos · sprite ────────────────────────────

function partySlot(m: PartySlot, species: SpeciesMap, style: PartyStyle): HTMLElement {
  const slot = el('div', `gm-mon${m.hp === 0 && !m.isEgg ? ' fainted' : ''}${m.shiny ? ' shiny' : ''}`);
  const ball = el('div', 'gm-ball');
  if (!m.isEgg) ball.append(pixelImg(`/gba/ball-${m.ball >= 1 && m.ball <= 12 ? m.ball : 4}.png`, 'gm-ball-img'));
  const info = el('div', 'gm-data');
  if (style.showNickname || m.isEgg) {
    const name = el('div', 'gm-name', m.isEgg ? 'Huevo' : m.nickname || speciesName(species, m.species));
    if (m.shiny) name.prepend(el('span', 'gm-star', '★'));
    info.append(name);
  }
  if (!m.isEgg) {
    const line = el('div', 'gm-line');
    if (style.showLevel) line.append(el('span', 'gm-level', `Nv.${m.level}`));
    const st = m.hp === 0 ? 'DEB' : statusLabel(m.status);
    if (st && style.showStatus) line.append(el('span', `gm-status s-${st}`, st));
    if (style.showHpText) line.append(el('span', 'gm-hp-text', `${m.hp}/${m.maxHp}`));
    if (line.childElementCount) info.append(line);
    if (style.showHpBar) info.append(hpBar(m.hp, m.maxHp));
  }
  slot.append(ball, info, sprite(species, m.species, m.shiny, m.isEgg, 'gm-sprite'));
  return slot;
}

export const DEFAULT_PARTY_STYLE: PartyStyle = DEFAULT_STYLES.party;

/**
 * Equipo en vertical (6 filas), en 2 columnas de 3 o en horizontal (6 columnas),
 * con el sprite a la izquierda o a la derecha (la Poké Ball, al otro lado).
 */
export function renderParty(data: GameData, species: SpeciesMap, style: PartyStyle = DEFAULT_PARTY_STYLE): HTMLElement {
  const wrap = el(
    'div',
    `gm-party layout-${style.layout} sprite-${style.spriteSide} text-${style.textAlign}${style.showBall ? '' : ' no-ball'}`,
  );
  wrap.style.setProperty('--sprite-scale', String(style.spriteScale));
  wrap.style.setProperty('--text-size', `${style.textSize}px`);
  for (const m of data.party ?? []) wrap.append(partySlot(m, species, style));
  return wrap;
}

// ── Medallas (pixel art de la tarjeta de entrenador) ─────────────────────────

export function renderBadges(data: GameData, style: BadgesStyle = DEFAULT_STYLES.badges): HTMLElement {
  const withNames = style.names;
  const wrap = el('div', `gm-badges${withNames ? ' named' : ''}`);
  wrap.style.setProperty('--badge-cols', String(style.columns));
  wrap.style.setProperty('--badge-size', `${16 * style.size}px`);
  const badges = data.badges ?? [];
  if (style.showTitle) wrap.append(el('span', 'gm-badges-title', `Medallas ${badges.filter((b) => b.owned).length}/8`));
  const row = el('div', 'gm-badge-row');
  badges.forEach((b, i) => {
    const badge = el('div', `gm-badge${b.owned ? ' owned' : ''}`);
    badge.title = `Medalla ${b.name}`;
    badge.append(pixelImg(`/gba/badge-${i}.png`, 'gm-badge-img', `Medalla ${b.name}`));
    if (withNames) badge.append(el('span', 'gm-badge-name', b.name));
    row.append(badge);
  });
  wrap.append(row);
  return wrap;
}

// ── Mochila: la mochila original abierta por el bolsillo, y sus objetos ──────

const BAG_FRAME: Record<string, number> = { items: 1, balls: 2, tmhm: 3, berries: 4, key: 5 };

function bagItem(it: BagEntry, showName: boolean, showQuantity: boolean): HTMLElement {
  const row = el('div', 'gm-item');
  const icon = el('div', 'gm-item-icon');
  if (it.icon) icon.append(pixelImg(it.icon, '', it.name ?? ''));
  row.append(icon);
  if (showName) row.append(el('span', 'gm-item-name', it.name ?? `Objeto ${it.id}`));
  if (showQuantity) row.append(el('span', 'gm-item-qty', `×${it.quantity}`));
  return row;
}

export const DEFAULT_BAG_STYLE: BagStyle = DEFAULT_STYLES.bag;

/**
 * Bolsillo de la mochila: la imagen de la mochila abierta y la lista de objetos
 * a su izquierda, derecha, arriba o abajo, en 1–3 columnas. La lista enseña
 * `rows` filas; si hay más objetos, startScrolling la desplaza despacio.
 */
export function renderPocket(data: GameData, pocketId: string, style: BagStyle = DEFAULT_BAG_STYLE): HTMLElement {
  const pocket = data.bag?.find((p) => p.id === pocketId);
  const wrap = el('div', `gm-pocket list-${style.listPosition}`);
  wrap.style.setProperty('--bag-size', `${64 * style.bagSize}px`);
  wrap.style.setProperty('--icon-size', `${24 * style.iconSize}px`);
  wrap.style.setProperty('--text-size', `${style.textSize}px`);
  wrap.style.setProperty('--cols', String(style.columns));
  wrap.style.setProperty('--rows', String(style.rows));
  const bag = el('div', 'gm-bag');
  bag.append(pixelImg(`/gba/bag-${genderOf(data)}-${BAG_FRAME[pocketId] ?? 0}.png`, 'gm-bag-img', 'Mochila'));
  wrap.append(bag);
  if (!pocket || pocket.items.length === 0) {
    wrap.append(el('p', 'gm-empty', 'Bolsillo vacío'));
    return wrap;
  }
  const win = el('div', `gm-items-window${style.scroll ? ' scrolling' : ''}`);
  const list = el('div', 'gm-items');
  for (const it of pocket.items) list.append(bagItem(it, style.showNames, style.showQuantity && pocket.id !== 'key'));
  win.append(list);
  wrap.append(win);
  return wrap;
}

/**
 * Desplazamiento lento de la lista cuando no cabe: baja hasta el final, se para
 * un momento y vuelve arriba. Devuelve la función para detenerlo.
 */
export function startScrolling(root: HTMLElement, pxPerSec = 18): () => void {
  const win = root.querySelector<HTMLElement>('.gm-items-window.scrolling');
  const list = win?.querySelector<HTMLElement>('.gm-items');
  if (!win || !list) return () => {};
  let anim: Animation | null = null;
  const start = () => {
    anim?.cancel();
    const distance = list.scrollHeight - win.clientHeight;
    if (distance <= 2) return;
    const travel = (distance / pxPerSec) * 1000;
    const pause = 1500;
    const total = travel + pause * 2;
    anim = list.animate(
      [
        { transform: 'translateY(0)', offset: 0 },
        { transform: 'translateY(0)', offset: pause / total },
        { transform: `translateY(${-distance}px)`, offset: (pause + travel) / total },
        { transform: `translateY(${-distance}px)`, offset: 1 },
      ],
      { duration: total, iterations: Infinity, direction: 'alternate', easing: 'linear' },
    );
  };
  // Se mide cuando han cargado los iconos y las fuentes.
  const timer = window.setTimeout(start, 300);
  return () => {
    window.clearTimeout(timer);
    anim?.cancel();
  };
}

// ── PC ───────────────────────────────────────────────────────────────────────

export function boxLevel(m: BoxSlot, species: SpeciesMap): number | null {
  const rate = m.species ? species.get(m.species)?.growthRate : null;
  return rate ? levelFromExp(rate as GrowthRate, m.experience) : null;
}

/** Caja del PC para el panel: cuadrícula con niveles. */
export function renderBox(data: GameData, boxIndex: number, species: SpeciesMap): HTMLElement {
  const box = data.pc?.boxes[boxIndex];
  const grid = el('div', 'gm-box');
  for (let i = 0; i < 30; i++) {
    const m = box?.mons[i] ?? null;
    const cell = el('div', `gm-cell${m ? '' : ' empty'}${m?.shiny ? ' shiny' : ''}`);
    if (m) {
      cell.append(sprite(species, m.species, m.shiny, m.isEgg, 'gm-cell-sprite'));
      const level = m.isEgg ? null : boxLevel(m, species);
      const name = m.isEgg ? 'Huevo' : m.nickname || speciesName(species, m.species);
      cell.title = level ? `${name} · Nv.${level}` : name;
      if (level) cell.append(el('span', 'gm-cell-level', String(level)));
    }
    grid.append(cell);
  }
  return grid;
}

/** Interior de la caja donde flotan los Pokémon, en píxeles originales. */
const PC_AREA = { x: 8, y: 32, w: 144, h: 104 };

/**
 * Caja del PC para el directo: el fondo original de la caja con su nombre, y los
 * Pokémon flotando por dentro (empiezan en su hueco; startBouncing los mueve).
 */
export function renderPcBox(
  data: GameData,
  boxIndex: number,
  species: SpeciesMap,
  style: PcStyle = DEFAULT_STYLES.pc,
): HTMLElement {
  const box = data.pc?.boxes[boxIndex];
  const scale = style.scale;
  const pc = el('div', 'gm-pc');
  pc.style.setProperty('--pc-scale', String(scale));
  pc.dataset.scale = String(scale);
  pc.dataset.speed = String(style.speed);
  pc.append(pixelImg(`/gba/wallpaper-${box?.wallpaper ?? 0}.png`, 'gm-pc-bg'));
  if (style.showName) pc.append(el('div', `gm-pc-name align-${style.nameAlign}`, box?.name ?? `CAJA ${boxIndex + 1}`));
  const area = el('div', 'gm-pc-area');
  area.style.left = `${PC_AREA.x * scale}px`;
  area.style.top = `${PC_AREA.y * scale}px`;
  area.style.width = `${PC_AREA.w * scale}px`;
  area.style.height = `${PC_AREA.h * scale}px`;
  (box?.mons ?? []).forEach((m, i) => {
    if (!m) return;
    const s = sprite(species, m.species, m.shiny, m.isEgg, 'gm-pc-mon');
    s.dataset.slot = String(i);
    area.append(s);
  });
  pc.append(area);
  return pc;
}

/** Tamaño de un sprite flotando en la caja, en px. */
const MON_SIZE = 64;

/**
 * Mueve los Pokémon de la caja: cada uno sale de su hueco en una dirección al
 * azar y rebota al tocar un lateral. Devuelve la función para detenerlo.
 */
export function startBouncing(pc: HTMLElement, speed = Number(pc.dataset.speed ?? 45)): () => void {
  const area = pc.querySelector<HTMLElement>('.gm-pc-area');
  if (!area) return () => {};
  const scale = Number(pc.dataset.scale ?? 3);
  const w = PC_AREA.w * scale - MON_SIZE;
  const h = PC_AREA.h * scale - MON_SIZE;
  const mons = [...area.querySelectorAll<HTMLElement>('.gm-pc-mon')].map((node) => {
    const slot = Number(node.dataset.slot);
    const angle = Math.random() * Math.PI * 2;
    const v = speed * (0.7 + Math.random() * 0.6);
    return {
      node,
      // Hueco de partida (6 × 5) repartido por el interior de la caja.
      x: ((slot % 6) / 5) * w,
      y: (Math.floor(slot / 6) / 4) * h,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
    };
  });
  let last = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const m of mons) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < 0 || m.x > w) {
        m.vx = -m.vx;
        m.x = Math.max(0, Math.min(w, m.x));
      }
      if (m.y < 0 || m.y > h) {
        m.vy = -m.vy;
        m.y = Math.max(0, Math.min(h, m.y));
      }
      m.node.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      m.node.classList.toggle('flip', m.vx > 0);
    }
    frame = requestAnimationFrame(step);
  };
  step(last);
  return () => cancelAnimationFrame(frame);
}

export function countBox(data: GameData, boxIndex: number): number {
  return data.pc?.boxes[boxIndex]?.mons.filter(Boolean).length ?? 0;
}

// ── Minimapa: el mapa original de Hoenn con la cara del personaje ────────────

/** Mapa original de Hoenn con el icono del personaje; la posición se actualiza con placeMarker. */
export function renderMap(gender: Gender, style: MapStyle = DEFAULT_STYLES.map): HTMLElement {
  const map = el('div', 'gm-map');
  map.style.setProperty('--map-scale', String(style.scale));
  map.dataset.scale = String(style.scale);
  map.append(pixelImg('/gba/region-map.png', 'gm-map-img', 'Mapa de Hoenn'));
  const marker = el('div', 'gm-marker');
  marker.append(pixelImg(`/gba/face-${gender}.png`, 'gm-face', gender === 'female' ? 'Aura' : 'Bruno'));
  map.append(marker);
  return map;
}

/**
 * Coloca la cara: en el mapa del juego, la zona (x, y) de la tabla está en la
 * casilla (x + 1, y + 2) de 8 × 8 píxeles. Si la zona no está en Hoenn, se oculta.
 */
export function placeMarker(map: HTMLElement, loc: PlayerLocation | null, animate = true) {
  const marker = map.querySelector<HTMLElement>('.gm-marker');
  if (!marker) return;
  const visible = !!loc && loc.x !== null && loc.y !== null;
  marker.hidden = !visible;
  if (!visible) return;
  if (!animate) marker.style.transition = 'none';
  const scale = Number(map.dataset.scale ?? 2);
  marker.style.left = `${(loc!.x! + 1) * 8 * scale}px`;
  marker.style.top = `${(loc!.y! + 2) * 8 * scale}px`;
  if (!animate) {
    void marker.offsetWidth;
    marker.style.transition = '';
  }
}
