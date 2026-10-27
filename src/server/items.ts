import { SpriteCache } from './pokeapi.js';

export interface TextSource {
  getText(url: string): Promise<string>;
}

export const CSV_BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const ITEM_SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/';
/** local_language_id del español en PokéAPI. */
const SPANISH = '7';

export interface ItemInfo {
  name: string;
  /** URL local del icono (se descarga al pedirla; si no existe, la imagen falla y se oculta). */
  icon: string;
}

function rows(csv: string): string[][] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(','));
}

/**
 * Nombres en español e iconos de los objetos de la Gen III, a partir de las
 * tablas CSV de PokéAPI (índice interno del juego → objeto). Tres descargas
 * en total, guardadas en caché.
 */
export class ItemCatalog {
  private items: Promise<Map<number, ItemInfo>> | null = null;
  private loaded: Map<number, ItemInfo> | null = null;

  constructor(private source: TextSource) {}

  load(): Promise<Map<number, ItemInfo>> {
    if (!this.items) {
      this.items = this.build();
      this.items.catch(() => (this.items = null)); // sin red: se reintenta la próxima vez
    }
    return this.items;
  }

  /** Solo si ya están cargados (sin esperar). */
  peek(): Map<number, ItemInfo> | null {
    return this.loaded;
  }

  private async build(): Promise<Map<number, ItemInfo>> {
    const [indices, names, items] = await Promise.all(
      ['item_game_indices.csv', 'item_names.csv', 'items.csv'].map((f) => this.source.getText(CSV_BASE + f)),
    );
    const spanish = new Map(rows(names).filter((r) => r[1] === SPANISH).map((r) => [r[0], r.slice(2).join(',')]));
    const identifiers = new Map(rows(items).map((r) => [r[0], r[1]]));
    const out = new Map<number, ItemInfo>();
    for (const [itemId, generation, index] of rows(indices)) {
      if (generation !== '3') continue;
      const identifier = identifiers.get(itemId);
      out.set(Number(index), {
        name: spanish.get(itemId) ?? identifier ?? `Objeto ${index}`,
        icon: identifier ? SpriteCache.localUrl(`${ITEM_SPRITES}${identifier}.png`) : '',
      });
    }
    this.loaded = out;
    return out;
  }
}
