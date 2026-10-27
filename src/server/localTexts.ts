import fs from 'node:fs';
import path from 'node:path';
import type { LocalText } from './history.js';

interface TextsFile {
  profile: string;
  language: string;
  entries: Record<string, LocalText>;
}

/**
 * Textos de Pokédex en español verificados por el usuario: texts/<id-perfil>.json.
 * Se releen automáticamente cuando cambia el archivo, sin reiniciar el servidor.
 */
export class LocalTexts {
  private cache = new Map<string, { mtimeMs: number; data: TextsFile | null; error?: string }>();

  constructor(private dir: string) {}

  private load(profileId: string) {
    const file = path.join(this.dir, `${profileId}.json`);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      return { data: null };
    }
    const hit = this.cache.get(profileId);
    if (hit && hit.mtimeMs === mtimeMs) return hit;
    let entry: { mtimeMs: number; data: TextsFile | null; error?: string };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TextsFile;
      if (parsed.language !== 'es') throw new Error('"language" debe ser "es"');
      if (!parsed.entries || typeof parsed.entries !== 'object') throw new Error('falta "entries"');
      entry = { mtimeMs, data: parsed };
    } catch (e) {
      entry = { mtimeMs, data: null, error: `texts/${profileId}.json: ${(e as Error).message}` };
    }
    this.cache.set(profileId, entry);
    return entry;
  }

  get(profileId: string, speciesId: number): { text?: LocalText; error?: string } {
    const { data, error } = this.load(profileId) as { data: TextsFile | null; error?: string };
    const text = data?.entries[String(speciesId)];
    return { text: text && typeof text.text === 'string' ? text : undefined, error };
  }
}
