import type { CatalogEntry } from './types.js';
import { searchKey } from './text.js';

/**
 * Filtra el catálogo localmente. Acepta número (regional o nacional, con o sin
 * "#" y ceros) o nombre (sin distinguir acentos ni mayúsculas).
 * Orden: coincidencia exacta, prefijo y después subcadena.
 */
export function filterCatalog(entries: CatalogEntry[], query: string, limit = 50): CatalogEntry[] {
  const q = query.trim().replace(/^(#|n[ºo°.]\s*)/i, '');
  if (!q) return entries.slice(0, limit);

  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const exact = entries.filter((e) => e.regionalNumber === n || e.speciesId === n);
    const prefix = entries.filter(
      (e) =>
        !exact.includes(e) &&
        (String(e.regionalNumber ?? '').startsWith(q) || String(e.speciesId).startsWith(q)),
    );
    return [...exact, ...prefix].slice(0, limit);
  }

  const key = searchKey(q);
  if (!key) return [];
  const scored: Array<[number, CatalogEntry]> = [];
  for (const e of entries) {
    const names = [searchKey(e.name), searchKey(e.slug)];
    let score = -1;
    if (names.some((n) => n === key)) score = 0;
    else if (names.some((n) => n.startsWith(key))) score = 1;
    else if (names.some((n) => n.includes(key))) score = 2;
    if (score >= 0) scored.push([score, e]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map(([, e]) => e);
}
