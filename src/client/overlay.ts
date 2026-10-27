import { applyColorVars, resolveColors } from '../shared/themes.js';
import type { Card, CardStyle, OverlayLayout, ServerMessage, Settings, ViewColors } from '../shared/types.js';
import { renderCard } from './cardView.js';
import { connectSocket } from './socket.js';

const STAGE_W = 1920;
const STAGE_H = 1080;
const FADE_MS = 400;

const stage = document.getElementById('stage')!;
const fontsReady = Promise.all(
  ["16px 'Silkscreen'", "700 16px 'Silkscreen'", "16px 'VT323'"].map((f) => document.fonts.load(f)),
).catch(() => []);
let layout: OverlayLayout = { scale: 1, anchor: 'top-right', offsetX: 48, offsetY: 48 };
/** Posición propia de la ficha y la de su grupo de turnos (si es de lugar compartido). */
let ownLayout = layout;
let groupLayout: OverlayLayout | null = null;
/** Colores de la ficha (tema o personalizados) y qué textos se ven. */
let cardColors: ViewColors | undefined;
let cardStyle: CardStyle | undefined;
/** Segundos entre intercambios de las tarjetas de un combate doble. */
let swapSec = 4;

interface Slot {
  seq: number;
  el: HTMLElement;
  /** Datos de las tarjetas (para repintarlas si cambian los colores). */
  cards: Card[];
  ready: Promise<boolean>;
  /** Intercambio periódico de las tarjetas (solo combates dobles). */
  swapTimer?: number;
}

/** Ficha visible (o en transición de entrada). */
let current: Slot | null = null;
/** Ficha precargada a la espera de "show". */
let prepared: Slot | null = null;
/** Último seq con el que se ha decidido algo; los procesos con un seq antiguo se abandonan. */
let token = 0;
let localTimer: number | undefined;

function applyLayout(el: HTMLElement) {
  const { scale, anchor, offsetX, offsetY } = layout;
  const [v, h] = anchor.split('-') as ['top' | 'bottom' | 'center', 'left' | 'right'];
  el.style.left = el.style.right = el.style.top = el.style.bottom = '';
  el.style[h] = `${offsetX}px`;
  if (v === 'center') {
    el.style.top = '50%';
    el.style.transform = `translateY(-50%) scale(${scale})`;
  } else {
    el.style[v] = `${offsetY}px`;
    el.style.transform = `scale(${scale})`;
  }
  el.style.transformOrigin = `${v === 'center' ? 'center' : v} ${h}`;
}

/**
 * Una tarjeta, o dos apiladas como una baraja en los combates dobles: la
 * primera delante y la segunda asomando detrás, desplazada y atenuada.
 */
function makeSlot(seq: number, cards: Card[]): Slot {
  const rendered = cards.map((c) => renderCard(c));
  const el = document.createElement('div');
  el.className = 'dex-slot measuring';
  const stack = document.createElement('div');
  stack.className = `dex-stack${cards.length > 1 ? ' double' : ''}`;
  rendered.forEach((r, i) => {
    r.element.classList.add(i === 0 ? 'front' : 'back');
    paintCard(r.element, cards[i]);
    stack.append(r.element);
  });
  el.append(stack);
  applyLayout(el);
  stage.append(el);
  // Lista cuando han cargado las imágenes y también las fuentes pixel art.
  const ready = Promise.all([...rendered.map((r) => r.ready), fontsReady]).then((r) => r.slice(0, -1).every(Boolean));
  return { seq, el, ready, cards };
}

/** Colores de la ficha (los del juego, un tema o los personalizados) y textos ocultos o alineados. */
function paintCard(el: HTMLElement, card: Card) {
  applyColorVars(el, resolveColors(cardColors, { accent: card.accent, accentDark: card.accentDark }));
  applyCardStyle(el);
}

function applyCardStyle(el: HTMLElement) {
  const st = cardStyle;
  el.classList.toggle('hide-number', st?.showNumber === false);
  el.classList.toggle('hide-types', st?.showTypes === false);
  el.classList.toggle('hide-desc', st?.showDescription === false);
  el.classList.toggle('hide-family', st?.showFamily === false);
  el.classList.toggle('hide-footer', st?.showFooter === false);
  el.style.setProperty('--desc-align', st?.descAlign ?? 'left');
}

function relayout() {
  layout = groupLayout ?? ownLayout;
  for (const s of [current, prepared, sample]) if (s) applyLayout(s.el);
}

/** Intercambia la tarjeta de delante y la de detrás cada `swapSec` segundos. */
function startSwapping(slot: Slot) {
  const cards = slot.el.querySelectorAll<HTMLElement>('.dex-stack.double > .dex-card');
  if (cards.length < 2) return;
  window.clearInterval(slot.swapTimer);
  slot.swapTimer = window.setInterval(() => {
    for (const c of cards) {
      const front = c.classList.contains('front');
      c.classList.toggle('front', !front);
      c.classList.toggle('back', front);
    }
  }, swapSec * 1000);
}

function removeSlot(slot: Slot | null) {
  if (!slot) return;
  window.clearInterval(slot.swapTimer);
  slot.el.remove();
}

function fadeOut(slot: Slot) {
  window.clearInterval(slot.swapTimer);
  slot.el.classList.remove('visible');
  slot.el.classList.add('leaving');
  // Se elimina del DOM al terminar: no queda ningún elemento visible.
  setTimeout(() => slot.el.remove(), FADE_MS);
}

function overflows(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.left < 0 || r.top < 0 || r.right > STAGE_W + 0.5 || r.bottom > STAGE_H + 0.5;
}

const params = new URLSearchParams(location.search);
/** Vista previa del editor de diseño: sin ficha en directo, enseña una de ejemplo. */
const editor = params.has('editor');
const socket = connectSocket('overlay', onMessage, () => {}, params.has('preview') || editor);

let lastSettings: Settings | null = null;
/** Ficha de ejemplo del editor (el Pokémon elegido en el panel, o Pikachu). */
let sample: Slot | null = null;
let sampleKey = '';

async function fetchCard(s: Settings, mode: string, species: number): Promise<Card | null> {
  const q = new URLSearchParams({ game: s.gameId, mode, sprite: s.spriteMode, text: s.textMode, species: String(species) });
  try {
    const res = await fetch(`/api/card?${q}`);
    return res.ok ? ((await res.json()) as Card) : null;
  } catch {
    return null;
  }
}

async function showSample() {
  const s = lastSettings;
  if (!editor || !s || current) return;
  const species = s.selectedSpeciesId ?? 25;
  const key = JSON.stringify([s.gameId, s.catalogMode, s.spriteMode, s.textMode, species]);
  if (key === sampleKey) return;
  sampleKey = key;
  const card =
    (await fetchCard(s, s.catalogMode, species)) ?? (await fetchCard(s, 'national', species)) ?? (await fetchCard(s, 'national', 1));
  if (!card || key !== sampleKey) return;
  const slot = makeSlot(-1, [card]);
  await slot.ready;
  if (key !== sampleKey || current) return removeSlot(slot);
  if (sample) removeSlot(sample);
  sample = slot;
  slot.el.classList.remove('measuring');
  slot.el.classList.add('visible');
}

function hideSample() {
  if (sample) removeSlot(sample);
  sample = null;
  sampleKey = '';
}

async function prepare(seq: number, cards: Card[]) {
  if (prepared?.seq === seq || current?.seq === seq) return;
  removeSlot(prepared);
  const slot = makeSlot(seq, cards);
  prepared = slot;
  const ok = await slot.ready;
  if (prepared !== slot) return;
  if (!ok) socket.send({ type: 'overlayError', seq, message: 'Alguna imagen no se pudo cargar en el overlay.' });
  socket.send({ type: 'ready', seq, overflow: overflows(slot.el) });
}

async function show(seq: number, cards: Card[], remainingMs: number) {
  const receivedAt = performance.now();
  token = seq;
  if (current?.seq === seq) {
    // Reconexión con la misma ficha: solo se resincroniza el temporizador.
    armTimer(seq, remainingMs);
    return;
  }
  let slot: Slot;
  if (prepared?.seq === seq) {
    slot = prepared;
    prepared = null;
  } else {
    removeSlot(prepared);
    prepared = null;
    slot = makeSlot(seq, cards);
  }
  await slot.ready;
  const left = remainingMs - (performance.now() - receivedAt);
  if (token !== seq || left <= 0) {
    removeSlot(slot);
    return;
  }
  if (current) fadeOut(current);
  hideSample();
  current = slot;
  slot.el.classList.remove('measuring');
  // Forzar el estilo inicial antes de la transición de entrada.
  void slot.el.offsetWidth;
  slot.el.classList.add('visible');
  startSwapping(slot);
  armTimer(seq, left);
}

/** Respaldo local por si se pierde la conexión con el servidor durante el directo. */
function armTimer(seq: number, ms: number) {
  clearTimeout(localTimer);
  localTimer = window.setTimeout(() => hide(seq), ms + 250);
}

function hide(seq: number) {
  token = Math.max(token, seq);
  clearTimeout(localTimer);
  removeSlot(prepared);
  prepared = null;
  if (current) fadeOut(current);
  current = null;
  if (editor) setTimeout(() => void showSample(), FADE_MS);
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'settings':
      ownLayout = msg.settings.overlay;
      cardColors = msg.settings.views.colors.card;
      cardStyle = msg.settings.views.styles.card;
      for (const s of [current, prepared, sample]) {
        s?.el.querySelectorAll<HTMLElement>('.dex-card').forEach((el, i) => paintCard(el, s.cards[i]));
      }
      relayout();
      lastSettings = msg.settings;
      void showSample();
      if (msg.settings.doubleSwapSec !== swapSec) {
        swapSec = msg.settings.doubleSwapSec;
        if (current) startSwapping(current);
      }
      break;
    case 'slots':
      groupLayout = msg.slots.card?.layout ?? null;
      relayout();
      break;
    case 'prepare':
      void prepare(msg.seq, msg.cards);
      break;
    case 'show':
      void show(msg.seq, msg.cards, msg.remainingMs);
      break;
    case 'hide':
      hide(msg.seq);
      break;
  }
}
