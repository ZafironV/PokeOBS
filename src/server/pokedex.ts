import type {
  Card,
  CardSprite,
  Catalog,
  CatalogEntry,
  CatalogMode,
  EvoNode,
  GameProfile,
  SpeciesBrief,
  SpriteMode,
  TextMode,
} from '../shared/types.js';
import { versionInfo } from '../shared/versions.js';
import { formatSpeciesSlug, generationNumber, idFromUrl } from '../shared/text.js';
import {
  chainSpeciesIds,
  filterChain,
  firstSprite,
  localizedName,
  pickDescription,
  resolveTypes,
  type RawEvoNode,
} from './history.js';
import type { LocalText } from './history.js';
import { AppError, type ImageStore, type JsonSource } from './pokeapi.js';
import type { SpanishTextSource } from './wikidex.js';

export interface LocalTextSource {
  get(profileId: string, speciesId: number): { text?: LocalText; error?: string };
}

export class PokedexService {
  private catalogs = new Map<string, Promise<Catalog>>();

  constructor(
    private api: JsonSource,
    private images: ImageStore,
    private texts: LocalTextSource,
    private apiBase: string,
    public profiles: GameProfile[],
    /** Textos oficiales en español de WikiDex (null para no consultarlos nunca). */
    private spanish: SpanishTextSource | null = null,
  ) {}

  profile(id: string): GameProfile {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) throw new AppError('INVALID', `Juego desconocido: ${id}`);
    return p;
  }

  private url(path: string) {
    return `${this.apiBase}/${path}`;
  }

  private nameFor(speciesId: number, slug: string): string {
    const cached = this.api.peekJson?.<any>(this.url(`pokemon-species/${speciesId}/`));
    return (cached && localizedName(cached.names)) || formatSpeciesSlug(slug);
  }

  catalog(gameId: string, mode: CatalogMode): Promise<Catalog> {
    const key = `${gameId}:${mode}`;
    let p = this.catalogs.get(key);
    if (!p) {
      p = this.buildCatalog(this.profile(gameId), mode);
      // Un fallo (p. ej. sin red) no debe quedarse cacheado.
      p.catch(() => this.catalogs.delete(key));
      this.catalogs.set(key, p);
    }
    return p.then((c) => ({
      ...c,
      // Los nombres se refrescan con los nombres en español ya guardados en caché.
      entries: c.entries.map((e) => ({ ...e, name: this.nameFor(e.speciesId, e.slug) })),
    }));
  }

  private async buildCatalog(profile: GameProfile, mode: CatalogMode): Promise<Catalog> {
    if (mode === 'national' && !profile.nationalDex.available) {
      throw new AppError(
        'INVALID',
        `${profile.name} no tiene Pokédex Nacional; usa ${profile.regionalPokedex.label}.`,
      );
    }
    const regional = await this.api.getJson<any>(this.url(`pokedex/${profile.regionalPokedex.name}/`));
    const regionalNumbers = new Map<number, number>();
    for (const e of regional.pokemon_entries) {
      regionalNumbers.set(idFromUrl(e.pokemon_species.url), e.entry_number);
    }
    let entries: CatalogEntry[];
    if (mode === 'regional') {
      entries = regional.pokemon_entries.map((e: any) => ({
        speciesId: idFromUrl(e.pokemon_species.url),
        slug: e.pokemon_species.name,
        name: formatSpeciesSlug(e.pokemon_species.name),
        regionalNumber: e.entry_number,
      }));
      entries.sort((a, b) => (a.regionalNumber ?? 0) - (b.regionalNumber ?? 0));
    } else {
      const national = await this.api.getJson<any>(this.url('pokedex/national/'));
      entries = national.pokemon_entries
        .filter((e: any) => idFromUrl(e.pokemon_species.url) <= profile.nationalDex.maxSpecies)
        .map((e: any) => {
          const id = idFromUrl(e.pokemon_species.url);
          return {
            speciesId: id,
            slug: e.pokemon_species.name,
            name: formatSpeciesSlug(e.pokemon_species.name),
            regionalNumber: regionalNumbers.get(id) ?? null,
          };
        });
      entries.sort((a, b) => a.speciesId - b.speciesId);
    }
    // Seguridad: ningún catálogo antiguo puede contener especies posteriores.
    entries = entries.filter((e) => e.speciesId <= profile.nationalDex.maxSpecies);
    return {
      gameId: profile.id,
      mode,
      label: mode === 'regional' ? profile.regionalPokedex.label : profile.nationalDex.label,
      entries,
    };
  }

  async regionalEqualsNational(gameId: string): Promise<boolean> {
    const p = this.profile(gameId);
    if (!p.nationalDex.available) return false;
    const c = await this.catalog(gameId, 'regional');
    return c.entries.length === p.nationalDex.maxSpecies && c.entries.every((e) => e.regionalNumber === e.speciesId);
  }

  private async species(id: number): Promise<any> {
    try {
      return await this.api.getJson<any>(this.url(`pokemon-species/${id}/`));
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') {
        throw new AppError('NOT_FOUND', `No existe ningún Pokémon con el número ${id}.`);
      }
      throw e;
    }
  }

  private async defaultPokemon(species: any): Promise<any> {
    const variety = species.varieties.find((v: any) => v.is_default) ?? species.varieties[0];
    return this.api.getJson<any>(variety.pokemon.url);
  }

  private async cacheImage(url: string, warnings: string[], what: string): Promise<string | null> {
    try {
      return await this.images.ensure(url);
    } catch (e) {
      warnings.push(`No se pudo obtener ${what}: ${(e as Error).message}`);
      return null;
    }
  }

  async buildCard(
    gameId: string,
    mode: CatalogMode,
    spriteMode: SpriteMode,
    speciesId: number,
    textMode: TextMode = 'es-aprox',
  ): Promise<Card> {
    const profile = this.profile(gameId);
    if (!Number.isInteger(speciesId) || speciesId < 1) {
      throw new AppError('INVALID', 'El número de Pokémon no es válido.');
    }
    const catalog = await this.catalog(gameId, mode);
    const entry = catalog.entries.find((e) => e.speciesId === speciesId);
    if (!entry) {
      const sp = await this.species(speciesId); // distingue "no existe" de "fuera del catálogo"
      const name = localizedName(sp.names) ?? formatSpeciesSlug(sp.name);
      throw new AppError('OUT_OF_CATALOG', `${name} no está en ${catalog.label} de ${profile.name}.`);
    }

    const warnings: string[] = [];
    const species = await this.species(speciesId);
    const pokemon = await this.defaultPokemon(species);

    const { types, warnings: typeWarnings } = resolveTypes(pokemon.types, pokemon.past_types, profile.generation);
    warnings.push(...typeWarnings);

    const local = this.texts.get(profile.id, speciesId);
    if (local.error) warnings.push(`Textos locales ignorados: ${local.error}`);
    const name = localizedName(species.names) ?? formatSpeciesSlug(species.name);
    const wikidex = await this.wikidexFor(species, name, profile.textVersion, local.text !== undefined, textMode, warnings);
    const { description, notes } = pickDescription({
      entries: species.flavor_text_entries,
      version: profile.textVersion,
      local: local.text,
      wikidex,
      mode: textMode,
    });
    warnings.push(...notes);
    if (description.status === 'missing') {
      warnings.push(`No hay descripción de ${profile.name} para esta especie.`);
    } else if (description.approxFrom) {
      warnings.push(
        `No hay texto español de ${profile.name}; se muestra el de ${description.approxFrom} (indicado en la ficha).`,
      );
    } else if (description.source === 'wikidex') {
      warnings.push(`Descripción: texto oficial en español de ${profile.name}, transcrito por WikiDex.`);
    } else if (description.lang === 'en') {
      warnings.push(`No se encontró el texto español de ${profile.name}; se muestra el original en inglés, indicado.`);
    }

    const [sprite, family] = await Promise.all([
      this.mainSprite(profile, spriteMode, pokemon, warnings),
      this.family(profile, species, speciesId, warnings),
    ]);
    const familySmooth = profile.sprites.family.some((s) => s.render3d);

    const regional = mode === 'regional';
    return {
      gameId: profile.id,
      gameName: profile.name,
      platform: profile.platform,
      accent: profile.theme.accent,
      accentDark: profile.theme.accentDark,
      speciesId,
      name,
      number: regional ? (entry.regionalNumber ?? speciesId) : speciesId,
      numberLabel: regional ? profile.regionalPokedex.short : 'Nacional',
      nationalNumber: speciesId,
      types,
      description,
      sprite,
      family,
      familySmooth,
      warnings,
    };
  }

  /**
   * Nombre, sprites (normal y variocolor) y ritmo de crecimiento de una especie,
   * para el equipo y el PC. Usa los sprites de la familia evolutiva del perfil.
   */
  async speciesBrief(gameId: string, speciesId: number): Promise<SpeciesBrief> {
    const profile = this.profile(gameId);
    const species = await this.species(speciesId);
    const pokemon = await this.defaultPokemon(species);
    const name = localizedName(species.names) ?? formatSpeciesSlug(species.name);
    const shinySources = profile.sprites.family
      .filter((s) => s.path.endsWith('front_default'))
      .map((s) => ({ ...s, path: s.path.replace(/front_default$/, 'front_shiny') }));
    const ignore: string[] = [];
    const found = firstSprite(pokemon.sprites, profile.sprites.family);
    const shiny = firstSprite(pokemon.sprites, shinySources);
    const [sprite, spriteShiny] = await Promise.all([
      found ? this.cacheImage(found.url, ignore, name) : null,
      shiny ? this.cacheImage(shiny.url, ignore, name) : null,
    ]);
    return { id: speciesId, name, sprite, spriteShiny, growthRate: species.growth_rate?.name ?? null };
  }

  /** Solo se consulta WikiDex cuando hace falta: sin texto local ni español de PokéAPI para esta edición. */
  private async wikidexFor(
    species: any,
    title: string,
    version: string,
    hasLocal: boolean,
    textMode: TextMode,
    warnings: string[],
  ) {
    if (!this.spanish || textMode === 'pokeapi' || hasLocal) return null;
    const hasApiEs = species.flavor_text_entries.some(
      (e: any) => e.version.name === version && e.language.name === 'es' && e.flavor_text.trim(),
    );
    if (hasApiEs || !versionInfo(version)) return null;
    try {
      const entries = await this.spanish.entries(title);
      if (!entries) warnings.push(`WikiDex no tiene página con textos de Pokédex para "${title}".`);
      return entries;
    } catch (e) {
      warnings.push(`No se pudo consultar WikiDex: ${(e as Error).message}`);
      return null;
    }
  }

  private async mainSprite(
    profile: GameProfile,
    spriteMode: SpriteMode,
    pokemon: any,
    warnings: string[],
  ): Promise<CardSprite | null> {
    let found = spriteMode === 'animated' ? firstSprite(pokemon.sprites, profile.sprites.animated) : null;
    if (spriteMode === 'animated' && !found) {
      warnings.push('No hay sprite animado 2D disponible para este Pokémon; se usa el sprite estático del juego.');
    }
    if (!found) found = firstSprite(pokemon.sprites, profile.sprites.game);
    if (!found && pokemon.sprites?.front_default) {
      warnings.push(`No hay sprite de ${profile.name}; se usa el sprite genérico de PokéAPI.`);
      found = {
        url: pokemon.sprites.front_default,
        source: { path: 'front_default', label: 'Sprite genérico de PokéAPI', fromOtherGame: true },
      };
    }
    if (!found) {
      warnings.push('No hay ningún sprite disponible para este Pokémon.');
      return null;
    }
    if (found.source.fromOtherGame) warnings.push(`Sprite: ${found.source.label}.`);
    else if (found.source.render3d) warnings.push(`Sprite: ${found.source.label} (render 3D del propio juego).`);
    const url = await this.cacheImage(found.url, warnings, 'el sprite principal');
    if (!url) return null;
    return {
      url,
      label: found.source.label,
      animated: found.source.animated === true,
      fromOtherGame: found.source.fromOtherGame === true,
      render3d: found.source.render3d === true,
    };
  }

  private async family(profile: GameProfile, species: any, selectedId: number, warnings: string[]): Promise<EvoNode[]> {
    let chain: any;
    try {
      chain = await this.api.getJson<any>(species.evolution_chain.url);
    } catch (e) {
      warnings.push(`No se pudo cargar la familia evolutiva: ${(e as Error).message}`);
      return [];
    }
    // Juegos con especies limitadas (Let's Go): la familia solo incluye las de su Pokédex.
    let inGame: Set<number> | null = null;
    if (profile.familyScope === 'regional') {
      const regional = await this.catalog(profile.id, 'regional');
      inGame = new Set(regional.entries.map((e) => e.speciesId));
    }
    const filtered = filterChain(
      chain.chain,
      (id) => id <= profile.nationalDex.maxSpecies && (!inGame || inGame.has(id)),
    );
    const ids = chainSpeciesIds(filtered);
    const info = new Map<number, { name: string; sprite: string | null; valid: boolean }>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const sp = await this.species(id);
          // Comprobación cruzada con la generación declarada por PokéAPI.
          const valid = generationNumber(sp.generation.name) <= profile.generation;
          const pk = valid ? await this.defaultPokemon(sp) : null;
          const found = pk ? firstSprite(pk.sprites, profile.sprites.family) : null;
          const name = localizedName(sp.names) ?? formatSpeciesSlug(sp.name);
          const sprite = found ? await this.cacheImage(found.url, warnings, `el sprite de ${name}`) : null;
          info.set(id, { name, sprite, valid });
        } catch (e) {
          warnings.push(`Familia evolutiva incompleta (#${id}): ${(e as Error).message}`);
          info.set(id, { name: `#${id}`, sprite: null, valid: true });
        }
      }),
    );
    const build = (nodes: RawEvoNode[]): EvoNode[] =>
      nodes.flatMap((n) => {
        const i = info.get(n.speciesId)!;
        const children = build(n.children);
        if (!i.valid) return children;
        return [{ speciesId: n.speciesId, name: i.name, sprite: i.sprite, selected: n.speciesId === selectedId, children }];
      });
    return build(filtered);
  }
}
