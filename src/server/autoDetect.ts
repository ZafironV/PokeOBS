import type { AutoDetectProfile, AutoEvent, AutoState, AutoStatus, GameProfile, Settings } from '../shared/types.js';
import { BATTLE_MONS_LENGTH, BattleTracker, parseBattleMons, type Detection } from './gen3.js';
import type { RawLocation } from '../shared/hoennMap.js';
import { GameWatcher, type RawGame } from './gameWatch.js';
import { realClock, type Clock } from './live.js';
import { MemoryReadError, NoResponseError, type MemoryReader } from './retroarch.js';

export interface AutoDetectorDeps {
  settings(): Settings;
  profile(gameId: string): GameProfile | undefined;
  createReader(port: number): MemoryReader;
  /** Un rival nuevo: hay que mostrar su ficha. newSpecies: especies que el jugador no había visto. */
  onDetect(detection: Detection, profile: GameProfile, newSpecies: number[]): void;
  /** Cambiaron los datos de la partida (equipo, mochila…); null al desconectar. */
  onGame?(raw: RawGame | null, profile: GameProfile | null): void;
  /** Nueva ubicación del jugador (minimapa). */
  onLocation?(loc: RawLocation | null): void;
  onStatus(status: AutoStatus): void;
  /** Nombres para el registro del panel. */
  speciesNames(gameId: string, species: number[]): Promise<string[]>;
  clock?: Clock;
  /** Consumo del proceso; se puede sustituir en las pruebas. */
  usage?: () => { cpuMicros: number; rssBytes: number };
  /** ¿Está activa la regla temporal del firewall? (solo lectura) */
  firewallActive?: () => Promise<boolean | null>;
}

/** Espera entre reintentos cuando RetroArch no responde o no hay juego. */
export const RETRY_MS = 3000;
/** Cada cuánto se vuelve a preguntar qué juego hay cargado. */
const STATUS_EVERY_MS = 5000;
const USAGE_EVERY_MS = 5000;
/** La regla del firewall se comprueba cada 6 mediciones de consumo (30 s). */
const FIREWALL_EVERY = 6;
const MAX_EVENTS = 30;
/** Cabecera del cartucho de GBA: código de juego de 4 letras. */
const GBA_GAME_CODE = 0x080000ac;

const KIND = { wild: 'salvaje', trainer: 'de entrenador' } as const;

const HELP_NETWORK =
  'RetroArch no responde. Abre RetroArch y activa Ajustes → Red → Comandos de red (puerto 55355). Se reintenta cada 3 s.';

/**
 * Detección automática: lee la RAM del juego en RetroArch cada pocos cientos de
 * milisegundos y avisa cuando aparece un Pokémon rival. No hace nada (ni abre
 * ningún puerto) mientras está desactivada.
 */
export class AutoDetector {
  private clock: Clock;
  private reader: MemoryReader | null = null;
  private timer: unknown = null;
  private usageTimer: unknown = null;
  private run = 0;
  private config = '';
  private tracker = new BattleTracker();
  private game: GameWatcher | null = null;
  private contentStatus: string | null = null;
  private lastStatusCheck = 0;
  private lastUsage = { at: 0, cpu: 0 };
  private usageTicks = 0;
  private current: AutoStatus = {
    state: 'off',
    message: 'Conexión con RetroArch desactivada.',
    retroarchVersion: null,
    gameCode: null,
    lastDetected: null,
    usage: null,
    firewall: null,
    events: [],
  };

  constructor(private deps: AutoDetectorDeps) {
    this.clock = deps.clock ?? realClock;
  }

  get status(): AutoStatus {
    return this.current;
  }

  /** Se llama al arrancar y cada vez que cambian los ajustes. */
  reconfigure() {
    const s = this.deps.settings();
    const config = JSON.stringify([s.auto.enabled, s.auto.port, s.gameId]);
    if (config === this.config) return;
    this.config = config;
    this.stop();
    const profile = this.deps.profile(s.gameId);
    if (!s.auto.enabled) {
      this.setState('off', 'Conexión con RetroArch desactivada.');
      return;
    }
    if (!profile?.autoDetect) {
      this.setState('unsupported', `${profile?.name ?? 'Este juego'} aún no se puede leer desde RetroArch. De momento solo Pokémon Esmeralda.`);
      return;
    }
    this.event('info', `Conexión con RetroArch activada para ${profile.name}.`);
    this.reader = this.deps.createReader(s.auto.port);
    this.lastUsage = { at: this.clock.now(), cpu: this.cpuMicros() };
    this.usageTicks = 0;
    this.scheduleUsage(this.run);
    void this.checkFirewall(this.run);
    void this.connect(this.run, profile, profile.autoDetect);
  }

  /** Pide leer las cajas del PC en la próxima vuelta (≈17 consultas). */
  requestPc(): boolean {
    if (!this.game || (this.current.state !== 'watching' && this.current.state !== 'battle')) return false;
    this.game.requestPc();
    return true;
  }

  stop() {
    this.run++;
    if (this.game) this.deps.onGame?.(null, null);
    this.game = null;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    if (this.usageTimer !== null) this.clock.clearTimeout(this.usageTimer);
    this.timer = this.usageTimer = null;
    this.reader?.close();
    this.reader = null;
    this.tracker = new BattleTracker();
    this.contentStatus = null;
    this.current = { ...this.current, retroarchVersion: null, gameCode: null, usage: null, firewall: null };
  }

  private later(run: number, ms: number, fn: () => void) {
    if (run !== this.run) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (run === this.run) fn();
    }, ms);
  }

  private async connect(run: number, profile: GameProfile, map: AutoDetectProfile) {
    const reader = this.reader!;
    try {
      const version = await reader.version();
      const status = await reader.status();
      if (run !== this.run) return;
      if (this.current.retroarchVersion !== version) this.event('info', `Conectado con RetroArch ${version}.`);
      this.current.retroarchVersion = version;
      this.contentStatus = status;
      this.lastStatusCheck = this.clock.now();
      if (/^CONTENTLESS/.test(status)) {
        this.setState('no-game', 'RetroArch está abierto, pero sin ningún juego cargado.');
        this.later(run, RETRY_MS, () => void this.connect(run, profile, map));
        return;
      }
      let code: string | null = null;
      try {
        code = (await reader.read(GBA_GAME_CODE, 4)).toString('latin1');
      } catch (err) {
        if (!(err instanceof MemoryReadError)) throw err;
        // El núcleo no expone la ROM: se sigue sin comprobarla.
      }
      if (run !== this.run) return;
      this.current.gameCode = code;
      if (code && !map.gameCodes.includes(code)) {
        this.setState(
          'wrong-game',
          `El juego cargado (código ${code}) no es una edición comprobada de ${profile.name} (${map.gameCodes.join(', ')}).`,
        );
        this.later(run, RETRY_MS, () => void this.connect(run, profile, map));
        return;
      }
      this.event('info', code ? `Juego reconocido: ${profile.name} (${code}).` : `No se pudo leer el código del juego; se asume ${profile.name}.`);
      this.setState('watching', 'Conectado. Esperando un combate…');
      this.game = new GameWatcher(
        map,
        (raw) => this.deps.onGame?.(raw, profile),
        (loc) => this.deps.onLocation?.(loc),
      );
      this.later(run, 0, () => void this.poll(run, profile, map));
    } catch (err) {
      if (run !== this.run) return;
      this.handleError(err);
      this.later(run, RETRY_MS, () => void this.connect(run, profile, map));
    }
  }

  private async poll(run: number, profile: GameProfile, map: AutoDetectProfile) {
    const reader = this.reader!;
    try {
      // De vez en cuando se comprueba que sigue cargado el mismo juego.
      if (this.clock.now() - this.lastStatusCheck >= STATUS_EVERY_MS) {
        const status = await reader.status();
        this.lastStatusCheck = this.clock.now();
        if (status !== this.contentStatus) {
          if (run !== this.run) return;
          this.event('info', 'Ha cambiado el juego cargado en RetroArch; se comprueba de nuevo.');
          this.tracker = new BattleTracker();
          return void this.connect(run, profile, map);
        }
      }
      const flag = await reader.read(map.inBattle.address, 1);
      const inBattle = (flag[0] & map.inBattle.mask) !== 0;
      let typeFlags = 0;
      let mons: ReturnType<typeof parseBattleMons> = [];
      if (inBattle) {
        typeFlags = (await reader.read(map.battleTypeFlags, 4)).readUInt32LE(0);
        mons = parseBattleMons(await reader.read(map.battleMons, BATTLE_MONS_LENGTH));
      }
      if (run !== this.run) return;
      for (const ev of this.tracker.update({ inBattle, typeFlags, mons }, this.clock.now())) {
        if (ev.type === 'battle-start') {
          this.event('info', `Empieza un combate ${KIND[ev.kind]}${ev.double ? ' doble' : ''}.`);
          this.setState('battle', `En combate ${KIND[ev.kind]}${ev.double ? ' doble' : ''}.`);
        } else if (ev.type === 'battle-end') {
          this.event('info', 'Fin del combate.');
          this.setState('watching', 'Conectado. Esperando un combate…');
        } else {
          const fresh = this.game?.newSpecies(ev.species) ?? [];
          this.deps.onDetect(ev, profile, fresh);
          void this.logDetection(run, profile, ev, fresh);
        }
      }
      await this.game?.tick(reader, inBattle, this.clock.now(), this.deps.settings().views.pc.visible);
    } catch (err) {
      if (run !== this.run) return;
      this.handleError(err);
      this.tracker = new BattleTracker();
      this.later(run, RETRY_MS, () => void this.connect(run, profile, map));
      return;
    }
    this.later(run, this.deps.settings().auto.intervalMs, () => void this.poll(run, profile, map));
  }

  private async logDetection(run: number, profile: GameProfile, d: Detection, fresh: number[]) {
    let names: string[];
    try {
      names = await this.deps.speciesNames(profile.id, d.species);
    } catch {
      names = d.species.map((n) => `n.º ${n}`);
    }
    if (run !== this.run) return;
    const kind = `${KIND[d.kind]}${d.double ? ' (doble)' : ''}`;
    this.current.lastDetected = { names, kind, at: Date.now() };
    const marked = names.map((n, i) => (fresh.includes(d.species[i]) ? `${n} (¡nuevo!)` : n));
    this.event('detect', `Rival ${kind}: ${marked.join(' y ')}.`);
  }

  private handleError(err: unknown) {
    if (err instanceof NoResponseError) {
      if (this.current.state !== 'connecting') this.event('warn', 'Sin respuesta de RetroArch.');
      this.current.retroarchVersion = null;
      this.setState('connecting', HELP_NETWORK);
    } else if (err instanceof MemoryReadError) {
      if (this.current.state !== 'no-game') this.event('warn', `RetroArch no deja leer la memoria: ${err.message}.`);
      this.setState(
        'no-game',
        'RetroArch responde, pero no deja leer la memoria del juego. Carga Pokémon Esmeralda con el núcleo mGBA.',
      );
    } else {
      this.event('warn', `Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
      this.setState('connecting', 'Error inesperado; se reintenta en 3 s.');
    }
  }

  private cpuMicros() {
    if (this.deps.usage) return this.deps.usage().cpuMicros;
    const u = process.cpuUsage();
    return u.user + u.system;
  }

  private scheduleUsage(run: number) {
    this.usageTimer = this.clock.setTimeout(() => {
      if (run !== this.run) return;
      const now = this.clock.now();
      const cpu = this.cpuMicros();
      const rss = this.deps.usage ? this.deps.usage().rssBytes : process.memoryUsage().rss;
      const elapsed = Math.max(1, now - this.lastUsage.at);
      const stats = this.reader?.takeStats() ?? { queries: 0, latencyMs: 0 };
      this.current.usage = {
        cpuPercent: Math.round(((cpu - this.lastUsage.cpu) / 1000 / elapsed) * 10000) / 100,
        memoryMb: Math.round(rss / 1024 / 1024),
        readsPerSec: Math.round((stats.queries / elapsed) * 10000) / 10,
        latencyMs: stats.queries ? Math.round((stats.latencyMs / stats.queries) * 100) / 100 : 0,
      };
      this.lastUsage = { at: now, cpu };
      this.publish();
      if (++this.usageTicks % FIREWALL_EVERY === 0) void this.checkFirewall(run);
      this.scheduleUsage(run);
    }, USAGE_EVERY_MS);
  }

  private async checkFirewall(run: number) {
    if (!this.deps.firewallActive) return;
    const active = await this.deps.firewallActive().catch(() => null);
    if (run !== this.run || active === this.current.firewall) return;
    this.current.firewall = active;
    if (active === false) {
      this.event('warn', 'Protección de red inactiva: otros equipos de tu red podrían enviar órdenes a RetroArch.');
    } else if (active) {
      this.event('info', 'Protección de red activa: solo este PC puede enviar órdenes a RetroArch.');
    }
  }

  private setState(state: AutoState, message: string) {
    if (this.current.state === state && this.current.message === message) return;
    this.current.state = state;
    this.current.message = message;
    this.publish();
  }

  private event(kind: AutoEvent['kind'], text: string) {
    this.current.events = [{ at: Date.now(), kind, text }, ...this.current.events].slice(0, MAX_EVENTS);
    this.publish();
  }

  private publish() {
    this.deps.onStatus({ ...this.current, events: [...this.current.events] });
  }
}
