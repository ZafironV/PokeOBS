// Ediciones principales: versión de PokéAPI, clave de la plantilla {{Pokédex}} de
// WikiDex, nombre en español y generación. Se usa para buscar el texto español de
// una edición y, si falta, el de la edición española más cercana.

export interface VersionInfo {
  version: string;
  wikidexKey: string;
  name: string;
  generation: number;
}

export const VERSIONS: VersionInfo[] = [
  { version: 'red', wikidexKey: 'rojoyazul', name: 'Pokémon Rojo', generation: 1 },
  { version: 'blue', wikidexKey: 'rojoyazul', name: 'Pokémon Azul', generation: 1 },
  { version: 'yellow', wikidexKey: 'amarillo', name: 'Pokémon Amarillo', generation: 1 },
  { version: 'gold', wikidexKey: 'oro', name: 'Pokémon Oro', generation: 2 },
  { version: 'silver', wikidexKey: 'plata', name: 'Pokémon Plata', generation: 2 },
  { version: 'crystal', wikidexKey: 'cristal', name: 'Pokémon Cristal', generation: 2 },
  { version: 'ruby', wikidexKey: 'rubí', name: 'Pokémon Rubí', generation: 3 },
  { version: 'sapphire', wikidexKey: 'zafiro', name: 'Pokémon Zafiro', generation: 3 },
  { version: 'emerald', wikidexKey: 'esmeralda', name: 'Pokémon Esmeralda', generation: 3 },
  { version: 'firered', wikidexKey: 'rojofuego', name: 'Pokémon Rojo Fuego', generation: 3 },
  { version: 'leafgreen', wikidexKey: 'verdehoja', name: 'Pokémon Verde Hoja', generation: 3 },
  { version: 'diamond', wikidexKey: 'diamante', name: 'Pokémon Diamante', generation: 4 },
  { version: 'pearl', wikidexKey: 'perla', name: 'Pokémon Perla', generation: 4 },
  { version: 'platinum', wikidexKey: 'platino', name: 'Pokémon Platino', generation: 4 },
  { version: 'heartgold', wikidexKey: 'oro heartgold', name: 'Pokémon Oro HeartGold', generation: 4 },
  { version: 'soulsilver', wikidexKey: 'plata soulsilver', name: 'Pokémon Plata SoulSilver', generation: 4 },
  { version: 'black', wikidexKey: 'negro', name: 'Pokémon Negro', generation: 5 },
  { version: 'white', wikidexKey: 'blanco', name: 'Pokémon Blanco', generation: 5 },
  { version: 'black-2', wikidexKey: 'negro 2', name: 'Pokémon Negro 2', generation: 5 },
  { version: 'white-2', wikidexKey: 'blanco 2', name: 'Pokémon Blanco 2', generation: 5 },
  { version: 'x', wikidexKey: 'x', name: 'Pokémon X', generation: 6 },
  { version: 'y', wikidexKey: 'y', name: 'Pokémon Y', generation: 6 },
  { version: 'omega-ruby', wikidexKey: 'rubí omega', name: 'Pokémon Rubí Omega', generation: 6 },
  { version: 'alpha-sapphire', wikidexKey: 'zafiro alfa', name: 'Pokémon Zafiro Alfa', generation: 6 },
  { version: 'sun', wikidexKey: 'sol', name: 'Pokémon Sol', generation: 7 },
  { version: 'moon', wikidexKey: 'luna', name: 'Pokémon Luna', generation: 7 },
  { version: 'ultra-sun', wikidexKey: 'ultrasol', name: 'Pokémon Ultrasol', generation: 7 },
  { version: 'ultra-moon', wikidexKey: 'ultraluna', name: 'Pokémon Ultraluna', generation: 7 },
  { version: 'lets-go-pikachu', wikidexKey: 'lgpe', name: "Pokémon: Let's Go, Pikachu!", generation: 7 },
  { version: 'lets-go-eevee', wikidexKey: 'lgpe', name: "Pokémon: Let's Go, Eevee!", generation: 7 },
];

export function versionInfo(version: string): VersionInfo | undefined {
  return VERSIONS.find((v) => v.version === version);
}

/**
 * Otras ediciones ordenadas por cercanía a la indicada: primero la misma
 * generación (en el orden de la tabla) y después las más próximas en el tiempo,
 * prefiriendo las anteriores ante un empate.
 */
export function nearestVersions(version: string): VersionInfo[] {
  const self = versionInfo(version);
  if (!self) return [];
  return VERSIONS.filter((v) => v.version !== version)
    .map((v, i) => ({ v, i, d: Math.abs(v.generation - self.generation), later: v.generation > self.generation }))
    .sort((a, b) => a.d - b.d || Number(a.later) - Number(b.later) || a.i - b.i)
    .map((x) => x.v);
}
