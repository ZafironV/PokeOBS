import { describe, expect, it } from 'vitest';
import { filterCatalog } from '../src/shared/search.js';
import { formatSpeciesSlug, generationNumber, normalizeFlavorText, searchKey } from '../src/shared/text.js';
import { pickDescription, resolveTypes } from '../src/server/history.js';
import { mergeSettings, DEFAULT_SETTINGS } from '../src/server/settings.js';
import { pixelScale } from '../src/client/cardView.js';
import type { CatalogEntry } from '../src/shared/types.js';

describe('normalizeFlavorText', () => {
  it('quita saltos de línea, de página y guiones blandos', () => {
    expect(normalizeFlavorText('When several of\nthese POKéMON\ngather, their\felectricity')).toBe(
      'When several of these POKéMON gather, their electricity',
    );
    expect(normalizeFlavorText('evo­\nlución  rápida\r\n')).toBe('evolución rápida');
    expect(normalizeFlavorText('a\u0007b\u0000c')).toBe('abc');
  });
});

describe('utilidades', () => {
  it('nombres especiales y claves de búsqueda', () => {
    expect(formatSpeciesSlug('nidoran-f')).toBe('Nidoran♀');
    expect(formatSpeciesSlug('mr-mime')).toBe('Mr. Mime');
    expect(searchKey("Farfetch'd")).toBe('farfetchd');
    expect(searchKey('Nidoran♀')).toBe('nidoranf');
    expect(searchKey('Psíquico')).toBe('psiquico');
  });
  it('números de generación', () => {
    expect(generationNumber('generation-iii')).toBe(3);
    expect(() => generationNumber('gen-3')).toThrow();
  });
});

describe('filterCatalog', () => {
  const entries: CatalogEntry[] = [
    { speciesId: 252, slug: 'treecko', name: 'Treecko', regionalNumber: 1 },
    { speciesId: 25, slug: 'pikachu', name: 'Pikachu', regionalNumber: 156 },
    { speciesId: 26, slug: 'raichu', name: 'Raichu', regionalNumber: 157 },
    { speciesId: 122, slug: 'mr-mime', name: 'Mr. Mime', regionalNumber: null },
    { speciesId: 29, slug: 'nidoran-f', name: 'Nidoran♀', regionalNumber: null },
  ];
  it('busca por número regional o nacional', () => {
    expect(filterCatalog(entries, '1')[0].slug).toBe('treecko');
    expect(filterCatalog(entries, '#025')[0].slug).toBe('pikachu');
    expect(filterCatalog(entries, '156')[0].slug).toBe('pikachu');
    expect(filterCatalog(entries, '999')).toEqual([]);
  });
  it('busca por nombre sin distinguir mayúsculas ni signos', () => {
    expect(filterCatalog(entries, 'PIKA').map((e) => e.slug)).toEqual(['pikachu']);
    expect(filterCatalog(entries, 'chu').map((e) => e.slug)).toEqual(['pikachu', 'raichu']);
    expect(filterCatalog(entries, 'mr mime')[0].slug).toBe('mr-mime');
    expect(filterCatalog(entries, 'nidoran')[0].slug).toBe('nidoran-f');
    expect(filterCatalog(entries, 'zzz')).toEqual([]);
  });
});

describe('resolveTypes', () => {
  const slot = (n: number, name: string) => ({ slot: n, type: { name } });
  it('elige la entrada de past_types más antigua aplicable', () => {
    const past = [
      { generation: { name: 'generation-i' }, types: [slot(1, 'a')] },
      { generation: { name: 'generation-v' }, types: [slot(1, 'b')] },
    ];
    expect(resolveTypes([slot(1, 'c')], past, 1).types.map((t) => t.id)).toEqual(['a']);
    expect(resolveTypes([slot(1, 'c')], past, 3).types.map((t) => t.id)).toEqual(['b']);
    expect(resolveTypes([slot(1, 'c')], past, 6).types.map((t) => t.id)).toEqual(['c']);
  });
  it('nunca muestra tipos inexistentes en esa generación', () => {
    const r = resolveTypes([slot(1, 'normal'), slot(2, 'fairy')], [], 3);
    expect(r.types.map((t) => t.id)).toEqual(['normal']);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('pickDescription', () => {
  const e = (text: string, lang: string, version: string) => ({
    flavor_text: text,
    language: { name: lang },
    version: { name: version },
  });
  const pick = (entries: ReturnType<typeof e>[], mode: 'es-aprox' | 'es-exacto' | 'pokeapi', wikidex = null as any) =>
    pickDescription({ entries, version: 'red', wikidex, mode }).description;
  it('en modo exacto no usa el texto de otra versión', () => {
    expect(pick([e('Firered', 'en', 'firered'), e('X', 'es', 'x')], 'es-exacto')).toEqual({ status: 'missing' });
  });
  it('prefiere español de la misma versión sobre inglés', () => {
    expect(pick([e('Hello', 'en', 'red'), e('Hola', 'es', 'red')], 'es-exacto')).toMatchObject({
      text: 'Hola',
      lang: 'es',
      source: 'pokeapi',
    });
  });
  it('WikiDex de la misma edición va antes que el inglés; el modo "pokeapi" lo ignora', () => {
    const wd = { rojoyazul: { text: 'Texto oficial.' } };
    expect(pick([e('Hello', 'en', 'red')], 'es-exacto', wd)).toMatchObject({ text: 'Texto oficial.', source: 'wikidex' });
    expect(pick([e('Hello', 'en', 'red')], 'pokeapi', wd)).toMatchObject({ text: 'Hello', lang: 'en' });
  });
  it('modo aproximado: español de la edición más cercana, indicando cuál, antes que el inglés', () => {
    const wd = { oro: { text: 'De Oro.' }, esmeralda: { text: 'De Esmeralda.' } };
    expect(pick([e('Hello', 'en', 'red'), e('De X', 'es', 'x')], 'es-aprox', wd)).toMatchObject({
      text: 'De Oro.',
      lang: 'es',
      version: 'gold',
      approxFrom: 'Pokémon Oro',
    });
    // Sin nada en español: inglés de la propia edición.
    expect(pick([e('Hello', 'en', 'red')], 'es-aprox', {})).toMatchObject({ text: 'Hello', lang: 'en' });
  });
});

describe('mergeSettings', () => {
  it('limita duración y escala y descarta valores no válidos', () => {
    const s = mergeSettings(
      DEFAULT_SETTINGS,
      { durationSec: 99, gameId: 'nope', overlay: { scale: 9, anchor: 'x' as never, offsetX: -5, offsetY: 20 } },
      ['red', 'emerald'],
    );
    expect(s.durationSec).toBe(60);
    expect(s.gameId).toBe('red');
    expect(s.overlay).toEqual({ scale: 2, anchor: 'top-right', offsetX: 0, offsetY: 20 });
    expect(mergeSettings(DEFAULT_SETTINGS, { durationSec: 1 }, ['red']).durationSec).toBe(5);
    expect(DEFAULT_SETTINGS.durationSec).toBe(15);
  });
});

describe('pixelScale', () => {
  it('amplía con factores enteros y conserva proporciones', () => {
    expect(pixelScale(96, 96, 192)).toBe(2); // Rojo
    expect(pixelScale(64, 64, 192)).toBe(3); // Esmeralda
    expect(pixelScale(50, 46, 192)).toBe(3); // GIF de Negro/Blanco
    expect(pixelScale(96, 96, 64)).toBe(0.5);
    expect(pixelScale(64, 64, 64)).toBe(1);
  });
});
