// Nombres en español, colores y generación de introducción de cada tipo.

export interface TypeInfo {
  label: string;
  color: string;
  introducedIn: number;
}

export const TYPE_INFO: Record<string, TypeInfo> = {
  normal: { label: 'Normal', color: '#A8A878', introducedIn: 1 },
  fire: { label: 'Fuego', color: '#F08030', introducedIn: 1 },
  water: { label: 'Agua', color: '#6890F0', introducedIn: 1 },
  grass: { label: 'Planta', color: '#78C850', introducedIn: 1 },
  electric: { label: 'Eléctrico', color: '#F8D030', introducedIn: 1 },
  ice: { label: 'Hielo', color: '#98D8D8', introducedIn: 1 },
  fighting: { label: 'Lucha', color: '#C03028', introducedIn: 1 },
  poison: { label: 'Veneno', color: '#A040A0', introducedIn: 1 },
  ground: { label: 'Tierra', color: '#E0C068', introducedIn: 1 },
  flying: { label: 'Volador', color: '#A890F0', introducedIn: 1 },
  psychic: { label: 'Psíquico', color: '#F85888', introducedIn: 1 },
  bug: { label: 'Bicho', color: '#A8B820', introducedIn: 1 },
  rock: { label: 'Roca', color: '#B8A038', introducedIn: 1 },
  ghost: { label: 'Fantasma', color: '#705898', introducedIn: 1 },
  dragon: { label: 'Dragón', color: '#7038F8', introducedIn: 1 },
  dark: { label: 'Siniestro', color: '#705848', introducedIn: 2 },
  steel: { label: 'Acero', color: '#B8B8D0', introducedIn: 2 },
  fairy: { label: 'Hada', color: '#EE99AC', introducedIn: 6 },
};

export function typeColor(id: string): string {
  return TYPE_INFO[id]?.color ?? '#68A090';
}
