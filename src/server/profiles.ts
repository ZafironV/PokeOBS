import fs from 'node:fs';
import path from 'node:path';
import type { AutoDetectProfile, GameProfile, GameSummary, SpriteSource } from '../shared/types.js';

function fail(file: string, msg: string): never {
  throw new Error(`Perfil inválido (${file}): ${msg}`);
}

function str(v: unknown, file: string, field: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(file, `"${field}" debe ser un texto no vacío`);
  return v;
}

function sources(v: unknown, file: string, field: string, required: boolean): SpriteSource[] {
  if (!Array.isArray(v)) fail(file, `"${field}" debe ser una lista`);
  if (required && v.length === 0) fail(file, `"${field}" no puede estar vacío`);
  return v.map((s, i) => {
    const o = s as Record<string, unknown>;
    return {
      path: str(o.path, file, `${field}[${i}].path`),
      label: str(o.label, file, `${field}[${i}].label`),
      fromOtherGame: o.fromOtherGame === true,
      animated: o.animated === true,
      render3d: o.render3d === true,
    };
  });
}

/** Dirección o máscara: número o texto hexadecimal ("0x02024084"). */
function hex(v: unknown, file: string, field: string): number {
  const n = typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : v;
  if (!Number.isInteger(n) || (n as number) < 0) fail(file, `"${field}" debe ser una dirección hexadecimal ("0x…")`);
  return n as number;
}

function autoDetect(v: unknown, file: string): AutoDetectProfile | undefined {
  if (v === undefined) return undefined;
  const o = v as Record<string, any>;
  if (o?.engine !== 'gen3') fail(file, '"autoDetect.engine" debe ser "gen3"');
  const codes = o.gameCodes;
  if (!Array.isArray(codes) || !codes.every((c) => typeof c === 'string' && /^[A-Z0-9]{4}$/.test(c))) {
    fail(file, '"autoDetect.gameCodes" debe ser una lista de códigos de 4 caracteres');
  }
  return {
    engine: 'gen3',
    gameCodes: codes,
    inBattle: {
      address: hex(o.inBattle?.address, file, 'autoDetect.inBattle.address'),
      mask: hex(o.inBattle?.mask, file, 'autoDetect.inBattle.mask'),
    },
    battleTypeFlags: hex(o.battleTypeFlags, file, 'autoDetect.battleTypeFlags'),
    battleMons: hex(o.battleMons, file, 'autoDetect.battleMons'),
    party: hex(o.party, file, 'autoDetect.party'),
    saveBlockPointers: hex(o.saveBlockPointers, file, 'autoDetect.saveBlockPointers'),
    mapHeader: hex(o.mapHeader, file, 'autoDetect.mapHeader'),
    backupMapLayout: hex(o.backupMapLayout, file, 'autoDetect.backupMapLayout'),
  };
}

export function validateProfile(raw: unknown, file: string): GameProfile {
  const o = raw as Record<string, any>;
  if (!o || typeof o !== 'object') fail(file, 'no es un objeto JSON');
  const generation = o.generation;
  if (!Number.isInteger(generation) || generation < 1) fail(file, '"generation" debe ser un entero ≥ 1');
  const maxSpecies = o.nationalDex?.maxSpecies;
  if (!Number.isInteger(maxSpecies) || maxSpecies < 1) fail(file, '"nationalDex.maxSpecies" debe ser un entero');
  const id = str(o.id, file, 'id');
  const familyScope = o.familyScope ?? 'national';
  if (familyScope !== 'national' && familyScope !== 'regional') {
    fail(file, '"familyScope" debe ser "national" o "regional"');
  }
  if (!/^[a-z0-9-]+$/.test(id)) fail(file, '"id" solo admite minúsculas, números y guiones');
  return {
    id,
    name: str(o.name, file, 'name'),
    shortName: str(o.shortName, file, 'shortName'),
    platform: str(o.platform, file, 'platform'),
    group: typeof o.group === 'string' && o.group.trim() ? o.group : 'Otros',
    order: Number.isFinite(o.order) ? o.order : 1000,
    notes: typeof o.notes === 'string' ? o.notes : undefined,
    generation,
    versionGroup: str(o.versionGroup, file, 'versionGroup'),
    textVersion: str(o.textVersion, file, 'textVersion'),
    regionalPokedex: {
      name: str(o.regionalPokedex?.name, file, 'regionalPokedex.name'),
      label: str(o.regionalPokedex?.label, file, 'regionalPokedex.label'),
      short: str(o.regionalPokedex?.short, file, 'regionalPokedex.short'),
    },
    nationalDex: {
      maxSpecies,
      label: str(o.nationalDex?.label, file, 'nationalDex.label'),
      available: o.nationalDex?.available !== false,
    },
    familyScope,
    sprites: {
      game: sources(o.sprites?.game, file, 'sprites.game', true),
      animated: sources(o.sprites?.animated ?? [], file, 'sprites.animated', false),
      family: sources(o.sprites?.family ?? o.sprites?.game, file, 'sprites.family', true),
    },
    theme: {
      accent: typeof o.theme?.accent === 'string' ? o.theme.accent : '#d42a2a',
      accentDark: typeof o.theme?.accentDark === 'string' ? o.theme.accentDark : '#8e1414',
    },
    autoDetect: autoDetect(o.autoDetect, file),
  };
}

export function loadProfiles(dir: string): GameProfile[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const profiles = files.map((f) =>
    validateProfile(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f),
  );
  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id)) throw new Error(`Perfil duplicado: ${p.id}`);
    ids.add(p.id);
  }
  if (profiles.length === 0) throw new Error(`No hay perfiles en ${dir}`);
  // Orden explícito del perfil (agrupado por región y cronológico).
  return profiles.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function summarize(p: GameProfile, regionalEqualsNational = false): GameSummary {
  return {
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    platform: p.platform,
    group: p.group,
    notes: p.notes,
    generation: p.generation,
    regionalLabel: p.regionalPokedex.label,
    nationalLabel: p.nationalDex.label,
    nationalAvailable: p.nationalDex.available,
    regionalEqualsNational,
    autoDetect: p.autoDetect !== undefined,
  };
}
