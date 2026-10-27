// Reglas puras sobre los datos de PokéAPI: tipos históricos, familia evolutiva,
// descripciones y sprites. No hacen E/S para poder probarlas con datos reales guardados.

import type { Description, PokemonType, SpriteSource, TextMode } from '../shared/types.js';
import { nearestVersions, versionInfo } from '../shared/versions.js';
import { TYPE_INFO } from '../shared/pokemonTypes.js';
import { generationNumber, idFromUrl, normalizeFlavorText } from '../shared/text.js';

interface ApiTypeSlot {
  slot: number;
  type: { name: string };
}

interface ApiPastTypes {
  generation: { name: string };
  types: ApiTypeSlot[];
}

/**
 * Tipos que tenía la especie en la generación indicada.
 * `past_types` indica los tipos vigentes HASTA esa generación (incluida): se
 * elige la entrada más antigua cuya generación sea >= la seleccionada.
 */
export function resolveTypes(
  current: ApiTypeSlot[],
  pastTypes: ApiPastTypes[] | undefined,
  generation: number,
): { types: PokemonType[]; warnings: string[] } {
  const candidates = (pastTypes ?? [])
    .map((p) => ({ gen: generationNumber(p.generation.name), types: p.types }))
    .filter((p) => p.gen >= generation)
    .sort((a, b) => a.gen - b.gen);
  const slots = (candidates[0]?.types ?? current).slice().sort((a, b) => a.slot - b.slot);
  const warnings: string[] = [];
  const types: PokemonType[] = [];
  for (const s of slots) {
    const info = TYPE_INFO[s.type.name];
    if (info && info.introducedIn > generation) {
      // Protección extra: nunca mostrar un tipo que no existía en el juego.
      warnings.push(`Se omitió el tipo "${info.label}", que no existía en la generación ${generation}.`);
      continue;
    }
    types.push({ id: s.type.name, label: info?.label ?? s.type.name });
  }
  return { types, warnings };
}

export interface ApiChainLink {
  species: { name: string; url: string };
  evolves_to: ApiChainLink[];
}

export interface RawEvoNode {
  speciesId: number;
  slug: string;
  children: RawEvoNode[];
}

/**
 * Elimina de la cadena las especies que no cumplen `keep` (introducidas
 * después de la generación). Si se elimina una preevolución posterior (p. ej.
 * Pichu en Gen I), sus descendientes válidos suben de nivel.
 */
export function filterChain(link: ApiChainLink, keep: (speciesId: number) => boolean): RawEvoNode[] {
  const id = idFromUrl(link.species.url);
  const children = link.evolves_to.flatMap((c) => filterChain(c, keep));
  if (!keep(id)) return children;
  return [{ speciesId: id, slug: link.species.name, children }];
}

export function chainSpeciesIds(nodes: RawEvoNode[]): number[] {
  return nodes.flatMap((n) => [n.speciesId, ...chainSpeciesIds(n.children)]);
}

interface ApiFlavorEntry {
  flavor_text: string;
  language: { name: string };
  version: { name: string };
}

export interface LocalText {
  text: string;
  source?: string;
}

export interface SpanishEntry {
  text: string;
  multipleForms?: boolean;
}

export interface DescriptionInput {
  entries: ApiFlavorEntry[];
  version: string;
  local?: LocalText;
  /** Entradas de WikiDex por clave de edición (null si no se consultó o no existen). */
  wikidex?: Record<string, SpanishEntry> | null;
  mode: TextMode;
}

function apiText(entries: ApiFlavorEntry[], version: string, lang: string): string | null {
  const e = entries.find((x) => x.version.name === version && x.language.name === lang);
  const text = e ? normalizeFlavorText(e.flavor_text) : '';
  return text || null;
}

/**
 * Prioridad:
 * 1. texto local verificado (texts/<perfil>.json);
 * 2. PokéAPI en español de esta misma versión;
 * 3. WikiDex: texto oficial español de esta misma versión (salvo modo "pokeapi");
 * 4. solo en modo "es-aprox": texto español de la edición más cercana, indicando cuál;
 * 5. PokéAPI en inglés de esta misma versión.
 * Fuera del paso 4, nunca se usa el texto de otra edición.
 */
export function pickDescription(input: DescriptionInput): { description: Description; notes: string[] } {
  const { entries, version, local, wikidex, mode } = input;
  const notes: string[] = [];
  const ok = (text: string, lang: 'es' | 'en', source: 'local' | 'pokeapi' | 'wikidex', v = version, approxFrom?: string) => ({
    description: { status: 'ok' as const, text, lang, source, version: v, ...(approxFrom ? { approxFrom } : {}) },
    notes,
  });
  if (local?.text?.trim()) return ok(normalizeFlavorText(local.text), 'es', 'local');
  const es = apiText(entries, version, 'es');
  if (es) return ok(es, 'es', 'pokeapi');
  const fromWikidex = (v: string): string | null => {
    const key = versionInfo(v)?.wikidexKey;
    const entry = key ? wikidex?.[key] : undefined;
    if (!entry?.text) return null;
    if (entry.multipleForms) notes.push('WikiDex recoge varias formas para esta edición; se muestra la primera.');
    return normalizeFlavorText(entry.text) || null;
  };
  if (mode !== 'pokeapi') {
    const wd = fromWikidex(version);
    if (wd) return ok(wd, 'es', 'wikidex');
  }
  if (mode === 'es-aprox') {
    for (const other of nearestVersions(version)) {
      const text = apiText(entries, other.version, 'es');
      if (text) return ok(text, 'es', 'pokeapi', other.version, other.name);
      const wd = fromWikidex(other.version);
      if (wd) return ok(wd, 'es', 'wikidex', other.version, other.name);
    }
  }
  const en = apiText(entries, version, 'en');
  if (en) return ok(en, 'en', 'pokeapi');
  return { description: { status: 'missing' }, notes };
}

/** Busca una ruta con puntos dentro del objeto sprites ("versions.generation-i.red-blue.front_default"). */
export function spriteAt(sprites: unknown, dotted: string): string | null {
  let cur: any = sprites;
  for (const key of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[key];
  }
  return typeof cur === 'string' && cur ? cur : null;
}

export function firstSprite(
  sprites: unknown,
  sources: SpriteSource[],
): { url: string; source: SpriteSource } | null {
  for (const source of sources) {
    const url = spriteAt(sprites, source.path);
    if (url) return { url, source };
  }
  return null;
}

/** Nombre localizado en español, con respaldo al inglés. */
export function localizedName(names: Array<{ name: string; language: { name: string } }>): string | null {
  return names.find((n) => n.language.name === 'es')?.name ?? names.find((n) => n.language.name === 'en')?.name ?? null;
}
