// Presentación por defecto de cada elemento del directo (compartida por el servidor y los overlays).
import type { ViewStyles } from './types.js';

export const DEFAULT_STYLES: ViewStyles = {
  card: { showNumber: true, showTypes: true, showDescription: true, showFamily: true, showFooter: true, descAlign: 'left' },
  party: {
    layout: 'vertical',
    spriteSide: 'right',
    showBall: true,
    spriteScale: 1,
    textSize: 20,
    showNickname: true,
    showLevel: true,
    showHpBar: true,
    showHpText: true,
    showStatus: true,
    textAlign: 'left',
  },
  badges: { columns: 8, names: true, size: 3, showTitle: true },
  bag: {
    listPosition: 'right',
    columns: 2,
    rows: 6,
    scroll: true,
    bagSize: 2,
    iconSize: 1,
    textSize: 20,
    showTitle: true,
    titleAlign: 'left',
    showNames: true,
    showQuantity: true,
  },
  pc: { showName: true, scale: 3, speed: 45, nameAlign: 'center' },
  map: { labelPosition: 'bottom', scale: 2, labelAlign: 'center' },
};
