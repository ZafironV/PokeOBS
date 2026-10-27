import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_STYLES } from '../shared/styles.js';
import { isHexColor, THEMES } from '../shared/themes.js';
import type {
  Anchor,
  ColorSet,
  GameView,
  OverlayLayout,
  PocketId,
  RotationGroup,
  Settings,
  SlotItem,
  ThemeId,
  ViewColors,
  ViewStyles,
} from '../shared/types.js';

const VIEWS: GameView[] = ['party', 'badges', 'bag', 'pc', 'map'];
export const SLOT_ITEMS: SlotItem[] = ['card', ...VIEWS];
const THEME_IDS: ThemeId[] = ['game', 'esmeralda', 'rubi', 'zafiro', 'oscuro', 'claro', 'custom'];
/** Como mucho, este número de grupos de turnos. */
export const MAX_GROUPS = 6;

const ALIGNS = ['left', 'center', 'right'] as const;
const DEFAULT_COLORS: ViewColors = { theme: 'game', custom: { ...THEMES.esmeralda } };
const POCKET_IDS: PocketId[] = ['items', 'balls', 'tmhm', 'berries', 'key'];

const ANCHORS: Anchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center-left', 'center-right'];

export const DEFAULT_SETTINGS: Settings = {
  gameId: 'red',
  catalogMode: 'regional',
  spriteMode: 'game',
  textMode: 'es-aprox',
  durationSec: 15,
  selectedSpeciesId: null,
  overlay: { scale: 1, anchor: 'top-right', offsetX: 48, offsetY: 48 },
  doubleSwapSec: 4,
  auto: { enabled: false, battleCards: true, intervalMs: 250, port: 55355 },
  views: {
    party: { visible: true, layout: { scale: 1, anchor: 'bottom-left', offsetX: 48, offsetY: 48 } },
    badges: { visible: true, layout: { scale: 1, anchor: 'top-left', offsetX: 48, offsetY: 48 } },
    bag: { visible: false, layout: { scale: 1, anchor: 'bottom-right', offsetX: 48, offsetY: 48 } },
    pc: { visible: false, layout: { scale: 1, anchor: 'center-right', offsetX: 48, offsetY: 48 } },
    map: { visible: true, layout: { scale: 1, anchor: 'bottom-right', offsetX: 48, offsetY: 48 } },
    styles: DEFAULT_STYLES,
    colors: Object.fromEntries(SLOT_ITEMS.map((i) => [i, DEFAULT_COLORS])) as Record<SlotItem, ViewColors>,
    pocket: 'items',
    box: 0,
    rotateSec: 6,
    showcaseSec: 10,
  },
  groups: [],
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function mergeLayout(base: OverlayLayout, o: Partial<OverlayLayout> | undefined): OverlayLayout {
  const next = { ...base };
  if (!o) return next;
  if (o.scale !== undefined) next.scale = Math.round(clamp(o.scale, 0.5, 2, base.scale) * 100) / 100;
  if (ANCHORS.includes(o.anchor as Anchor)) next.anchor = o.anchor as Anchor;
  if (o.offsetX !== undefined) next.offsetX = Math.round(clamp(o.offsetX, 0, 1000, base.offsetX));
  if (o.offsetY !== undefined) next.offsetY = Math.round(clamp(o.offsetY, 0, 1000, base.offsetY));
  return next;
}

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
/** Número dentro de [min, max] redondeado a pasos de `step`. */
const num = (v: unknown, min: number, max: number, fallback: number, step = 1) =>
  Math.round(clamp(v, min, max, fallback) / step) * step;

function mergeStyles(base: ViewStyles, p: Partial<{ [K in keyof ViewStyles]: Partial<ViewStyles[K]> }> | undefined): ViewStyles {
  const out = structuredClone(base);
  if (!p) return out;
  const { card, party, badges, bag, pc, map } = p;
  if (card) {
    for (const k of ['showNumber', 'showTypes', 'showDescription', 'showFamily', 'showFooter'] as const) {
      out.card[k] = bool(card[k], base.card[k]);
    }
    out.card.descAlign = oneOf(card.descAlign, [...ALIGNS, 'justify'] as const, base.card.descAlign);
  }
  if (party) {
    out.party.layout = oneOf(party.layout, ['vertical', 'grid', 'horizontal'] as const, base.party.layout);
    out.party.spriteSide = oneOf(party.spriteSide, ['left', 'right'] as const, base.party.spriteSide);
    out.party.showBall = bool(party.showBall, base.party.showBall);
    out.party.spriteScale = num(party.spriteScale, 1, 2, base.party.spriteScale, 0.5);
    out.party.textSize = num(party.textSize, 14, 32, base.party.textSize);
    for (const k of ['showNickname', 'showLevel', 'showHpBar', 'showHpText', 'showStatus'] as const) {
      out.party[k] = bool(party[k], base.party[k]);
    }
    out.party.textAlign = oneOf(party.textAlign, ALIGNS, base.party.textAlign);
  }
  if (badges) {
    out.badges.columns = oneOf(Number(badges.columns), [1, 2, 4, 8] as const, base.badges.columns);
    out.badges.names = bool(badges.names, base.badges.names);
    out.badges.size = num(badges.size, 2, 5, base.badges.size);
    out.badges.showTitle = bool(badges.showTitle, base.badges.showTitle);
  }
  if (bag) {
    out.bag.listPosition = oneOf(bag.listPosition, ['left', 'right', 'top', 'bottom'] as const, base.bag.listPosition);
    out.bag.columns = oneOf(Number(bag.columns), [1, 2, 3] as const, base.bag.columns);
    out.bag.rows = num(bag.rows, 3, 15, base.bag.rows);
    out.bag.scroll = bool(bag.scroll, base.bag.scroll);
    out.bag.bagSize = num(bag.bagSize, 1, 3, base.bag.bagSize);
    out.bag.iconSize = num(bag.iconSize, 1, 2, base.bag.iconSize);
    out.bag.textSize = num(bag.textSize, 14, 32, base.bag.textSize);
    out.bag.showTitle = bool(bag.showTitle, base.bag.showTitle);
    out.bag.titleAlign = oneOf(bag.titleAlign, ALIGNS, base.bag.titleAlign);
    out.bag.showNames = bool(bag.showNames, base.bag.showNames);
    out.bag.showQuantity = bool(bag.showQuantity, base.bag.showQuantity);
  }
  if (pc) {
    out.pc.showName = bool(pc.showName, base.pc.showName);
    out.pc.scale = num(pc.scale, 2, 4, base.pc.scale);
    out.pc.speed = num(pc.speed, 0, 120, base.pc.speed, 5);
    out.pc.nameAlign = oneOf(pc.nameAlign, ALIGNS, base.pc.nameAlign);
  }
  if (map) {
    out.map.labelPosition = oneOf(map.labelPosition, ['top', 'bottom', 'hidden'] as const, base.map.labelPosition);
    out.map.scale = num(map.scale, 1, 3, base.map.scale);
    out.map.labelAlign = oneOf(map.labelAlign, ALIGNS, base.map.labelAlign);
  }
  return out;
}

function mergeColors(base: ViewColors, p: Partial<ViewColors> | undefined): ViewColors {
  if (!p) return base;
  const custom = { ...base.custom };
  for (const k of Object.keys(custom) as (keyof ColorSet)[]) {
    if (isHexColor(p.custom?.[k])) custom[k] = p.custom![k];
  }
  return { theme: oneOf(p.theme, THEME_IDS, base.theme), custom };
}

/** Grupos de turnos: ids únicos, cada elemento en un solo grupo (el primero que lo tenga). */
function mergeGroups(base: RotationGroup[], p: unknown): RotationGroup[] {
  if (!Array.isArray(p)) return base;
  const used = new Set<SlotItem>();
  const ids = new Set<string>();
  const out: RotationGroup[] = [];
  for (const g of p.slice(0, MAX_GROUPS) as Partial<RotationGroup>[]) {
    if (!g || typeof g !== 'object') continue;
    let id = typeof g.id === 'string' && /^[a-z0-9-]{1,24}$/.test(g.id) ? g.id : '';
    if (!id || ids.has(id)) id = `g${out.length + 1}-${ids.size}`;
    ids.add(id);
    const items = (Array.isArray(g.items) ? g.items : []).filter(
      (i): i is SlotItem => SLOT_ITEMS.includes(i as SlotItem) && !used.has(i as SlotItem),
    );
    items.forEach((i) => used.add(i));
    out.push({
      id,
      name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 40) : `Grupo ${out.length + 1}`,
      enabled: bool(g.enabled, true),
      mode: oneOf(g.mode, ['alternate', 'shared'] as const, 'alternate'),
      items: [...new Set(items)],
      seconds: num(g.seconds, 3, 120, 10),
      layout: mergeLayout({ scale: 1, anchor: 'bottom-right', offsetX: 48, offsetY: 48 }, g.layout),
    });
  }
  return out;
}

/** Aplica un cambio parcial validando cada campo; los valores no válidos se ignoran. */
export function mergeSettings(base: Settings, patch: Partial<Settings>, gameIds: string[]): Settings {
  const next: Settings = { ...base, auto: { ...base.auto }, views: { ...base.views } };
  if (typeof patch.gameId === 'string' && gameIds.includes(patch.gameId)) next.gameId = patch.gameId;
  if (patch.catalogMode === 'regional' || patch.catalogMode === 'national') next.catalogMode = patch.catalogMode;
  if (patch.spriteMode === 'game' || patch.spriteMode === 'animated') next.spriteMode = patch.spriteMode;
  if (patch.textMode === 'es-aprox' || patch.textMode === 'es-exacto' || patch.textMode === 'pokeapi') {
    next.textMode = patch.textMode;
  }
  if (patch.durationSec !== undefined) next.durationSec = Math.round(clamp(patch.durationSec, 5, 60, base.durationSec));
  if (patch.selectedSpeciesId === null) next.selectedSpeciesId = null;
  else if (Number.isInteger(patch.selectedSpeciesId) && patch.selectedSpeciesId! > 0)
    next.selectedSpeciesId = patch.selectedSpeciesId!;
  next.overlay = mergeLayout(base.overlay, patch.overlay);
  if (patch.doubleSwapSec !== undefined) {
    next.doubleSwapSec = Math.round(clamp(patch.doubleSwapSec, 2, 15, base.doubleSwapSec));
  }
  const a = patch.auto;
  if (a) {
    if (typeof a.enabled === 'boolean') next.auto.enabled = a.enabled;
    if (typeof a.battleCards === 'boolean') next.auto.battleCards = a.battleCards;
    if (a.intervalMs !== undefined) next.auto.intervalMs = Math.round(clamp(a.intervalMs, 250, 1000, base.auto.intervalMs));
    if (a.port !== undefined) next.auto.port = Math.round(clamp(a.port, 1, 65535, base.auto.port));
  }
  const v = patch.views;
  if (v) {
    for (const view of VIEWS) {
      const p = v[view];
      if (!p) continue;
      next.views[view] = {
        visible: typeof p.visible === 'boolean' ? p.visible : base.views[view].visible,
        layout: mergeLayout(base.views[view].layout, p.layout),
      };
    }
    next.views.styles = mergeStyles(base.views.styles, v.styles);
    if (v.colors) {
      next.views.colors = { ...base.views.colors };
      for (const item of SLOT_ITEMS) next.views.colors[item] = mergeColors(base.views.colors[item], v.colors[item]);
    }
    if (POCKET_IDS.includes(v.pocket as PocketId)) next.views.pocket = v.pocket;
    if (Number.isInteger(v.box) && v.box >= 0 && v.box < 14) next.views.box = v.box;
    if (v.rotateSec !== undefined) next.views.rotateSec = Math.round(clamp(v.rotateSec, 3, 30, base.views.rotateSec));
    if (v.showcaseSec !== undefined) next.views.showcaseSec = Math.round(clamp(v.showcaseSec, 3, 60, base.views.showcaseSec));
  }
  if (patch.groups !== undefined) next.groups = mergeGroups(base.groups, patch.groups);
  return next;
}

export class SettingsStore {
  private file: string;
  current: Settings;

  constructor(dataDir: string, private gameIds: string[]) {
    this.file = path.join(dataDir, 'settings.json');
    let loaded: Partial<Settings> = {};
    try {
      loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* primera ejecución o archivo dañado: valores por defecto */
    }
    const base = { ...DEFAULT_SETTINGS, gameId: gameIds.includes(DEFAULT_SETTINGS.gameId) ? 'red' : gameIds[0] };
    this.current = mergeSettings(base, loaded, gameIds);
  }

  update(patch: Partial<Settings>): Settings {
    this.current = mergeSettings(this.current, patch, this.gameIds);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2));
    fs.renameSync(tmp, this.file);
    return this.current;
  }
}
