import { resolveColors, THEME_LABELS } from '../shared/themes.js';
import type {
  ColorSet,
  GameView,
  OverlayLayout,
  RotationGroup,
  Settings,
  SlotItem,
  SlotState,
  ThemeId,
  ViewStyles,
} from '../shared/types.js';

// Pestañas «Diseño» y «Turnos» del panel: se elige un elemento, se ve en grande
// y se ajustan su posición, presentación, textos y colores; y los grupos de turnos.

export interface DesignPanelDeps {
  settings(): Settings;
  save(patch: Partial<Settings>): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const ITEM_LABELS: Record<SlotItem, string> = {
  card: 'Ficha',
  party: 'Equipo',
  badges: 'Medallas',
  bag: 'Mochila',
  pc: 'PC',
  map: 'Mapa',
};

const VISIBLE_HINT: Record<GameView, string> = {
  party: '',
  badges: '',
  bag: 'Si no está fija, la mochila solo aparece al pulsar «Mostrar la mochila en directo» (o en su turno, si está en un grupo).',
  pc: 'Si no está fijo, el PC solo aparece al pulsar «Mostrar el PC en directo» (o en su turno). Fijo, se vuelve a leer cada 30 s.',
  map: '',
};

type Field =
  | { key: string; label: string; type: 'select'; options: [string, string][]; numeric?: boolean }
  | { key: string; label: string; type: 'check' }
  | { key: string; label: string; type: 'align'; justify?: boolean }
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; fmt: (v: number) => string };

const px = (v: number) => `${v} px`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Opciones de presentación de cada elemento. */
const FIELDS: Record<SlotItem, Field[]> = {
  card: [],
  party: [
    {
      key: 'layout',
      label: 'Disposición',
      type: 'select',
      options: [
        ['vertical', 'Vertical (6 filas)'],
        ['grid', '2 columnas de 3'],
        ['horizontal', 'Horizontal (6 columnas)'],
      ],
    },
    {
      key: 'spriteSide',
      label: 'Sprite',
      type: 'select',
      options: [
        ['right', 'A la derecha (Poké Ball a la izquierda)'],
        ['left', 'A la izquierda (Poké Ball a la derecha)'],
      ],
    },
    { key: 'showBall', label: 'Mostrar la Poké Ball de captura', type: 'check' },
    { key: 'spriteScale', label: 'Tamaño del sprite', type: 'range', min: 1, max: 2, step: 0.5, fmt: pct },
    { key: 'textSize', label: 'Tamaño del texto', type: 'range', min: 14, max: 32, step: 1, fmt: px },
  ],
  badges: [
    {
      key: 'columns',
      label: 'Colocación',
      type: 'select',
      numeric: true,
      options: [
        ['8', '1 fila de 8'],
        ['4', '2 filas de 4'],
        ['2', '4 filas de 2'],
        ['1', '1 columna'],
      ],
    },
    { key: 'size', label: 'Tamaño de las medallas', type: 'range', min: 2, max: 5, step: 1, fmt: (v) => px(16 * v) },
  ],
  bag: [
    {
      key: 'listPosition',
      label: 'Lista de objetos (respecto a la mochila)',
      type: 'select',
      options: [
        ['right', 'A la derecha'],
        ['left', 'A la izquierda'],
        ['bottom', 'Debajo'],
        ['top', 'Encima'],
      ],
    },
    {
      key: 'columns',
      label: 'Columnas de la lista',
      type: 'select',
      numeric: true,
      options: [
        ['1', '1 columna'],
        ['2', '2 columnas'],
        ['3', '3 columnas'],
      ],
    },
    { key: 'rows', label: 'Filas visibles', type: 'range', min: 3, max: 15, step: 1, fmt: (v) => `${v} filas` },
    { key: 'scroll', label: 'Si no caben, desplazar la lista despacio', type: 'check' },
    { key: 'bagSize', label: 'Tamaño de la mochila', type: 'range', min: 1, max: 3, step: 1, fmt: (v) => px(64 * v) },
    { key: 'iconSize', label: 'Tamaño de los iconos', type: 'range', min: 1, max: 2, step: 1, fmt: (v) => px(24 * v) },
    { key: 'textSize', label: 'Tamaño del texto', type: 'range', min: 14, max: 32, step: 1, fmt: px },
  ],
  pc: [
    { key: 'scale', label: 'Tamaño de la caja', type: 'range', min: 2, max: 4, step: 1, fmt: (v) => `${160 * v} × ${144 * v} px` },
    { key: 'speed', label: 'Velocidad de los Pokémon', type: 'range', min: 0, max: 120, step: 5, fmt: (v) => (v ? `${v} px/s` : 'Quietos') },
  ],
  map: [
    { key: 'scale', label: 'Tamaño del mapa', type: 'range', min: 1, max: 3, step: 1, fmt: (v) => `${240 * v} × ${160 * v} px` },
  ],
};

/** Textos de cada elemento: cuáles se ven y cómo se alinean. */
const TEXT_FIELDS: Record<SlotItem, Field[]> = {
  card: [
    { key: 'showNumber', label: 'Número de la Pokédex', type: 'check' },
    { key: 'showTypes', label: 'Tipos', type: 'check' },
    { key: 'showDescription', label: 'Descripción', type: 'check' },
    { key: 'descAlign', label: 'Alineación de la descripción', type: 'align', justify: true },
    { key: 'showFamily', label: 'Línea evolutiva', type: 'check' },
    { key: 'showFooter', label: 'Pie con el nombre del juego', type: 'check' },
  ],
  party: [
    { key: 'showNickname', label: 'Mote', type: 'check' },
    { key: 'showLevel', label: 'Nivel', type: 'check' },
    { key: 'showHpBar', label: 'Barra de PS', type: 'check' },
    { key: 'showHpText', label: 'PS en números', type: 'check' },
    { key: 'showStatus', label: 'Estado (envenenado, dormido…)', type: 'check' },
    { key: 'textAlign', label: 'Alineación', type: 'align' },
  ],
  badges: [
    { key: 'showTitle', label: 'Título («Medallas 3/8»)', type: 'check' },
    { key: 'names', label: 'Nombres de las medallas', type: 'check' },
  ],
  bag: [
    { key: 'showTitle', label: 'Título («Mochila · Objetos»)', type: 'check' },
    { key: 'titleAlign', label: 'Alineación del título', type: 'align' },
    { key: 'showNames', label: 'Nombres de los objetos', type: 'check' },
    { key: 'showQuantity', label: 'Cantidades', type: 'check' },
  ],
  pc: [
    { key: 'showName', label: 'Nombre de la caja', type: 'check' },
    { key: 'nameAlign', label: 'Alineación del nombre', type: 'align' },
  ],
  map: [
    {
      key: 'labelPosition',
      label: 'Nombre de la zona',
      type: 'select',
      options: [
        ['bottom', 'Debajo del mapa'],
        ['top', 'Encima del mapa'],
        ['hidden', 'Oculto'],
      ],
    },
    { key: 'labelAlign', label: 'Alineación del nombre', type: 'align' },
  ],
};

const ALIGN_LABELS: [string, string][] = [
  ['left', 'Izquierda'],
  ['center', 'Centro'],
  ['right', 'Derecha'],
];

const COLOR_LABELS: [keyof ColorSet, string][] = [
  ['frame', 'Marco (arriba)'],
  ['frameDark', 'Marco (abajo)'],
  ['border', 'Borde'],
  ['text', 'Texto del marco'],
  ['title', 'Títulos'],
  ['panel', 'Recuadros'],
  ['panelText', 'Texto de los recuadros'],
];

const ANCHORS: [string, string][] = [
  ['top-left', 'Arriba a la izquierda'],
  ['top-right', 'Arriba a la derecha'],
  ['center-left', 'Centro a la izquierda'],
  ['center-right', 'Centro a la derecha'],
  ['bottom-left', 'Abajo a la izquierda'],
  ['bottom-right', 'Abajo a la derecha'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Campo con etiqueta (y valor en negrita para los deslizadores). */
function labeled(label: string, control: HTMLElement, value?: HTMLElement): HTMLLabelElement {
  const l = el('label', 'field');
  const span = el('span', undefined, label);
  if (value) span.append(': ', value);
  l.append(span, control);
  return l;
}

function rangeInput(min: number, max: number, step: number, value: number): HTMLInputElement {
  const i = el('input');
  i.type = 'range';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  return i;
}

function selectInput(options: [string, string][], value: string): HTMLSelectElement {
  const s = el('select');
  for (const [v, t] of options) {
    const o = el('option', undefined, t);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  return s;
}

function checkInput(label: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] {
  const l = el('label', 'check');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = checked;
  l.append(i, el('span', undefined, label));
  return [l, i];
}

/** Controles de posición (esquina, escala, márgenes) que guardan con `save`. */
function layoutControls(layout: OverlayLayout, save: (l: OverlayLayout) => void): HTMLElement[] {
  const anchor = selectInput(ANCHORS, layout.anchor);
  anchor.addEventListener('change', () => save({ ...layout, anchor: anchor.value as OverlayLayout['anchor'] }));
  const out: HTMLElement[] = [labeled('Esquina', anchor)];
  for (const [key, label, min, max, step, fmt] of [
    ['scale', 'Escala', 0.5, 2, 0.05, pct],
    ['offsetX', 'Margen horizontal', 0, 1000, 4, px],
    ['offsetY', 'Margen vertical', 0, 1000, 4, px],
  ] as const) {
    const value = el('strong', undefined, fmt(layout[key]));
    const input = rangeInput(min, max, step, layout[key]);
    input.addEventListener('input', () => (value.textContent = fmt(Number(input.value))));
    input.addEventListener('change', () => save({ ...layout, [key]: Number(input.value) }));
    out.push(labeled(label, input, value));
  }
  return out;
}

/** Overlay de OBS que enseña cada elemento (la vista previa carga el mismo). */
const PATHS: Record<SlotItem, string> = {
  card: '/overlay',
  party: '/equipo',
  badges: '/medallas',
  bag: '/mochila',
  pc: '/pc',
  map: '/mapa',
};

const TARGET_KEY = 'pokeobs.designTarget';

/** Margen alrededor del elemento ampliado, en píxeles del lienzo. */
const ZOOM_PAD = 16;

/**
 * Vista previa del editor: el overlay real en un lienzo de 1920 × 1080, ampliado
 * sobre el elemento o entero. Es de la misma web, así que se mide el elemento dentro.
 */
function editorPreview(stage: HTMLElement) {
  let frame: HTMLIFrameElement | null = null;
  let mode: 'zoom' | 'canvas' = 'zoom';
  let timer: number | undefined;
  let last = '';

  /** Rectángulo del elemento dentro del lienzo, o null si aún no se ve. */
  function measure(): DOMRect | null {
    const doc = frame?.contentDocument;
    if (!doc) return null;
    const node = doc.querySelector('.dex-slot.visible') ?? doc.getElementById('view-root');
    const r = node?.getBoundingClientRect();
    return r && r.width > 2 && r.height > 2 ? r : null;
  }

  function fit() {
    if (!frame) return;
    const width = stage.clientWidth;
    if (!width) return;
    let scale: number;
    let x = 0;
    let y = 0;
    let height: number;
    const r = mode === 'zoom' ? measure() : null;
    if (r) {
      const w = r.width + ZOOM_PAD * 2;
      const h = r.height + ZOOM_PAD * 2;
      // Tamaño real si cabe; si no, se reduce. Así se nota al cambiar la escala.
      scale = Math.min(1, width / w, 560 / h);
      // Centrado en horizontal cuando sobra sitio.
      x = r.left - ZOOM_PAD - Math.max(0, (width / scale - w) / 2);
      y = r.top - ZOOM_PAD;
      height = h * scale;
    } else {
      scale = width / 1920;
      height = 1080 * scale;
    }
    const key = `${scale.toFixed(4)}|${x.toFixed(1)}|${y.toFixed(1)}|${height.toFixed(1)}`;
    if (key === last) return;
    last = key;
    stage.style.height = `${Math.round(height)}px`;
    frame.style.transform = `scale(${scale}) translate(${-x}px, ${-y}px)`;
  }

  new ResizeObserver(() => {
    last = '';
    fit();
  }).observe(stage);

  return {
    load(path: string) {
      stage.textContent = '';
      last = '';
      frame = document.createElement('iframe');
      frame.src = `${path}?preview=1&editor=1`;
      frame.title = 'Vista previa del elemento';
      frame.tabIndex = -1;
      stage.append(frame);
      // El elemento cambia de tamaño con los ajustes y con los datos: se sigue midiendo.
      clearInterval(timer);
      timer = window.setInterval(fit, 250);
      fit();
    },
    /** Cierra la vista previa (y su conexión) mientras no se ve la pestaña. */
    unload() {
      clearInterval(timer);
      stage.textContent = '';
      frame = null;
    },
    setMode(next: 'zoom' | 'canvas') {
      mode = next;
      last = '';
      fit();
    },
  };
}

export function initDesignPanel(deps: DesignPanelDeps) {
  const ui = {
    chips: [...document.querySelectorAll<HTMLButtonElement>('#design-chips button')],
    stage: $('editor-stage'),
    viewModes: [...document.querySelectorAll<HTMLInputElement>('input[name="editor-view"]')],
    note: $('editor-note'),
    visibleBox: $('design-visible-box'),
    visible: $<HTMLInputElement>('design-visible'),
    visibleHint: $('design-visible-hint'),
    anchor: $<HTMLSelectElement>('design-anchor'),
    scale: $<HTMLInputElement>('design-scale'),
    scaleValue: $('design-scale-value'),
    offx: $<HTMLInputElement>('design-offx'),
    offxValue: $('design-offx-value'),
    offy: $<HTMLInputElement>('design-offy'),
    offyValue: $('design-offy-value'),
    groupNote: $('design-group-note'),
    styleBox: $('design-style-box'),
    style: $('design-style'),
    rotationBox: $('design-rotation-box'),
    texts: $('design-texts'),
    theme: $<HTMLSelectElement>('design-theme'),
    colors: $('design-colors'),
    rotateSec: $<HTMLInputElement>('rotate-sec'),
    rotateValue: $('rotate-value'),
    showcaseSec: $<HTMLInputElement>('showcase-sec'),
    showcaseValue: $('showcase-value'),
    groups: $('groups-list'),
    groupAdd: $<HTMLButtonElement>('group-add'),
  };
  let target: SlotItem = 'card';
  try {
    const saved = localStorage.getItem(TARGET_KEY);
    if (saved && saved in PATHS) target = saved as SlotItem;
  } catch {
    // sin almacenamiento: se empieza por la ficha
  }
  let slots: SlotState = {};
  let renderedGroups = '';
  let active = false;
  let hasGame = false;
  let demo = false;
  const preview = editorPreview(ui.stage);

  for (const [id, label] of Object.entries(THEME_LABELS)) {
    const o = el('option', undefined, label);
    o.value = id;
    ui.theme.append(o);
  }

  const settings = () => deps.settings();
  const views = () => settings().views;

  function layoutOf(item: SlotItem): OverlayLayout {
    return item === 'card' ? settings().overlay : views()[item].layout;
  }
  function saveLayout(item: SlotItem, layout: OverlayLayout) {
    if (item === 'card') deps.save({ overlay: layout });
    else deps.save({ views: { ...views(), [item]: { ...views()[item], layout } } });
  }
  const groupOf = (item: SlotItem) => settings().groups.find((g) => g.items.includes(item));

  // ── Diseño de un elemento ──────────────────────────────────────────────────

  /** Dibuja los campos de `fields` en `box`; cada cambio guarda el estilo del elemento. */
  function renderFields(box: HTMLElement, fields: Field[]) {
    box.textContent = '';
    const item = target;
    const style = views().styles[item] as unknown as Record<string, string | number | boolean>;
    const save = (key: string, value: string | number | boolean) =>
      deps.save({ views: { ...views(), styles: { ...views().styles, [item]: { ...views().styles[item], [key]: value } } as ViewStyles } });
    for (const f of fields) {
      if (f.type === 'select') {
        const s = selectInput(f.options, String(style[f.key]));
        s.dataset.key = f.key;
        s.addEventListener('change', () => save(f.key, f.numeric ? Number(s.value) : s.value));
        box.append(labeled(f.label, s));
      } else if (f.type === 'check') {
        const [l, i] = checkInput(f.label, !!style[f.key]);
        i.dataset.key = f.key;
        i.addEventListener('change', () => save(f.key, i.checked));
        box.append(l);
      } else if (f.type === 'align') {
        const seg = el('div', 'seg small');
        seg.setAttribute('role', 'radiogroup');
        seg.dataset.key = f.key;
        const options: [string, string][] = f.justify ? [...ALIGN_LABELS, ['justify', 'Justificado']] : ALIGN_LABELS;
        for (const [v, t] of options) {
          const l = el('label');
          const i = el('input');
          i.type = 'radio';
          i.name = `align-${item}-${f.key}`;
          i.value = v;
          i.checked = style[f.key] === v;
          i.addEventListener('change', () => i.checked && save(f.key, v));
          l.append(i, ` ${t}`);
          seg.append(l);
        }
        const wrap = el('div', 'field');
        wrap.append(el('span', undefined, f.label), seg);
        box.append(wrap);
      } else {
        const value = el('strong', undefined, f.fmt(Number(style[f.key])));
        const input = rangeInput(f.min, f.max, f.step, Number(style[f.key]));
        input.dataset.key = f.key;
        input.addEventListener('input', () => (value.textContent = f.fmt(Number(input.value))));
        input.addEventListener('change', () => save(f.key, Number(input.value)));
        box.append(labeled(f.label, input, value));
      }
    }
  }

  function renderColors() {
    const colors = views().colors[target];
    ui.theme.value = colors.theme;
    const shown = colors.theme === 'custom' ? colors.custom : resolveColors(colors, null);
    ui.colors.textContent = '';
    for (const [key, label] of COLOR_LABELS) {
      const input = el('input');
      input.type = 'color';
      input.value = shown[key];
      // Cambiar un color pasa a «Personalizado» partiendo de los colores que se ven.
      input.addEventListener('change', () => {
        const custom = { ...shown, [key]: input.value };
        deps.save({ views: { ...views(), colors: { ...views().colors, [target]: { theme: 'custom', custom } } } });
      });
      ui.colors.append(labeled(label, input));
    }
  }

  function renderNote() {
    const parts: string[] = [];
    if (target === 'card') parts.push('Ficha de ejemplo: el Pokémon elegido en «Directo» (o Pikachu).');
    else if (demo) parts.push('Se ve la partida de ejemplo (activada en «OBS»).');
    else if (!hasGame) parts.push('Sin partida de RetroArch: se ve la partida de ejemplo.');
    parts.push('Los cambios se guardan solos y llegan al directo al momento.');
    ui.note.textContent = parts.join(' ');
  }

  function renderTarget() {
    ui.chips.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.target === target)));
    if (!settings()) return; // aún cargando: se dibuja al llegar los ajustes
    ui.visibleBox.hidden = target === 'card';
    if (target !== 'card') {
      ui.visible.checked = views()[target].visible;
      ui.visibleHint.textContent = VISIBLE_HINT[target];
    }
    const layout = layoutOf(target);
    ui.anchor.value = layout.anchor;
    ui.scale.value = String(layout.scale);
    ui.scaleValue.textContent = pct(layout.scale);
    ui.offx.value = String(layout.offsetX);
    ui.offxValue.textContent = px(layout.offsetX);
    ui.offy.value = String(layout.offsetY);
    ui.offyValue.textContent = px(layout.offsetY);
    const g = groupOf(target);
    ui.groupNote.textContent = g?.enabled
      ? g.mode === 'shared'
        ? `Está en el grupo «${g.name}» (mismo lugar): en el directo usa la posición del grupo (pestaña «Turnos»).`
        : `Está en el grupo «${g.name}»: aparece en su turno, en esta posición.`
      : '';
    // La ficha no tiene opciones de presentación; el cambio de bolsillo o caja es de la mochila y el PC.
    const rotation = target === 'bag' || target === 'pc';
    ui.styleBox.hidden = !FIELDS[target].length && !rotation;
    ui.rotationBox.hidden = !rotation;
    renderFields(ui.style, FIELDS[target]);
    renderFields(ui.texts, TEXT_FIELDS[target]);
    renderColors();
    renderNote();
    const v = views();
    ui.rotateSec.value = String(v.rotateSec);
    ui.rotateValue.textContent = `${v.rotateSec} s`;
    ui.showcaseSec.value = String(v.showcaseSec);
    ui.showcaseValue.textContent = `${v.showcaseSec} s`;
  }

  function selectTarget(next: SlotItem) {
    target = next;
    try {
      localStorage.setItem(TARGET_KEY, next);
    } catch {
      // sin almacenamiento: no se recuerda
    }
    if (active) preview.load(PATHS[target]);
    renderTarget();
  }

  ui.chips.forEach((b) => b.addEventListener('click', () => selectTarget(b.dataset.target as SlotItem)));
  ui.viewModes.forEach((r) => r.addEventListener('change', () => r.checked && preview.setMode(r.value as 'zoom' | 'canvas')));
  ui.visible.addEventListener('change', () => {
    if (target === 'card') return;
    deps.save({ views: { ...views(), [target]: { ...views()[target], visible: ui.visible.checked } } });
  });
  ui.anchor.addEventListener('change', () => saveLayout(target, { ...layoutOf(target), anchor: ui.anchor.value as never }));
  for (const [input, label, key, fmt] of [
    [ui.scale, ui.scaleValue, 'scale', pct],
    [ui.offx, ui.offxValue, 'offsetX', px],
    [ui.offy, ui.offyValue, 'offsetY', px],
  ] as const) {
    input.addEventListener('input', () => {
      const v = Number(input.value);
      label.textContent = fmt(v);
      saveLayout(target, { ...layoutOf(target), [key]: v });
    });
  }
  ui.theme.addEventListener('change', () => {
    const theme = ui.theme.value as ThemeId;
    const current = views().colors[target];
    // Al elegir «Personalizado» se parte de los colores que se veían.
    const custom = theme === 'custom' && current.theme !== 'custom' ? resolveColors(current, null) : current.custom;
    deps.save({ views: { ...views(), colors: { ...views().colors, [target]: { theme, custom } } } });
  });
  ui.rotateSec.addEventListener('input', () => {
    ui.rotateValue.textContent = `${ui.rotateSec.value} s`;
    deps.save({ views: { ...views(), rotateSec: Number(ui.rotateSec.value) } });
  });
  ui.showcaseSec.addEventListener('input', () => {
    ui.showcaseValue.textContent = `${ui.showcaseSec.value} s`;
    deps.save({ views: { ...views(), showcaseSec: Number(ui.showcaseSec.value) } });
  });


  // ── Turnos entre elementos ─────────────────────────────────────────────────

  const saveGroups = (groups: RotationGroup[]) => deps.save({ groups });

  function groupCard(g: RotationGroup, index: number): HTMLElement {
    const groups = settings().groups;
    const update = (patch: Partial<RotationGroup>) => saveGroups(groups.map((x, i) => (i === index ? { ...x, ...patch } : x)));
    const box = el('fieldset', 'group');
    box.dataset.group = g.id;
    const name = el('input');
    name.value = g.name;
    name.maxLength = 40;
    name.className = 'group-name';
    name.addEventListener('change', () => update({ name: name.value }));
    const [enabledL, enabled] = checkInput('Activo', g.enabled);
    enabled.addEventListener('change', () => update({ enabled: enabled.checked }));
    const head = el('div', 'group-head');
    head.append(name, enabledL);
    box.append(head);

    const mode = selectInput(
      [
        ['alternate', 'Alternar (cada uno en su posición)'],
        ['shared', 'Mismo lugar (posición del grupo)'],
      ],
      g.mode,
    );
    mode.addEventListener('change', () => update({ mode: mode.value as RotationGroup['mode'] }));
    box.append(labeled('Modo', mode));

    const secValue = el('strong', undefined, `${g.seconds} s`);
    const secs = rangeInput(3, 120, 1, g.seconds);
    secs.addEventListener('input', () => (secValue.textContent = `${secs.value} s`));
    secs.addEventListener('change', () => update({ seconds: Number(secs.value) }));
    box.append(labeled('Cada turno dura', secs, secValue));

    const items = el('div', 'group-items');
    for (const item of Object.keys(ITEM_LABELS) as SlotItem[]) {
      const other = groups.find((x, i) => i !== index && x.items.includes(item));
      const [l, i] = checkInput(other ? `${ITEM_LABELS[item]} (en «${other.name}»)` : ITEM_LABELS[item], g.items.includes(item));
      i.disabled = !!other;
      i.addEventListener('change', () => {
        // El orden de los turnos es el de la lista: Ficha, Equipo, Medallas, Mochila, PC, Mapa.
        const next = (Object.keys(ITEM_LABELS) as SlotItem[]).filter((x) => (x === item ? i.checked : g.items.includes(x)));
        update({ items: next });
      });
      items.append(l);
    }
    box.append(labeled('Elementos (en este orden)', items));
    if (g.items.includes('card')) {
      box.append(el('p', 'hint', 'Con la ficha: al empezar un combate aparece enseguida y los demás se apartan hasta que termina.'));
    }

    if (g.mode === 'shared') {
      const shared = el('div', 'group-layout');
      shared.append(el('h4', undefined, 'Posición del grupo'), ...layoutControls(g.layout, (layout) => update({ layout })));
      box.append(shared);
    }

    const now = el('p', 'hint group-now');
    now.dataset.group = g.id;
    box.append(now);

    const del = el('button', 'danger', 'Quitar grupo');
    del.type = 'button';
    del.addEventListener('click', () => saveGroups(groups.filter((_, i) => i !== index)));
    const actions = el('div', 'actions');
    actions.append(del);
    box.append(actions);
    return box;
  }

  function renderGroups() {
    const groups = settings().groups;
    const sig = JSON.stringify(groups);
    // No se redibuja mientras se escribe en el grupo (se perdería el foco).
    if (sig === renderedGroups || ui.groups.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'text') {
      renderNow();
      return;
    }
    renderedGroups = sig;
    ui.groups.textContent = '';
    if (!groups.length) ui.groups.append(el('p', 'hint', 'No hay grupos: cada elemento aparece según «Visible siempre».'));
    groups.forEach((g, i) => ui.groups.append(groupCard(g, i)));
    ui.groupAdd.disabled = groups.length >= 6;
    renderNow();
  }

  /** «Ahora: …» de cada grupo, según el último estado de los turnos. */
  function renderNow() {
    for (const p of ui.groups.querySelectorAll<HTMLElement>('.group-now')) {
      const g = settings().groups.find((x) => x.id === p.dataset.group);
      if (!g?.enabled) {
        p.textContent = 'Desactivado.';
        continue;
      }
      const active = g.items.filter((i) => slots[i]?.active);
      p.textContent = active.length ? `Ahora: ${active.map((i) => ITEM_LABELS[i]).join(', ')}` : 'Ahora: nada que enseñar (sin datos).';
    }
  }

  ui.groupAdd.addEventListener('click', () => {
    const groups = settings().groups;
    const used = new Set(groups.flatMap((g) => g.items));
    const free = (['pc', 'map'] as SlotItem[]).filter((i) => !used.has(i));
    saveGroups([
      ...groups,
      {
        id: `g${Date.now().toString(36)}`,
        name: `Grupo ${groups.length + 1}`,
        enabled: true,
        mode: 'shared',
        items: free,
        seconds: 10,
        layout: { scale: 1, anchor: 'bottom-right', offsetX: 48, offsetY: 48 },
      },
    ]);
  });

  return {
    applySettings() {
      renderTarget();
      renderGroups();
    },
    onSlots(state: SlotState) {
      slots = state;
      renderNow();
    },
    /** ¿Hay partida (real, o la de ejemplo si está activada)? */
    onGame(has: boolean) {
      if (has === hasGame) return;
      hasGame = has;
      renderNote();
    },
    onDemo(enabled: boolean) {
      demo = enabled;
      renderNote();
    },
    /** La vista previa solo está cargada mientras se ve la pestaña «Diseño». */
    setActive(on: boolean) {
      if (on === active) return;
      active = on;
      if (on) preview.load(PATHS[target]);
      else preview.unload();
    },
  };
}
