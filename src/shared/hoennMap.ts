// Mapa de Hoenn para el minimapa: zonas del mapa (MAPSEC) con su rectángulo en la
// cuadrícula de 28 × 15 casillas del mapa del juego. Extraído de la tabla de la ROM
// de Esmeralda española (0x5A41E4); solo las zonas que aparecen en el mapa de Hoenn.

export type MapKind = 'town' | 'route' | 'sea' | 'place' | 'underwater';

export interface MapSection {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: MapKind;
  name: string;
}

export const MAP_COLS = 28;
export const MAP_ROWS = 15;

// [MAPSEC, x, y, ancho, alto, tipo, nombre]
const RAW: Array<[number, number, number, number, number, MapKind, string]> = [
  [0, 4, 11, 1, 1, "town", "VILLA RAÍZ"],
  [1, 4, 9, 1, 1, "town", "PUEBLO ESCASO"],
  [2, 2, 14, 1, 1, "town", "PUEBLO AZULIZA"],
  [3, 5, 3, 1, 1, "town", "PUEBLO LAVACALDA"],
  [4, 3, 0, 1, 1, "town", "PUEBLO PARDAL"],
  [5, 4, 6, 1, 1, "town", "PUEBLO VERDEGAL"],
  [6, 17, 10, 1, 1, "town", "PUEBLO OROMAR"],
  [7, 1, 9, 1, 1, "town", "CIUDAD PETALIA"],
  [8, 8, 10, 1, 2, "town", "CIUDAD PORTUAL"],
  [9, 8, 6, 2, 1, "town", "CIUDAD MALVALONA"],
  [10, 0, 5, 1, 2, "town", "CIUDAD FÉRRICA"],
  [11, 12, 0, 1, 1, "town", "CIUDAD ARBORADA"],
  [12, 18, 3, 2, 1, "town", "CIUDAD CALAGUA"],
  [13, 24, 5, 2, 1, "town", "CIUDAD ALGARIA"],
  [14, 21, 7, 1, 1, "town", "ARRECÍPOLIS"],
  [15, 27, 8, 1, 2, "town", "CIUDAD COLOSALIA"],
  [16, 4, 10, 1, 1, "route", "RUTA 101"],
  [17, 2, 9, 2, 1, "route", "RUTA 102"],
  [18, 4, 8, 4, 1, "route", "RUTA 103"],
  [19, 0, 7, 1, 3, "route", "RUTA 104"],
  [20, 0, 10, 1, 3, "sea", "RUTA 105"],
  [21, 0, 13, 2, 1, "sea", "RUTA 106"],
  [22, 3, 14, 3, 1, "sea", "RUTA 107"],
  [23, 6, 14, 2, 1, "sea", "RUTA 108"],
  [24, 8, 12, 1, 3, "sea", "RUTA 109"],
  [25, 8, 7, 1, 3, "route", "RUTA 110"],
  [26, 8, 0, 1, 6, "route", "RUTA 111"],
  [27, 6, 3, 2, 1, "route", "RUTA 112"],
  [28, 4, 0, 4, 1, "route", "RUTA 113"],
  [29, 1, 0, 2, 3, "route", "RUTA 114"],
  [30, 0, 2, 1, 3, "route", "RUTA 115"],
  [31, 1, 5, 4, 1, "route", "RUTA 116"],
  [32, 5, 6, 3, 1, "route", "RUTA 117"],
  [33, 10, 6, 2, 1, "route", "RUTA 118"],
  [34, 11, 0, 1, 6, "route", "RUTA 119"],
  [35, 13, 0, 1, 4, "route", "RUTA 120"],
  [36, 14, 3, 4, 1, "route", "RUTA 121"],
  [37, 16, 4, 1, 2, "sea", "RUTA 122"],
  [38, 12, 6, 5, 1, "route", "RUTA 123"],
  [39, 20, 3, 4, 3, "sea", "RUTA 124"],
  [40, 24, 3, 2, 2, "sea", "RUTA 125"],
  [41, 20, 6, 3, 3, "sea", "RUTA 126"],
  [42, 23, 6, 3, 3, "sea", "RUTA 127"],
  [43, 23, 9, 4, 1, "sea", "RUTA 128"],
  [44, 24, 10, 2, 1, "sea", "RUTA 129"],
  [45, 21, 10, 3, 1, "sea", "RUTA 130"],
  [46, 18, 10, 3, 1, "sea", "RUTA 131"],
  [47, 15, 10, 2, 1, "sea", "RUTA 132"],
  [48, 12, 10, 3, 1, "sea", "RUTA 133"],
  [49, 9, 10, 3, 1, "sea", "RUTA 134"],
  [50, 20, 3, 4, 3, "underwater", "BAJO EL AGUA"],
  [51, 20, 6, 3, 3, "underwater", "BAJO EL AGUA"],
  [52, 23, 6, 3, 3, "underwater", "BAJO EL AGUA"],
  [53, 23, 9, 4, 1, "underwater", "BAJO EL AGUA"],
  [54, 21, 7, 1, 1, "underwater", "BAJO EL AGUA"],
  [55, 1, 13, 1, 1, "place", "CUEVA GRANITO"],
  [56, 6, 2, 1, 1, "place", "MONTE CENIZO"],
  [57, 16, 2, 1, 1, "place", "ZONA SAFARI"],
  [58, 22, 12, 1, 1, "place", "FRENTE BATALLA"],
  [59, 0, 8, 1, 1, "place", "BOSQUE PETALIA"],
  [60, 2, 5, 1, 1, "place", "TÚNEL FERVERGAL"],
  [61, 6, 14, 1, 1, "place", "NAO ABANDONADA"],
  [62, 8, 7, 1, 1, "place", "MALVALANOVA"],
  [63, 0, 3, 1, 1, "place", "CASCADA METEORO"],
  [64, 1, 2, 1, 1, "place", "CASCADA METEORO"],
  [65, 16, 4, 1, 1, "place", "MONTE PÍRICO"],
  [66, 19, 3, 1, 1, "place", "GUARIDA"],
  [67, 24, 4, 1, 1, "place", "CUEVA CARDUMEN"],
  [68, 24, 9, 1, 1, "place", "CAVERNA ABISAL"],
  [69, 24, 9, 1, 1, "underwater", "BAJO EL AGUA"],
  [70, 27, 9, 1, 1, "place", "CALLE VICTORIA"],
  [71, 17, 10, 1, 1, "place", "ISLA ESPEJISMO"],
  [72, 21, 7, 1, 1, "place", "CUEVA ANCESTRAL"],
  [73, 12, 14, 1, 1, "place", "ISLA DEL SUR"],
  [74, 6, 3, 1, 1, "place", "SENDA ÍGNEA"],
  [75, 7, 3, 1, 1, "place", "SENDA ÍGNEA"],
  [76, 6, 3, 1, 1, "place", "DESFILADERO"],
  [77, 7, 2, 1, 1, "place", "DESFILADERO"],
  [78, 11, 10, 1, 1, "place", "CÁMARA SELLADA"],
  [79, 11, 10, 1, 1, "underwater", "BAJO EL AGUA"],
  [80, 13, 0, 1, 1, "place", "GRUTA SOLAR"],
  [81, 0, 10, 1, 1, "place", "CUEVA INSULAR"],
  [82, 8, 3, 1, 1, "place", "RUINAS DESIERTO"],
  [83, 13, 2, 1, 1, "place", "TUMBA ANTIGUA"],
  [85, 19, 10, 1, 1, "place", "PILAR CELESTE"],
  [197, 19, 3, 1, 1, "place", "GUARIDA AQUA"],
  [198, 6, 3, 1, 1, "place", "GUARIDA MAGMA"],
  [199, 8, 2, 1, 1, "place", "TORRE ESPEJISMO"],
  [202, 22, 12, 1, 1, "place", "CUEVA TALLER"],
  [206, 0, 10, 1, 3, "underwater", "BAJO EL AGUA"],
  [207, 24, 3, 2, 2, "underwater", "BAJO EL AGUA"],
  [208, 24, 10, 2, 1, "underwater", "BAJO EL AGUA"],
  [209, 2, 0, 1, 1, "place", "GRUTA DESÉRTICA"],
  [210, 6, 8, 1, 1, "place", "CUEVA CAMBIANTE"],
  [212, 8, 4, 1, 1, "place", "COLINA DESAFÍO"],];

export const HOENN_SECTIONS: MapSection[] = RAW.map(([id, x, y, w, h, kind, name]) => ({ id, x, y, w, h, kind, name }));
const BY_ID = new Map(HOENN_SECTIONS.map((s) => [s.id, s]));

export function mapSection(id: number): MapSection | undefined {
  return BY_ID.get(id);
}

/** Tipos de mapa del juego (MAP_TYPE_*) que son exteriores: la posición dentro del mapa cuenta. */
const OUTDOOR = new Set([1, 2, 3, 5, 6]);

export interface RawLocation {
  mapsec: number;
  mapType: number;
  /** Posición del jugador en el mapa, en casillas. */
  x: number;
  y: number;
  /** Tamaño del mapa en casillas (0 si no se sabe). */
  width: number;
  height: number;
}

/**
 * Posición del jugador en la cuadrícula del mapa de Hoenn (con decimales, para
 * que el marcador se mueva de forma continua al andar). En interiores y cuevas,
 * el centro de la zona. null si la zona no está en el mapa de Hoenn.
 */
export function regionPosition(loc: RawLocation): { x: number; y: number } | null {
  const s = mapSection(loc.mapsec);
  if (!s) return null;
  if (!OUTDOOR.has(loc.mapType) || loc.width <= 0 || loc.height <= 0) {
    return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  }
  const fx = Math.min(Math.max((loc.x + 0.5) / loc.width, 0), 1);
  const fy = Math.min(Math.max((loc.y + 0.5) / loc.height, 0), 1);
  return { x: s.x + fx * s.w, y: s.y + fy * s.h };
}
