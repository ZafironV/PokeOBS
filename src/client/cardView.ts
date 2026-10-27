import type { Card, EvoNode } from '../shared/types.js';
import { typeColor } from '../shared/pokemonTypes.js';
import { padNumber } from '../shared/text.js';

/** Lado máximo del sprite principal (interior de la pantalla) y de los de la familia, en px CSS. */
const MAIN_BOX = 196;
const FAMILY_BOX = 64;
/**
 * Tamaño mínimo de referencia del contenido recortado: evita que un Pokémon
 * pequeño se amplíe más que uno grande y conserva los tamaños relativos del juego.
 */
const MAIN_MIN_CONTENT = 56;
const FAMILY_MIN_CONTENT = 40;
/** A partir de este número de ramas, los hijos se dibujan en fila bajo el padre (p. ej. Eevee). */
const FAN_THRESHOLD = 4;
/** Con más ramas que esto, la fila usa nodos compactos (Eevee en Gen IV y posteriores). */
const FAN_COMPACT = 5;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Escalado de pixel art: ampliaciones enteras con bordes nítidos para no
 * deformar los píxeles; si el sprite no cabe, se reduce a la mitad o al
 * tamaño del recuadro, conservando siempre las proporciones.
 */
export function pixelScale(width: number, height: number, box: number): number {
  const side = Math.max(width, height);
  if (side <= 0) return 1;
  if (side <= box) return Math.max(1, Math.floor(box / side));
  if (side / 2 <= box) return 0.5;
  return box / side;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zona con píxeles no transparentes (los sprites antiguos traen mucho margen vacío). */
function contentBox(img: HTMLImageElement): Box | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  } catch {
    return null;
  }
}

/**
 * Carga y dimensiona un sprite. Con `trim`, el escalado se calcula sobre el
 * contenido visible y se centra ese contenido; el margen sobrante queda
 * recortado por el contenedor. No se usa con sprites animados porque los
 * fotogramas posteriores pueden ocupar más que el primero.
 * Con `smooth` (renders 3D) se ajusta al recuadro con suavizado, sin
 * factores enteros, y como mucho se amplía `maxUpscale` veces.
 */
interface ImageOptions {
  trim?: boolean;
  minContent?: number;
  smooth?: boolean;
  maxUpscale?: number;
}

function loadImage(img: HTMLImageElement, box: number, opts: ImageOptions): Promise<boolean> {
  const { trim = false, minContent = 0, smooth = false, maxUpscale = 2 } = opts;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      if (ok) {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const bb = (trim && contentBox(img)) || { x: 0, y: 0, w: nw, h: nh };
        const side = Math.max(bb.w, bb.h, minContent);
        const s = smooth ? Math.min(box / side, maxUpscale) : pixelScale(side, side, box);
        img.style.width = `${nw * s}px`;
        img.style.height = `${nh * s}px`;
        const dx = (nw / 2 - (bb.x + bb.w / 2)) * s;
        const dy = (nh / 2 - (bb.y + bb.h / 2)) * s;
        if (dx || dy) img.style.translate = `${dx}px ${dy}px`;
        // Las reducciones no enteras se suavizan; el resto, píxel nítido.
        if (!smooth && (s >= 1 || s === 0.5)) img.classList.add('pixel');
      } else {
        img.classList.add('broken');
      }
      resolve(ok);
    };
    if (img.complete && img.naturalWidth > 0) done(true);
    else {
      img.onload = () => done(true);
      img.onerror = () => done(false);
    }
  });
}

function evoBranch(node: EvoNode, images: Promise<boolean>[], smooth: boolean): HTMLElement {
  const branch = el('div', 'evo-branch');
  const n = el('div', `evo-node${node.selected ? ' selected' : ''}`);
  const frame = el('div', 'evo-sprite');
  if (node.sprite) {
    const img = el('img');
    img.alt = '';
    img.src = node.sprite;
    images.push(
      loadImage(img, FAMILY_BOX, { trim: !smooth, minContent: smooth ? 0 : FAMILY_MIN_CONTENT, smooth, maxUpscale: 1.5 }),
    );
    frame.append(img);
  } else {
    frame.append(el('span', 'evo-missing', '?'));
  }
  n.append(frame, el('span', 'evo-name', node.name));
  branch.append(n);
  if (node.children.length) {
    if (node.children.length >= FAN_THRESHOLD) branch.classList.add('fan');
    if (node.children.length > FAN_COMPACT) branch.classList.add('compact');
    const kids = el('div', 'evo-children');
    for (const c of node.children) kids.append(evoBranch(c, images, smooth));
    branch.append(kids);
  }
  return branch;
}

export interface RenderedCard {
  element: HTMLElement;
  /** Se resuelve cuando todas las imágenes han cargado (o fallado). Devuelve true si todas cargaron. */
  ready: Promise<boolean>;
}

export function renderCard(card: Card): RenderedCard {
  const images: Promise<boolean>[] = [];
  const root = el('article', 'dex-card');
  root.style.setProperty('--accent', card.accent);
  root.style.setProperty('--accent-dark', card.accentDark);

  const head = el('header', 'dex-head');
  const lights = el('div', 'dex-lights');
  lights.append(el('span', 'lens'), el('span', 'led led-r'), el('span', 'led led-y'), el('span', 'led led-g'));
  const title = el('div', 'dex-title');
  const num = el('span', 'dex-num');
  // "N.º" en VT323: Silkscreen no tiene un glifo legible para "º".
  num.append(el('span', 'dex-numprefix', 'N.º'), padNumber(card.number), el('small', 'dex-numlabel', card.numberLabel));
  title.append(num, el('span', 'dex-name', card.name));
  head.append(lights, title);
  // Primera vez que el jugador ve esta especie en su partida (detección automática).
  if (card.isNew) head.append(el('span', 'dex-new', '¡Nuevo!'));

  const body = el('div', 'dex-body');
  const screen = el('div', 'dex-screen');
  if (card.sprite) {
    const img = el('img', 'dex-sprite');
    img.alt = card.name;
    img.src = card.sprite.url;
    const smooth = card.sprite.render3d;
    const trim = !card.sprite.animated && !smooth;
    images.push(loadImage(img, MAIN_BOX, { trim, minContent: trim ? MAIN_MIN_CONTENT : 0, smooth, maxUpscale: 3 }));
    screen.append(img);
  } else {
    screen.append(el('span', 'dex-nosprite', '?'));
  }

  const info = el('div', 'dex-info');
  const types = el('div', 'dex-types');
  for (const t of card.types) {
    const tag = el('span', 'dex-type', t.label);
    tag.style.setProperty('--type', typeColor(t.id));
    types.append(tag);
  }
  info.append(types);
  if (card.description.status === 'ok') {
    // Los textos largos (p. ej. Rubí Omega) usan letra algo menor; nunca se recortan.
    const desc = el('p', `dex-desc${card.description.text.length > 150 ? ' long' : ''}`, card.description.text);
    if (card.description.lang !== 'es') desc.lang = card.description.lang;
    info.append(desc);
    if (card.description.lang === 'en') info.append(el('span', 'dex-lang', 'Texto original en inglés'));
    else if (card.description.approxFrom) info.append(el('span', 'dex-lang', `Texto de ${card.description.approxFrom}`));
  } else {
    info.append(el('p', 'dex-desc missing', 'Descripción no disponible para esta edición.'));
  }
  body.append(screen, info);

  const fam = el('section', 'dex-family');
  fam.append(el('h3', 'dex-family-title', 'Familia evolutiva'));
  const onlySelf = card.family.length === 1 && card.family[0].children.length === 0;
  if (card.family.length === 0) {
    fam.append(el('p', 'dex-family-empty', 'No disponible'));
  } else if (onlySelf) {
    fam.append(el('p', 'dex-family-empty', 'No evoluciona en esta edición'));
  } else {
    const tree = el('div', 'evo-tree');
    for (const r of card.family) tree.append(evoBranch(r, images, card.familySmooth));
    fam.append(tree);
  }

  const foot = el('footer', 'dex-foot', `${card.gameName} · ${card.platform}`);
  root.append(head, body, fam, foot);

  return { element: root, ready: Promise.all(images).then((r) => r.every(Boolean)) };
}
