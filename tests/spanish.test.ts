import { describe, expect, it } from 'vitest';
import type { EvoNode } from '../src/shared/types.js';
import { cleanWikiText, parsePokedexParams, parseWikiDexPage } from '../src/server/wikidexParse.js';
import { nearestVersions, VERSIONS } from '../src/shared/versions.js';
import { makeService, wikidexFixture } from './helpers.js';

function tree(nodes: EvoNode[]): string {
  return nodes
    .map((n) => `${n.name}${n.selected ? '*' : ''}${n.children.length ? `[${tree(n.children)}]` : ''}`)
    .join(',');
}

describe('análisis de WikiDex', () => {
  it('extrae los textos por edición de la plantilla {{Pokédex}} real de Pikachu', () => {
    const e = parseWikiDexPage(wikidexFixture('Pikachu')!)!;
    expect(e.rojoyazul.text).toBe('Cuando varios de estos Pokémon se juntan, su energía puede causar fuertes tormentas.');
    expect(e.oro.text).toBe('Este inteligente Pokémon tuesta las duras bayas con electricidad para hacerlas más comestibles.');
    // "verdehoja = rojoyazul": referencia a otra edición
    expect(e.verdehoja.text).toBe(e.rojoyazul.text);
    // "negro 2 = platino"
    expect(e['negro 2'].text).toBe(e.platino.text);
  });

  it('resuelve las referencias de Wormadam', () => {
    const e = parseWikiDexPage(wikidexFixture('Wormadam')!)!;
    expect(e['blanco 2'].text).toBe(e.negro.text);
    expect(e['plata soulsilver'].text).toBe(e['oro heartgold'].text);
    expect(e.rojoyazul).toBeUndefined();
  });

  it('limpia enlaces, negritas y variantes regionales (usa la de España)', () => {
    expect(cleanWikiText("Usa [[Impactrueno|impactrueno]] y [[Rayo]]. '''Fuerte'''").text).toBe(
      'Usa impactrueno y Rayo. Fuerte',
    );
    expect(cleanWikiText('{{n|Texto latino.|Texto de España.}}').text).toBe('Texto de España.');
    expect(cleanWikiText("* '''Forma A:''' Primera.\n* '''Forma B:''' Segunda.")).toEqual({
      text: 'Primera.',
      multipleForms: true,
    });
  });

  it('ignora parámetros sin nombre y conserva el primer valor de cada clave', () => {
    expect(parsePokedexParams('Pokédex\n| a = uno\n| b = a\n| a = otro\n| suelto')).toEqual({ a: 'uno', b: 'uno' });
  });

  it('cada edición de los perfiles tiene clave de WikiDex', () => {
    const { service } = makeService();
    for (const p of service.profiles) expect(VERSIONS.some((v) => v.version === p.textVersion)).toBe(true);
  });

  it('la edición más cercana prioriza la misma generación y, ante empate, la anterior', () => {
    const near = nearestVersions('red').map((v) => v.version);
    expect(near.slice(0, 2)).toEqual(['blue', 'yellow']);
    expect(near.indexOf('gold')).toBeLessThan(near.indexOf('ruby'));
    const fromGold = nearestVersions('gold').map((v) => v.version);
    expect(fromGold.indexOf('yellow')).toBeLessThan(fromGold.indexOf('ruby'));
  });
});

describe('descripciones en español en las fichas', () => {
  it('Rojo: texto oficial español de Rojo/Azul desde WikiDex', async () => {
    const { service } = makeService();
    const card = await service.buildCard('red', 'regional', 'game', 25);
    expect(card.description).toEqual({
      status: 'ok',
      text: 'Cuando varios de estos Pokémon se juntan, su energía puede causar fuertes tormentas.',
      lang: 'es',
      source: 'wikidex',
      version: 'red',
    });
    expect(card.warnings.join(' ')).toMatch(/WikiDex/);
  });

  it('cada juego usa su propio texto español', async () => {
    const { service } = makeService();
    const texts = new Map<string, string>();
    for (const game of ['yellow', 'gold', 'crystal', 'emerald', 'firered', 'diamond', 'platinum', 'heartgold', 'black']) {
      const card = await service.buildCard(game, 'national', 'game', 25);
      expect(card.description).toMatchObject({ lang: 'es', source: 'wikidex', version: service.profile(game).textVersion });
      if (card.description.status === 'ok') texts.set(game, card.description.text);
    }
    expect(texts.get('yellow')).toMatch(/^Mantiene su cola en alto/);
    expect(texts.get('diamond')).toMatch(/^Cuando se siente amenazado/);
    expect(new Set(texts.values()).size).toBeGreaterThan(5);
  });

  it('PokéAPI en español tiene prioridad y no consulta WikiDex (Rubí Omega)', async () => {
    const { service, wikidex } = makeService();
    const card = await service.buildCard('omega-ruby', 'regional', 'game', 25);
    expect(card.description).toMatchObject({ lang: 'es', source: 'pokeapi' });
    expect(wikidex.calls).toEqual([]);
  });

  it('nombre con símbolo: Nidoran♀', async () => {
    const { service } = makeService();
    const card = await service.buildCard('red', 'regional', 'game', 29);
    expect(card.description).toMatchObject({ lang: 'es', source: 'wikidex' });
  });

  it('modo aproximado sin WikiDex: español de la edición más cercana de PokéAPI, indicado', async () => {
    const { service, wikidex } = makeService();
    wikidex.offline = true;
    const card = await service.buildCard('red', 'regional', 'game', 25, 'es-aprox');
    expect(card.description).toMatchObject({ lang: 'es', source: 'pokeapi', approxFrom: 'Pokémon X', version: 'x' });
    expect(card.warnings.join(' ')).toMatch(/No se pudo consultar WikiDex/);
    expect(card.warnings.join(' ')).toMatch(/se muestra el de Pokémon X/);
  });

  it('modo exacto sin WikiDex: inglés de la propia edición, nunca el de otra', async () => {
    const { service, wikidex } = makeService();
    wikidex.offline = true;
    const card = await service.buildCard('red', 'regional', 'game', 25, 'es-exacto');
    expect(card.description).toMatchObject({ lang: 'en', version: 'red' });
    expect(card.description.status === 'ok' && card.description.approxFrom).toBeFalsy();
  });

  it('modo "pokeapi": no consulta WikiDex', async () => {
    const { service, wikidex } = makeService();
    await service.buildCard('red', 'regional', 'game', 25, 'pokeapi');
    expect(wikidex.calls).toEqual([]);
  });

  it('los textos locales siguen teniendo prioridad y no consultan WikiDex', async () => {
    const { service, texts, wikidex } = makeService();
    texts.data.red = { 25: { text: 'Mi texto verificado.' } };
    const card = await service.buildCard('red', 'regional', 'game', 25);
    expect(card.description).toMatchObject({ source: 'local', text: 'Mi texto verificado.' });
    expect(wikidex.calls).toEqual([]);
  });
});

describe('Generación IV y V', () => {
  it.each([
    ['diamond', 'original-sinnoh', 151, 493],
    ['platinum', 'extended-sinnoh', 210, 493],
    ['black', 'original-unova', 156, 649],
    ['white-2', 'updated-unova', 301, 649],
  ] as const)('%s usa %s (%i) y nacional hasta %i', async (game, dex, size, max) => {
    const { service } = makeService();
    expect(service.profile(game).regionalPokedex.name).toBe(dex);
    expect(service.profile(game).nationalDex.maxSpecies).toBe(max);
    expect((await service.catalog(game, 'regional')).entries).toHaveLength(size);
  });

  it('Teselia empieza en Victini con el número 000', async () => {
    const { service } = makeService();
    const c = await service.catalog('black', 'regional');
    expect(c.entries[0]).toMatchObject({ slug: 'victini', regionalNumber: 0 });
    const card = await service.buildCard('black', 'regional', 'game', 494);
    expect(card.number).toBe(0);
  });

  it.each([
    ['diamond', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon,Leafeon,Glaceon]'],
    ['black-2', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon,Leafeon,Glaceon]'], // sin Sylveon (Gen. VI)
    ['red', 122, 'Mr. Mime*'], // Mime Jr. es de la Gen. IV
    ['diamond', 122, 'Mime Jr.[Mr. Mime*]'],
  ] as const)('%s #%i -> %s', async (game, id, expected) => {
    const { service } = makeService();
    const card = await service.buildCard(game, 'national', 'game', id);
    expect(tree(card.family)).toBe(expected);
  });

  it('Negro y Blanco usan sus animaciones propias; Platino también', async () => {
    const { service } = makeService();
    const bw = await service.buildCard('black', 'national', 'animated', 25);
    expect(bw.sprite).toMatchObject({ animated: true, fromOtherGame: false });
    const pt = await service.buildCard('platinum', 'national', 'animated', 25);
    expect(decodeURIComponent(pt.sprite!.url)).toContain('generation-iv/platinum/animated');
  });
});
