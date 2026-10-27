// Temas de color de los elementos del directo. «game» usa los colores del juego
// elegido (verde en Esmeralda, rojo en Rojo…); «custom», los colores propios.
import type { ColorSet, ThemeId, ViewColors } from './types.js';

const BASE = { border: '#141416', text: '#ffffff', title: '#ffe9a8' };

export const THEMES: Record<Exclude<ThemeId, 'game' | 'custom'>, ColorSet> = {
  esmeralda: { ...BASE, frame: '#1f9d63', frameDark: '#0d5c38', panel: '#e8f0d8', panelText: '#1d2b1a' },
  rubi: { ...BASE, frame: '#d42a2a', frameDark: '#8e1414', panel: '#f6e6e2', panelText: '#2b1414' },
  zafiro: { ...BASE, frame: '#2a5cd4', frameDark: '#142e8e', panel: '#e4eaf8', panelText: '#141e2b' },
  oscuro: { frame: '#2b2e35', frameDark: '#17181c', border: '#000000', text: '#e9eaee', title: '#ffd166', panel: '#22242a', panelText: '#e9eaee' },
  claro: { frame: '#f4f4f6', frameDark: '#d4d4da', border: '#8a8d96', text: '#26272b', title: '#26272b', panel: '#ffffff', panelText: '#26272b' },
};

export const THEME_LABELS: Record<ThemeId, string> = {
  game: 'Colores del juego',
  esmeralda: 'Esmeralda',
  rubi: 'Rubí',
  zafiro: 'Zafiro',
  oscuro: 'Oscuro',
  claro: 'Claro',
  custom: 'Personalizado',
};

/** Colores con los que se pinta un elemento. */
export function resolveColors(colors: ViewColors | undefined, game: { accent: string; accentDark: string } | null): ColorSet {
  const theme = colors?.theme ?? 'game';
  if (theme === 'custom' && colors) return colors.custom;
  if (theme !== 'game' && theme !== 'custom') return THEMES[theme];
  return { ...THEMES.esmeralda, frame: game?.accent ?? THEMES.esmeralda.frame, frameDark: game?.accentDark ?? THEMES.esmeralda.frameDark };
}

/** Variables CSS que usan los marcos (gm-frame) y la ficha (dex-card). */
export function colorVars(c: ColorSet): Record<string, string> {
  return {
    '--accent': c.frame,
    '--accent-dark': c.frameDark,
    '--frame-border': c.border,
    '--frame-text': c.text,
    '--title': c.title,
    '--screen': c.panel,
    '--screen-ink': c.panelText,
  };
}

export function applyColorVars(el: HTMLElement, c: ColorSet) {
  for (const [k, v] of Object.entries(colorVars(c))) el.style.setProperty(k, v);
}

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
