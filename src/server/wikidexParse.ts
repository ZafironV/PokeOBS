// Análisis puro del wikitexto de WikiDex: extrae los textos de la plantilla
// {{Pokédex}} de la sección "Descripción Pokédex" y los convierte en texto plano.

/** Devuelve el contenido de la primera plantilla {{Pokédex ...}} de la sección de descripciones. */
export function extractPokedexTemplate(wikitext: string): string | null {
  const section = wikitext.search(/^==\s*Descripción Pokédex\s*==\s*$/m);
  if (section < 0) return null;
  const re = /\{\{\s*Pokédex\s*(?=\||\n|\}\})/g;
  re.lastIndex = section;
  const m = re.exec(wikitext);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index; i < wikitext.length - 1; i++) {
    if (wikitext.startsWith('{{', i)) {
      depth++;
      i++;
    } else if (wikitext.startsWith('}}', i)) {
      depth--;
      i++;
      if (depth === 0) return wikitext.slice(m.index + 2, i - 1);
    }
  }
  return null;
}

/** Divide por "|" de primer nivel (sin entrar en {{...}} ni [[...]]). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      i++;
    } else if (two === '}}' || two === ']]') {
      depth--;
      i++;
    } else if (s[i] === '|' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Parámetros con nombre de la plantilla; las referencias ("verdehoja = rojoyazul") se resuelven. */
export function parsePokedexParams(template: string): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const part of splitTopLevel(template).slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key && value && !(key in raw)) raw[key] = value;
  }
  const resolved: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    let value = raw[key];
    const seen = new Set([key]);
    while (raw[value.toLowerCase()] !== undefined && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      value = raw[value.toLowerCase()];
    }
    resolved[key] = value;
  }
  return resolved;
}

/**
 * Convierte el wikitexto de una entrada en texto plano.
 * - {{n|latinoamericano|España}}: variantes regionales; se usa la de España.
 * - Listas de formas ("* '''Forma:''' texto"): se usa la primera.
 */
export function cleanWikiText(value: string): { text: string; multipleForms: boolean } {
  let s = value;
  const bullets = s.split('\n').filter((l) => l.trim().startsWith('*'));
  const multipleForms = bullets.length > 1;
  if (bullets.length) s = bullets[0].replace(/^\s*\*\s*/, '').replace(/^'''[^']+?:?'''\s*:?\s*/, '');
  for (let guard = 0; guard < 10 && /\{\{/.test(s); guard++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => {
      const args = inner.split('|');
      const name = args[0].trim().toLowerCase();
      if (name === 'n') return (args[2] ?? args[1] ?? '').trim();
      return args.length > 1 ? args[args.length - 1].trim() : '';
    });
  }
  s = s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''|''/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<ref[\s\S]*?(<\/ref>|\/>)/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
  return { text: s.replace(/\s+/g, ' ').trim(), multipleForms };
}

export interface WikiDexEntry {
  text: string;
  multipleForms: boolean;
}

/** Todas las entradas de la página, por clave de edición. */
export function parseWikiDexPage(wikitext: string): Record<string, WikiDexEntry> | null {
  const tpl = extractPokedexTemplate(wikitext);
  if (!tpl) return null;
  const out: Record<string, WikiDexEntry> = {};
  for (const [key, value] of Object.entries(parsePokedexParams(tpl))) {
    const cleaned = cleanWikiText(value);
    if (cleaned.text) out[key] = cleaned;
  }
  return out;
}
