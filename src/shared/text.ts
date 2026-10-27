// Utilidades de texto puras (sin dependencias de Node ni del navegador).

/**
 * Normaliza un texto de Pokédex: los textos de los juegos antiguos llegan con
 * saltos de línea fijos, saltos de página (\f) y guiones blandos (\u00ad).
 * No se altera el contenido, solo el espaciado y los caracteres de control.
 */
export function normalizeFlavorText(raw: string): string {
  return (
    raw
      // Guion blando al final de línea: la palabra continúa en la línea siguiente.
      .replace(/\u00ad[\n\f\r]+/g, '')
      .replace(/\u00ad/g, '')
      // Guion normal partido al final de línea: se conserva el guion sin espacio.
      .replace(/-[\n\f\r]+(?=\p{Ll})/gu, '-')
      .replace(/[\n\f\r\t\v\u2028\u2029]+/g, ' ')
      // Resto de caracteres de control.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

const SPECIAL_NAMES: Record<string, string> = {
  'nidoran-f': 'Nidoran♀',
  'nidoran-m': 'Nidoran♂',
  'mr-mime': 'Mr. Mime',
  'mime-jr': 'Mime Jr.',
  'mr-rime': 'Mr. Rime',
  farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd",
  'ho-oh': 'Ho-Oh',
  'porygon-z': 'Porygon-Z',
  'type-null': 'Código Cero',
  'jangmo-o': 'Jangmo-o',
  'hakamo-o': 'Hakamo-o',
  'kommo-o': 'Kommo-o',
  flabebe: 'Flabébé',
};

/** Nombre legible a partir del identificador de PokéAPI cuando no hay nombre localizado. */
export function formatSpeciesSlug(slug: string): string {
  if (SPECIAL_NAMES[slug]) return SPECIAL_NAMES[slug];
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('-');
}

/** Clave de búsqueda: minúsculas, sin acentos ni signos. "Farfetch'd" -> "farfetchd". */
export function searchKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function padNumber(n: number): string {
  return String(n).padStart(3, '0');
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** "generation-iii" -> 3 */
export function generationNumber(name: string): number {
  const m = /^generation-([ivx]+)$/.exec(name);
  const n = m ? ROMAN[m[1]] : undefined;
  if (!n) throw new Error(`Generación desconocida: ${name}`);
  return n;
}

/** Extrae el id numérico final de una URL de PokéAPI. */
export function idFromUrl(url: string): number {
  const m = /\/(\d+)\/?$/.exec(url);
  if (!m) throw new Error(`URL sin id: ${url}`);
  return Number(m[1]);
}
