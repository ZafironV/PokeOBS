import { mapSection, regionPosition, type RawLocation } from '../shared/hoennMap.js';
import type {
  GameData,
  GameProfile,
  PlayerLocation,
  ServerMessage,
  Settings,
  Showcase,
  SlotItem,
  SpeciesBrief,
} from '../shared/types.js';
import type { RawGame } from './gameWatch.js';
import { HOENN_BADGES, POCKETS } from './gen3save.js';
import type { ItemCatalog } from './items.js';
import { realClock, type Clock } from './live.js';

export interface GameHubDeps {
  speciesBrief(gameId: string, speciesId: number): Promise<SpeciesBrief>;
  items: ItemCatalog | null;
  settings(): Settings;
  /** Envía a los paneles y a los overlays del equipo. */
  broadcast(msg: ServerMessage): void;
  clock?: Clock;
}

const EMPTY: GameData = { game: null, player: null, party: null, badges: null, money: null, pokedex: null, bag: null, pc: null };

/**
 * Datos de la partida para el panel y el overlay del equipo: convierte lo leído
 * de la memoria, añade nombres y sprites (cargados poco a poco y en caché) y
 * controla la mochila o caja del PC que se enseña en el directo.
 */
export class GameHub {
  private raw: RawGame | null = null;
  private profile: GameProfile | null = null;
  private species = new Map<number, SpeciesBrief>();
  private requested = new Set<number>();
  private showing: { showcase: Showcase; endsAt: number; timer: unknown } | null = null;
  private location: PlayerLocation | null = null;
  private clock: Clock;

  constructor(private deps: GameHubDeps) {
    this.clock = deps.clock ?? realClock;
  }

  update(raw: RawGame | null, profile: GameProfile | null) {
    this.raw = raw;
    if (profile?.id !== this.profile?.id) {
      // Los sprites dependen del juego: se recargan con el nuevo perfil.
      this.species.clear();
      this.requested.clear();
    }
    this.profile = profile;
    if (!raw) {
      this.hideShowcase();
      if (this.location) this.updateLocation(null);
    }
    this.loadSpecies();
    if (raw?.pockets && this.deps.items && !this.deps.items.peek()) {
      void this.deps.items.load().then(
        () => this.publish(),
        () => {},
      );
    }
    this.publish();
  }

  get data(): GameData {
    const raw = this.raw;
    if (!raw) return EMPTY;
    const items = this.deps.items?.peek() ?? null;
    const p = this.profile;
    return {
      game: p ? { name: p.name, accent: p.theme.accent, accentDark: p.theme.accentDark } : null,
      player: raw.player,
      party:
        raw.party?.map((m) => ({
          species: m.species,
          nickname: m.nickname,
          level: m.level,
          hp: m.hp,
          maxHp: m.maxHp,
          status: m.status,
          isEgg: m.isEgg,
          shiny: m.shiny,
          ball: m.ball,
        })) ?? null,
      badges: raw.badges?.map((owned, i) => ({ name: HOENN_BADGES[i], owned })) ?? null,
      money: raw.money,
      pokedex: raw.seen && raw.owned ? { seen: raw.seen.size, owned: raw.owned.size } : null,
      bag: raw.pockets
        ? POCKETS.map((p) => ({
            id: p.id,
            label: p.label,
            items: raw.pockets![p.id].map((it) => {
              const info = items?.get(it.id);
              // Icono original de Esmeralda; el nombre en español, de PokéAPI.
              return { id: it.id, quantity: it.quantity, name: info?.name ?? null, icon: `/gba/item-${it.id}.png` };
            }),
          }))
        : null,
      pc: raw.storage
        ? {
            currentBox: raw.storage.currentBox,
            readAt: raw.storage.readAt,
            boxes: raw.storage.boxes.map((b) => ({
              name: b.name,
              wallpaper: b.wallpaper,
              mons: b.mons.map((m) =>
                m
                  ? { species: m.species, nickname: m.nickname, experience: m.experience, isEgg: m.isEgg, shiny: m.shiny }
                  : null,
              ),
            })),
          }
        : null,
    };
  }

  /** Mensajes para un cliente que acaba de conectarse. */
  snapshot(): ServerMessage[] {
    const msgs: ServerMessage[] = [{ type: 'game', data: this.data }];
    if (this.species.size) msgs.push({ type: 'species', entries: [...this.species.values()] });
    msgs.push({ type: 'location', location: this.location });
    if (this.showing) {
      msgs.push({
        type: 'showcase',
        showcase: this.showing.showcase,
        remainingMs: Math.max(0, this.showing.endsAt - this.clock.now()),
      });
    }
    return msgs;
  }

  /** ¿Hay datos de una partida? */
  hasData(): boolean {
    return this.raw !== null;
  }

  /** ¿Tiene este elemento algo que enseñar? (los turnos se saltan los que no) */
  hasContent(item: SlotItem): boolean {
    const raw = this.raw;
    switch (item) {
      case 'card':
        return true;
      case 'party':
        return !!raw?.party?.length;
      case 'badges':
        return !!raw?.badges;
      case 'bag':
        return !!raw?.pockets && Object.values(raw.pockets).some((p) => p.length > 0);
      case 'pc':
        return !!raw?.storage?.boxes.some((b) => b.mons.some(Boolean));
      case 'map':
        return this.location?.x !== null && this.location?.x !== undefined;
    }
  }

  /** Nueva ubicación del jugador (minimapa); null al desconectar. */
  updateLocation(loc: RawLocation | null) {
    const pos = loc ? regionPosition(loc) : null;
    this.location = loc
      ? {
          mapsec: loc.mapsec,
          name: mapSection(loc.mapsec)?.name ?? '',
          x: pos ? Math.round(pos.x * 100) / 100 : null,
          y: pos ? Math.round(pos.y * 100) / 100 : null,
        }
      : null;
    this.deps.broadcast({ type: 'location', location: this.location });
  }

  /** Enseña la mochila o una caja del PC en el overlay del equipo durante unos segundos. */
  showShowcase(showcase: Showcase): boolean {
    if (!this.raw) return false;
    this.hideShowcase(false);
    const ms = this.deps.settings().views.showcaseSec * 1000;
    const timer = this.clock.setTimeout(() => this.hideShowcase(), ms);
    this.showing = { showcase, endsAt: this.clock.now() + ms, timer };
    this.deps.broadcast({ type: 'showcase', showcase, remainingMs: ms });
    return true;
  }

  hideShowcase(notify = true) {
    if (!this.showing) return;
    this.clock.clearTimeout(this.showing.timer);
    this.showing = null;
    if (notify) this.deps.broadcast({ type: 'showcaseHide' });
  }

  private publish() {
    this.deps.broadcast({ type: 'game', data: this.data });
  }

  private loadSpecies() {
    const profile = this.profile;
    if (!this.raw || !profile) return;
    const ids = new Set<number>();
    for (const m of this.raw.party ?? []) if (m.species && !m.isEgg) ids.add(m.species);
    for (const b of this.raw.storage?.boxes ?? []) for (const m of b.mons) if (m?.species && !m.isEgg) ids.add(m.species);
    for (const id of ids) {
      if (this.requested.has(id)) continue;
      this.requested.add(id);
      this.deps.speciesBrief(profile.id, id).then(
        (brief) => {
          if (this.profile?.id !== profile.id) return;
          this.species.set(id, brief);
          this.deps.broadcast({ type: 'species', entries: [brief] });
        },
        () => this.requested.delete(id), // sin red: se reintenta en la próxima actualización
      );
    }
  }
}
