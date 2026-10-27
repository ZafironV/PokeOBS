import { describe, expect, it } from 'vitest';
import { AppError } from '../src/server/pokeapi.js';
import type { EvoNode } from '../src/shared/types.js';
import { makeService } from './helpers.js';

/** Representación compacta del árbol: "Eevee*[Vaporeon,Jolteon]". */
function tree(nodes: EvoNode[]): string {
  return nodes
    .map((n) => `${n.name}${n.selected ? '*' : ''}${n.children.length ? `[${tree(n.children)}]` : ''}`)
    .join(',');
}

describe('tipos históricos', () => {
  const cases: Array<[string, number, string[]]> = [
    ['red', 35, ['normal']], // Clefairy: Hada desde la Gen VI
    ['emerald', 35, ['normal']],
    ['red', 81, ['electric']], // Magnemite: Acero desde la Gen II
    ['emerald', 81, ['electric', 'steel']],
    ['red', 39, ['normal']], // Jigglypuff
    ['emerald', 183, ['water']], // Marill
    ['red', 1, ['grass', 'poison']],
  ];
  it.each(cases)('%s #%i -> %j', async (game, id, types) => {
    const { service } = makeService();
    const card = await service.buildCard(game, 'national', 'game', id);
    expect(card.types.map((t) => t.id)).toEqual(types);
  });

  it('usa etiquetas en español', async () => {
    const { service } = makeService();
    const card = await service.buildCard('emerald', 'national', 'game', 81);
    expect(card.types.map((t) => t.label)).toEqual(['Eléctrico', 'Acero']);
  });
});

describe('familia evolutiva', () => {
  const cases: Array<[string, number, string]> = [
    ['red', 133, 'Eevee*[Vaporeon,Jolteon,Flareon]'],
    ['emerald', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon]'],
    ['red', 44, 'Oddish[Gloom*[Vileplume]]'],
    ['emerald', 44, 'Oddish[Gloom*[Vileplume,Bellossom]]'],
    ['red', 25, 'Pikachu*[Raichu]'], // Pichu (Gen II) queda fuera y Pikachu pasa a ser la raíz
    ['emerald', 25, 'Pichu[Pikachu*[Raichu]]'],
    ['red', 79, 'Slowpoke*[Slowbro]'], // sin Slowking
    ['red', 60, 'Poliwag*[Poliwhirl[Poliwrath]]'], // sin Politoed
    ['emerald', 60, 'Poliwag*[Poliwhirl[Poliwrath,Politoed]]'],
    ['emerald', 265, 'Wurmple*[Silcoon[Beautifly],Cascoon[Dustox]]'],
    ['emerald', 183, 'Azurill[Marill*[Azumarill]]'],
    ['red', 39, 'Jigglypuff*[Wigglytuff]'], // sin Igglybuff
  ];
  it.each(cases)('%s #%i -> %s', async (game, id, expected) => {
    const { service } = makeService();
    const card = await service.buildCard(game, 'national', 'game', id);
    expect(tree(card.family)).toBe(expected);
  });

  it('no consulta especies posteriores a la generación del juego', async () => {
    const { service, api } = makeService();
    await service.buildCard('emerald', 'national', 'game', 133);
    // Leafeon (470), Glaceon (471), Sylveon (700)
    expect(api.calls.some((u) => /pokemon(-species)?\/(470|471|700)\//.test(u))).toBe(false);
  });

  it('la familia puede incluir especies fuera del catálogo regional', async () => {
    const { service } = makeService();
    // Azurill está en Hoenn, Pichu no; la familia de Pikachu en Hoenn la incluye igualmente.
    const card = await service.buildCard('emerald', 'regional', 'game', 25);
    expect(tree(card.family)).toBe('Pichu[Pikachu*[Raichu]]');
  });

  it('cada miembro tiene sprite de la edición', async () => {
    const { service } = makeService();
    const card = await service.buildCard('red', 'regional', 'game', 133);
    const all = (n: EvoNode[]): EvoNode[] => n.flatMap((x) => [x, ...all(x.children)]);
    for (const n of all(card.family)) expect(n.sprite).toContain('generation-i%2Fred-blue');
  });
});

describe('descripciones', () => {
  it('modo "pokeapi": texto exacto de la versión, normalizado y marcado en inglés', async () => {
    const { service } = makeService();
    const card = await service.buildCard('red', 'regional', 'game', 25, 'pokeapi');
    expect(card.description).toMatchObject({ status: 'ok', lang: 'en', source: 'pokeapi', version: 'red' });
    if (card.description.status !== 'ok') throw new Error();
    expect(card.description.text).toBe(
      'When several of these POKéMON gather, their electricity could build and cause lightning storms.',
    );
    expect(card.warnings.join(' ')).toMatch(/inglés/);
  });

  it('da prioridad a los textos locales verificados en español', async () => {
    const { service, texts } = makeService();
    texts.data.red = { 25: { text: 'Texto\nde prueba\fverificado.' } };
    const card = await service.buildCard('red', 'regional', 'game', 25);
    expect(card.description).toEqual({
      status: 'ok',
      text: 'Texto de prueba verificado.',
      lang: 'es',
      source: 'local',
      version: 'red',
    });
    // Los textos locales son por perfil: Esmeralda no los usa.
    const other = await service.buildCard('emerald', 'regional', 'game', 25);
    expect(other.description).toMatchObject({ lang: 'es', source: 'wikidex', version: 'emerald' });
  });
});

describe('sprites', () => {
  it('modo fiel: sprite estático de Rojo/Azul', async () => {
    const { service } = makeService();
    const card = await service.buildCard('red', 'regional', 'game', 25);
    expect(card.sprite).toMatchObject({ animated: false, fromOtherGame: false });
    expect(decodeURIComponent(card.sprite!.url)).toContain('generation-i/red-blue/transparent/25.png');
  });

  it('modo animado en Rojo: pixel art de Negro/Blanco, avisando de que no es de Rojo', async () => {
    const { service } = makeService();
    const card = await service.buildCard('red', 'regional', 'animated', 25);
    expect(card.sprite).toMatchObject({ animated: true, fromOtherGame: true });
    expect(decodeURIComponent(card.sprite!.url)).toContain('generation-v/black-white/animated/25.gif');
    expect(card.warnings.join(' ')).toMatch(/Negro\/Blanco/);
  });

  it('modo animado en Esmeralda: animación propia de Esmeralda', async () => {
    const { service } = makeService();
    const card = await service.buildCard('emerald', 'regional', 'animated', 265);
    expect(card.sprite).toMatchObject({ animated: true, fromOtherGame: false });
    expect(decodeURIComponent(card.sprite!.url)).toContain('generation-iii/emerald/animated/265.png');
  });

  it('sprite no disponible: la ficha se genera sin sprite y avisa en el panel', async () => {
    const { service, images } = makeService();
    images.failing.add('red-blue/transparent/25.png');
    const card = await service.buildCard('red', 'regional', 'game', 25);
    expect(card.sprite).toBeNull();
    expect(card.warnings.join(' ')).toMatch(/sprite principal/);
  });
});

describe('errores', () => {
  it('Pokémon inexistente', async () => {
    const { service } = makeService();
    await expect(service.buildCard('red', 'regional', 'game', 99999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Pokémon fuera del catálogo', async () => {
    const { service } = makeService();
    await expect(service.buildCard('emerald', 'regional', 'game', 133)).rejects.toMatchObject({
      code: 'OUT_OF_CATALOG',
      message: expect.stringContaining('Eevee'),
    });
  });

  it('Pokémon de una generación posterior en un catálogo antiguo', async () => {
    const { service } = makeService();
    await expect(service.buildCard('red', 'national', 'game', 183)).rejects.toMatchObject({ code: 'OUT_OF_CATALOG' });
  });

  it('fallo de red sin caché: error comprensible y el catálogo se reintenta después', async () => {
    const { service, api } = makeService();
    const original = api.getJson.bind(api);
    let offline = true;
    api.getJson = async <T,>(url: string): Promise<T> => {
      if (offline) throw new AppError('NETWORK', 'No se pudo contactar con PokéAPI.', url);
      return original<T>(url);
    };
    await expect(service.buildCard('red', 'regional', 'game', 25)).rejects.toMatchObject({ code: 'NETWORK' });
    offline = false;
    const card = await service.buildCard('red', 'regional', 'game', 25);
    expect(card.name).toBe('Pikachu');
  });

  it('juego desconocido', async () => {
    const { service } = makeService();
    await expect(service.buildCard('pokemon-x', 'regional', 'game', 1)).rejects.toMatchObject({ code: 'INVALID' });
  });
});
