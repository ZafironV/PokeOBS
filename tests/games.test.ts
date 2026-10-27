import { describe, expect, it } from 'vitest';
import type { EvoNode } from '../src/shared/types.js';
import { makeService } from './helpers.js';

function tree(nodes: EvoNode[]): string {
  return nodes
    .map((n) => `${n.name}${n.selected ? '*' : ''}${n.children.length ? `[${tree(n.children)}]` : ''}`)
    .join(',');
}

describe('perfiles de Gen. I-III y remakes', () => {
  const { service } = makeService();
  // [id, generación, version-group, versión de textos, Pokédex regional, máximo nacional]
  const expected: Array<[string, number, string, string, string, number]> = [
    ['red', 1, 'red-blue', 'red', 'kanto', 151],
    ['blue', 1, 'red-blue', 'blue', 'kanto', 151],
    ['yellow', 1, 'yellow', 'yellow', 'kanto', 151],
    ['firered', 3, 'firered-leafgreen', 'firered', 'kanto', 386],
    ['leafgreen', 3, 'firered-leafgreen', 'leafgreen', 'kanto', 386],
    ['lets-go-pikachu', 7, 'lets-go-pikachu-lets-go-eevee', 'lets-go-pikachu', 'letsgo-kanto', 809],
    ['lets-go-eevee', 7, 'lets-go-pikachu-lets-go-eevee', 'lets-go-eevee', 'letsgo-kanto', 809],
    ['gold', 2, 'gold-silver', 'gold', 'original-johto', 251],
    ['silver', 2, 'gold-silver', 'silver', 'original-johto', 251],
    ['crystal', 2, 'crystal', 'crystal', 'original-johto', 251],
    ['heartgold', 4, 'heartgold-soulsilver', 'heartgold', 'updated-johto', 493],
    ['soulsilver', 4, 'heartgold-soulsilver', 'soulsilver', 'updated-johto', 493],
    ['ruby', 3, 'ruby-sapphire', 'ruby', 'hoenn', 386],
    ['sapphire', 3, 'ruby-sapphire', 'sapphire', 'hoenn', 386],
    ['emerald', 3, 'emerald', 'emerald', 'hoenn', 386],
    ['omega-ruby', 6, 'omega-ruby-alpha-sapphire', 'omega-ruby', 'updated-hoenn', 721],
    ['alpha-sapphire', 6, 'omega-ruby-alpha-sapphire', 'alpha-sapphire', 'updated-hoenn', 721],
  ];

  it('están los 17 juegos de Gen. I-III y remakes, más los 7 de Gen. IV-V', () => {
    const genIV_V = ['diamond', 'pearl', 'platinum', 'black', 'white', 'black-2', 'white-2'];
    expect(service.profiles.map((p) => p.id).sort()).toEqual([...expected.map((e) => e[0]), ...genIV_V].sort());
  });

  it.each(expected)('%s: gen %i, %s, textos %s, Pokédex %s, nacional ≤ %i', (id, gen, vg, text, dex, max) => {
    const p = service.profile(id);
    expect(p).toMatchObject({ generation: gen, versionGroup: vg, textVersion: text, regionalPokedex: { name: dex } });
    expect(p.nationalDex.maxSpecies).toBe(max);
  });

  it("solo Let's Go carece de Pokédex Nacional y limita la familia a sus especies", () => {
    for (const p of service.profiles) {
      const lgpe = p.id.startsWith('lets-go');
      expect(p.nationalDex.available).toBe(!lgpe);
      expect(p.familyScope).toBe(lgpe ? 'regional' : 'national');
    }
  });
});

describe('catálogos de los nuevos juegos', () => {
  const sizes: Array<[string, 'regional' | 'national', number]> = [
    ['yellow', 'regional', 151],
    ['firered', 'regional', 151],
    ['firered', 'national', 386],
    ['gold', 'regional', 251],
    ['crystal', 'national', 251],
    ['heartgold', 'regional', 256],
    ['heartgold', 'national', 493],
    ['omega-ruby', 'regional', 211],
    ['omega-ruby', 'national', 721],
    ['lets-go-pikachu', 'regional', 153],
  ];
  it.each(sizes)('%s %s: %i especies', async (game, mode, n) => {
    const { service } = makeService();
    const c = await service.catalog(game, mode);
    expect(c.entries).toHaveLength(n);
    expect(c.entries.every((e) => e.speciesId <= service.profile(game).nationalDex.maxSpecies)).toBe(true);
  });

  it('Johto original: Pichu y Chikorita sí, especies de la Gen. III no', async () => {
    const { service } = makeService();
    const c = await service.catalog('gold', 'regional');
    expect(c.entries.find((e) => e.slug === 'chikorita')?.regionalNumber).toBe(1);
    expect(c.entries.some((e) => e.speciesId > 251)).toBe(false);
  });

  it("Let's Go: incluye Meltan y Melmetal pero no especies de Johto", async () => {
    const { service } = makeService();
    const c = await service.catalog('lets-go-eevee', 'regional');
    expect(c.entries.map((e) => e.slug)).toEqual(expect.arrayContaining(['meltan', 'melmetal', 'eevee']));
    expect(c.entries.some((e) => e.slug === 'espeon' || e.slug === 'pichu')).toBe(false);
  });

  it("Let's Go: el catálogo nacional se rechaza con un mensaje claro", async () => {
    const { service } = makeService();
    await expect(service.catalog('lets-go-pikachu', 'national')).rejects.toMatchObject({
      code: 'INVALID',
      message: expect.stringContaining('no tiene Pokédex Nacional'),
    });
  });
});

describe('familia evolutiva según la generación del juego', () => {
  const cases: Array<[string, number, string]> = [
    // Eevee: cada juego muestra solo las evoluciones que existían en su generación.
    ['yellow', 133, 'Eevee*[Vaporeon,Jolteon,Flareon]'],
    ['gold', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon]'],
    ['firered', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon]'], // remake de Gen. III
    ['heartgold', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon,Leafeon,Glaceon]'], // Gen. IV
    ['omega-ruby', 133, 'Eevee*[Vaporeon,Jolteon,Flareon,Espeon,Umbreon,Leafeon,Glaceon,Sylveon]'], // Gen. VI
    ['lets-go-eevee', 133, 'Eevee*[Vaporeon,Jolteon,Flareon]'], // solo especies del juego
    // Preevoluciones bebé
    ['gold', 25, 'Pichu[Pikachu*[Raichu]]'],
    ['lets-go-pikachu', 25, 'Pikachu*[Raichu]'],
    ['gold', 183, 'Marill*[Azumarill]'], // Azurill es de la Gen. III
    ['heartgold', 183, 'Azurill[Marill*[Azumarill]]'],
    ['crystal', 39, 'Igglybuff[Jigglypuff*[Wigglytuff]]'],
    // Ramas
    ['gold', 44, 'Oddish[Gloom*[Vileplume,Bellossom]]'],
    ['sapphire', 265, 'Wurmple*[Silcoon[Beautifly],Cascoon[Dustox]]'],
    ['lets-go-eevee', 808, 'Meltan*[Melmetal]'],
  ];
  it.each(cases)('%s #%i -> %s', async (game, id, expected) => {
    const { service } = makeService();
    const card = await service.buildCard(game, 'regional', 'game', id).catch(() =>
      service.buildCard(game, 'national', 'game', id),
    );
    expect(tree(card.family)).toBe(expected);
  });
});

describe('tipos históricos en los nuevos juegos', () => {
  const cases: Array<[string, number, string[]]> = [
    ['gold', 81, ['electric', 'steel']],
    ['gold', 35, ['normal']],
    ['heartgold', 35, ['normal']],
    ['omega-ruby', 35, ['fairy']],
    ['lets-go-pikachu', 35, ['fairy']],
    ['gold', 183, ['water']],
    ['omega-ruby', 183, ['water', 'fairy']],
  ];
  it.each(cases)('%s #%i -> %j', async (game, id, types) => {
    const { service } = makeService();
    const mode = service.profile(game).nationalDex.available ? 'national' : 'regional';
    const card = await service.buildCard(game, mode, 'game', id);
    expect(card.types.map((t) => t.id)).toEqual(types);
  });
});

describe('descripciones y sprites de los nuevos juegos', () => {
  it('Rubí Omega y Let\'s Go tienen texto en español en PokéAPI', async () => {
    const { service } = makeService();
    for (const game of ['omega-ruby', 'alpha-sapphire', 'lets-go-pikachu', 'lets-go-eevee']) {
      const card = await service.buildCard(game, 'regional', 'game', 25);
      expect(card.description).toMatchObject({ status: 'ok', lang: 'es', source: 'pokeapi', version: game });
    }
  });

  it('Oro y Rojo Fuego: en PokéAPI solo hay inglés, de su propia versión', async () => {
    const { service } = makeService();
    for (const game of ['gold', 'firered']) {
      const card = await service.buildCard(game, 'regional', 'game', 25, 'pokeapi');
      expect(card.description).toMatchObject({ lang: 'en', version: game });
    }
  });

  it('Cristal y HeartGold usan sus propias animaciones', async () => {
    const { service } = makeService();
    const crystal = await service.buildCard('crystal', 'regional', 'animated', 25);
    expect(crystal.sprite).toMatchObject({ animated: true, fromOtherGame: false });
    expect(decodeURIComponent(crystal.sprite!.url)).toContain('generation-ii/crystal/animated/25');
    const hg = await service.buildCard('heartgold', 'regional', 'animated', 25);
    expect(decodeURIComponent(hg.sprite!.url)).toContain('generation-iv/heartgold-soulsilver/animated/25');
  });

  it('Rojo Fuego animado: usa Esmeralda y avisa de que no es de Rojo Fuego', async () => {
    const { service } = makeService();
    const card = await service.buildCard('firered', 'regional', 'animated', 25);
    expect(card.sprite).toMatchObject({ animated: true, fromOtherGame: true });
    expect(card.warnings.join(' ')).toMatch(/Esmeralda/);
  });

  it('Rubí Omega: render 3D del propio juego, marcado como tal; en animado usa pixel art 2D', async () => {
    const { service } = makeService();
    const fiel = await service.buildCard('omega-ruby', 'regional', 'game', 25);
    expect(fiel.sprite).toMatchObject({ render3d: true, fromOtherGame: false });
    expect(fiel.familySmooth).toBe(true);
    expect(fiel.warnings.join(' ')).toMatch(/render 3D/);
    const anim = await service.buildCard('omega-ruby', 'regional', 'animated', 25);
    expect(anim.sprite).toMatchObject({ render3d: false, animated: true });
    expect(decodeURIComponent(anim.sprite!.url)).toContain('black-white/animated');
  });
});
