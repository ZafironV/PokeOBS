import { describe, expect, it } from 'vitest';
import { makeService } from './helpers.js';

describe('perfiles de juego', () => {
  const { service } = makeService();
  const red = service.profile('red');
  const emerald = service.profile('emerald');

  it('Rojo es la edición original de Game Boy con Pokédex de Kanto', () => {
    expect(red.generation).toBe(1);
    expect(red.versionGroup).toBe('red-blue');
    expect(red.textVersion).toBe('red');
    expect(red.regionalPokedex.name).toBe('kanto');
    expect(red.nationalDex.maxSpecies).toBe(151);
  });

  it('Esmeralda usa la Pokédex de Hoenn original, no la actualizada de ROZA', () => {
    expect(emerald.generation).toBe(3);
    expect(emerald.versionGroup).toBe('emerald');
    expect(emerald.textVersion).toBe('emerald');
    expect(emerald.regionalPokedex.name).toBe('hoenn');
    expect(emerald.regionalPokedex.name).not.toBe('updated-hoenn');
    expect(emerald.nationalDex.maxSpecies).toBe(386);
  });
});

describe('catálogos', () => {
  it('Kanto (Rojo) tiene 151 especies y ninguna posterior a la Gen I', async () => {
    const { service } = makeService();
    const c = await service.catalog('red', 'regional');
    expect(c.entries).toHaveLength(151);
    expect(c.entries[0]).toMatchObject({ speciesId: 1, regionalNumber: 1 });
    expect(c.entries.at(-1)).toMatchObject({ slug: 'mew', regionalNumber: 151 });
    expect(c.entries.every((e) => e.speciesId <= 151)).toBe(true);
    expect(c.entries.some((e) => e.slug === 'pichu' || e.slug === 'chikorita')).toBe(false);
  });

  it('Nacional de Rojo coincide con Kanto', async () => {
    const { service } = makeService();
    const c = await service.catalog('red', 'national');
    expect(c.entries).toHaveLength(151);
    expect(await service.regionalEqualsNational('red')).toBe(true);
  });

  it('Hoenn original (Esmeralda) tiene 202 especies con numeración regional propia', async () => {
    const { service } = makeService();
    const c = await service.catalog('emerald', 'regional');
    expect(c.entries).toHaveLength(202);
    expect(c.entries[0]).toMatchObject({ slug: 'treecko', speciesId: 252, regionalNumber: 1 });
    expect(c.entries.at(-1)).toMatchObject({ slug: 'deoxys', regionalNumber: 202 });
    expect(c.entries.find((e) => e.slug === 'pikachu')?.regionalNumber).toBe(156);
    // No es "toda la Gen III" ni incluye especies de Kanto ausentes en Hoenn.
    expect(c.entries.some((e) => e.slug === 'bulbasaur' || e.slug === 'eevee')).toBe(false);
    expect(c.entries.every((e) => e.speciesId <= 386)).toBe(true);
    expect(await service.regionalEqualsNational('emerald')).toBe(false);
  });

  it('Nacional de Esmeralda: 386 especies, sin la Gen IV', async () => {
    const { service } = makeService();
    const c = await service.catalog('emerald', 'national');
    expect(c.entries).toHaveLength(386);
    expect(c.entries.some((e) => e.speciesId === 387)).toBe(false);
    expect(c.entries.find((e) => e.slug === 'eevee')?.regionalNumber).toBeNull();
    expect(c.entries.find((e) => e.slug === 'treecko')?.regionalNumber).toBe(1);
  });
});
