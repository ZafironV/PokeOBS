import type { RotationGroup, SlotItem, SlotState } from '../shared/types.js';
import { realClock, type Clock } from './live.js';

export interface SlotDeps {
  groups(): RotationGroup[];
  /** ¿Tiene este elemento algo que enseñar? (sin datos, su turno se salta) */
  available(item: SlotItem): boolean;
  onChange(slots: SlotState): void;
  clock?: Clock;
}

interface Running {
  group: RotationGroup;
  /** Elemento que tiene el turno (sin contar la ficha). */
  current: SlotItem | null;
  timer: unknown;
}

/**
 * Turnos entre elementos del directo. En cada grupo activo, sus elementos
 * aparecen de uno en uno durante `seconds`; los que no tienen nada que enseñar
 * se saltan. Si el grupo incluye la ficha de la Pokédex, al empezar un combate
 * la ficha toma el turno enseguida (los demás se apartan) y, al terminar, los
 * turnos siguen por el siguiente elemento.
 */
export class SlotScheduler {
  private clock: Clock;
  private running = new Map<string, Running>();
  private cardLive = false;
  private signature = '';

  constructor(private deps: SlotDeps) {
    this.clock = deps.clock ?? realClock;
  }

  /** Estado actual para los overlays. */
  get state(): SlotState {
    const out: SlotState = {};
    for (const r of this.running.values()) {
      const cardTurn = this.cardLive && r.group.items.includes('card');
      for (const item of r.group.items) {
        out[item] = {
          group: r.group.id,
          active: item === 'card' ? cardTurn : !cardTurn && item === r.current,
          layout: r.group.mode === 'shared' ? r.group.layout : null,
        };
      }
    }
    return out;
  }

  /** Cambiaron los grupos (ajustes): se conservan los turnos de los grupos que siguen igual. */
  reconfigure() {
    const groups = this.deps.groups().filter((g) => g.enabled && g.items.length > 0);
    for (const [id, r] of this.running) {
      const g = groups.find((x) => x.id === id);
      if (!g || JSON.stringify(g) !== JSON.stringify(r.group)) {
        this.clock.clearTimeout(r.timer);
        this.running.delete(id);
      }
    }
    for (const g of groups) {
      if (!this.running.has(g.id)) this.running.set(g.id, { group: g, current: null, timer: null });
    }
    this.refresh();
  }

  /** La ficha de la Pokédex aparece (combate) o desaparece. */
  setCardLive(live: boolean) {
    if (live === this.cardLive) return;
    this.cardLive = live;
    for (const r of this.running.values()) {
      if (!r.group.items.includes('card')) continue;
      this.clock.clearTimeout(r.timer);
      r.timer = null;
      // Al terminar el combate, los turnos siguen por el siguiente elemento.
      if (!live) r.current = this.next(r);
    }
    this.refresh();
  }

  /** Cambió qué elementos tienen datos: un turno sin nada que enseñar se salta. */
  dataChanged() {
    this.refresh();
  }

  stop() {
    for (const r of this.running.values()) this.clock.clearTimeout(r.timer);
    this.running.clear();
  }

  private candidates(r: Running): SlotItem[] {
    return r.group.items.filter((i) => i !== 'card' && this.deps.available(i));
  }

  private next(r: Running): SlotItem | null {
    const list = this.candidates(r);
    if (!list.length) return null;
    const at = r.current ? r.group.items.indexOf(r.current) : -1;
    // Siguiente en el orden del grupo que esté disponible.
    for (let k = 1; k <= r.group.items.length; k++) {
      const item = r.group.items[(at + k + r.group.items.length) % r.group.items.length];
      if (list.includes(item)) return item;
    }
    return list[0];
  }

  private refresh() {
    for (const r of this.running.values()) {
      const list = this.candidates(r);
      if (!r.current || !list.includes(r.current)) r.current = list[0] ?? null;
      const paused = this.cardLive && r.group.items.includes('card');
      if (paused || list.length < 2) {
        this.clock.clearTimeout(r.timer);
        r.timer = null;
      } else if (r.timer === null) {
        this.schedule(r);
      }
    }
    this.publish();
  }

  private schedule(r: Running) {
    r.timer = this.clock.setTimeout(() => {
      r.timer = null;
      if (this.running.get(r.group.id) !== r) return;
      r.current = this.next(r);
      this.refresh();
    }, r.group.seconds * 1000);
  }

  private publish() {
    const state = this.state;
    const sig = JSON.stringify(state);
    if (sig === this.signature) return;
    this.signature = sig;
    this.deps.onChange(state);
  }
}
