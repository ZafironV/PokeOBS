import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/server/app.js';
import { SpriteCache } from '../src/server/pokeapi.js';
import { DEFAULT_SETTINGS, mergeSettings, SettingsStore } from '../src/server/settings.js';
import { SlotScheduler } from '../src/server/slots.js';
import { colorVars, resolveColors, THEMES } from '../src/shared/themes.js';
import type { RotationGroup, ServerMessage, SlotItem, SlotState } from '../src/shared/types.js';
import { FakeClock, makeService } from './helpers.js';

const group = (over: Partial<RotationGroup> = {}): RotationGroup => ({
  id: 'g1',
  name: 'Grupo 1',
  enabled: true,
  mode: 'alternate',
  items: ['party', 'map'],
  seconds: 10,
  layout: { scale: 1, anchor: 'bottom-right', offsetX: 48, offsetY: 48 },
  ...over,
});

function scheduler(groups: RotationGroup[], available: Partial<Record<SlotItem, boolean>> = {}) {
  const clock = new FakeClock();
  const states: SlotState[] = [];
  const avail = { card: true, party: true, badges: true, bag: true, pc: true, map: true, ...available };
  let current = groups;
  const s = new SlotScheduler({
    groups: () => current,
    available: (i) => avail[i],
    onChange: (st) => states.push(st),
    clock,
  });
  s.reconfigure();
  const active = () => (Object.keys(s.state) as SlotItem[]).filter((i) => s.state[i]?.active);
  return { s, clock, states, avail, active, setGroups: (g: RotationGroup[]) => ((current = g), s.reconfigure()) };
}

describe('Turnos entre elementos', () => {
  it('cada elemento tiene su turno, en orden y durante los segundos del grupo', () => {
    const t = scheduler([group({ items: ['party', 'bag', 'map'] })]);
    expect(t.active()).toEqual(['party']);
    t.clock.advance(10000);
    expect(t.active()).toEqual(['bag']);
    t.clock.advance(10000);
    expect(t.active()).toEqual(['map']);
    t.clock.advance(10000);
    expect(t.active()).toEqual(['party']);
  });

  it('se salta los elementos sin nada que enseñar; con uno solo, se queda fijo', () => {
    const t = scheduler([group({ items: ['party', 'pc', 'map'] })], { pc: false });
    t.clock.advance(10000);
    expect(t.active()).toEqual(['map']);
    t.clock.advance(10000);
    expect(t.active()).toEqual(['party']);
    t.avail.map = false;
    t.s.dataChanged();
    t.clock.advance(60000);
    expect(t.active()).toEqual(['party']);
    expect(t.clock.pending).toBe(0); // sin temporizador: no hay a quién turnar
  });

  it('si el elemento con turno se queda sin datos, pasa al siguiente', () => {
    const t = scheduler([group({ items: ['pc', 'map'] })]);
    expect(t.active()).toEqual(['pc']);
    t.avail.pc = false;
    t.s.dataChanged();
    expect(t.active()).toEqual(['map']);
  });

  it('la ficha tiene prioridad: al empezar un combate los demás se apartan y luego siguen por el siguiente', () => {
    const t = scheduler([group({ items: ['card', 'pc', 'map'] })]);
    expect(t.active()).toEqual(['pc']);
    t.clock.advance(4000);
    t.s.setCardLive(true);
    expect(t.active()).toEqual(['card']);
    t.clock.advance(60000); // en combate no se turna
    expect(t.active()).toEqual(['card']);
    t.s.setCardLive(false);
    expect(t.active()).toEqual(['map']);
    t.clock.advance(10000);
    expect(t.active()).toEqual(['pc']);
  });

  it('la ficha fuera de su grupo no aparta a nadie', () => {
    const t = scheduler([group({ items: ['party', 'map'] })]);
    t.s.setCardLive(true);
    expect(t.active()).toEqual(['party']);
  });

  it('modo «mismo lugar»: todos usan la posición del grupo; «alternar»: la suya', () => {
    const layout = { scale: 1.5, anchor: 'top-left' as const, offsetX: 10, offsetY: 20 };
    const t = scheduler([group({ mode: 'shared', layout }), group({ id: 'g2', items: ['bag'], mode: 'alternate' })]);
    expect(t.s.state.party?.layout).toEqual(layout);
    expect(t.s.state.map?.layout).toEqual(layout);
    expect(t.s.state.bag).toEqual({ group: 'g2', active: true, layout: null });
    expect(t.s.state.badges).toBeUndefined(); // fuera de grupos: sigue «visible siempre»
  });

  it('los grupos desactivados no cuentan; al cambiar un grupo se reinicia solo ese', () => {
    const t = scheduler([group(), group({ id: 'g2', items: ['bag', 'pc'], enabled: false })]);
    expect(t.s.state.bag).toBeUndefined();
    t.clock.advance(10000);
    expect(t.active()).toEqual(['map']);
    t.setGroups([group(), group({ id: 'g2', items: ['bag', 'pc'] })]);
    expect(t.active().sort()).toEqual(['bag', 'map']); // g1 conserva su turno
  });

  it('solo avisa cuando cambia algo', () => {
    const t = scheduler([group()]);
    const n = t.states.length;
    t.s.dataChanged();
    t.s.dataChanged();
    expect(t.states.length).toBe(n);
  });
});

describe('Ajustes de diseño', () => {
  const merge = (patch: object) => mergeSettings(DEFAULT_SETTINGS, patch, ['red', 'emerald']);

  it('estilos: valores fuera de rango o desconocidos se ignoran', () => {
    const s = merge({
      views: {
        ...DEFAULT_SETTINGS.views,
        styles: {
          ...DEFAULT_SETTINGS.views.styles,
          bag: { ...DEFAULT_SETTINGS.views.styles.bag, listPosition: 'top', columns: 3, rows: 99, bagSize: 0 },
          party: { ...DEFAULT_SETTINGS.views.styles.party, spriteSide: 'arriba', spriteScale: 1.7 },
          badges: { ...DEFAULT_SETTINGS.views.styles.badges, columns: 3 },
        },
      },
    });
    expect(s.views.styles.bag).toMatchObject({ listPosition: 'top', columns: 3, rows: 15, bagSize: 1 });
    expect(s.views.styles.party.spriteSide).toBe('right');
    expect(s.views.styles.party.spriteScale).toBe(1.5); // pasos de 0,5
    expect(s.views.styles.badges.columns).toBe(8);
  });

  it('textos: se pueden quitar y alinear; alineaciones desconocidas se ignoran', () => {
    const st = DEFAULT_SETTINGS.views.styles;
    const s = merge({
      views: {
        ...DEFAULT_SETTINGS.views,
        styles: {
          ...st,
          card: { ...st.card, showTypes: false, showFooter: false, descAlign: 'justify' },
          party: { ...st.party, showHpText: false, showStatus: false, textAlign: 'center' },
          bag: { ...st.bag, showQuantity: false, titleAlign: 'right' },
          pc: { ...st.pc, nameAlign: 'arriba' },
          map: { ...st.map, labelAlign: 'left' },
          badges: { ...st.badges, showTitle: false },
        },
      },
    });
    expect(s.views.styles.card).toMatchObject({ showTypes: false, showFooter: false, showNumber: true, descAlign: 'justify' });
    expect(s.views.styles.party).toMatchObject({ showHpText: false, showStatus: false, showLevel: true, textAlign: 'center' });
    expect(s.views.styles.bag).toMatchObject({ showQuantity: false, showNames: true, titleAlign: 'right' });
    expect(s.views.styles.pc.nameAlign).toBe('center');
    expect(s.views.styles.map.labelAlign).toBe('left');
    expect(s.views.styles.badges.showTitle).toBe(false);
    // Unos ajustes antiguos sin textos se completan con los de siempre.
    const old = merge({ views: { ...DEFAULT_SETTINGS.views, styles: { party: { layout: 'grid' } } } });
    expect(old.views.styles.card).toEqual(st.card);
    expect(old.views.styles.party).toMatchObject({ layout: 'grid', showNickname: true, textAlign: 'left' });
  });

  it('colores: tema conocido y colores #rrggbb', () => {
    const s = merge({
      views: {
        ...DEFAULT_SETTINGS.views,
        colors: {
          ...DEFAULT_SETTINGS.views.colors,
          bag: { theme: 'custom', custom: { ...THEMES.rubi, frame: '#123456', text: 'rojo' } },
          map: { theme: 'inventado', custom: THEMES.rubi },
        },
      },
    });
    expect(s.views.colors.bag.theme).toBe('custom');
    expect(s.views.colors.bag.custom.frame).toBe('#123456');
    expect(s.views.colors.bag.custom.text).toBe(DEFAULT_SETTINGS.views.colors.bag.custom.text);
    expect(s.views.colors.map.theme).toBe('game');
  });

  it('grupos: cada elemento en un solo grupo, ids válidos y como mucho 6', () => {
    const s = merge({
      groups: [
        { id: 'a', name: 'Uno', items: ['pc', 'map', 'nada'], mode: 'shared', seconds: 1 },
        { id: 'a', name: '', items: ['map', 'bag'], mode: 'raro' },
        ...Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, items: [] })),
      ],
    });
    expect(s.groups).toHaveLength(6);
    expect(s.groups[0]).toMatchObject({ id: 'a', items: ['pc', 'map'], mode: 'shared', seconds: 3 });
    expect(s.groups[1].id).not.toBe('a');
    expect(s.groups[1]).toMatchObject({ name: 'Grupo 2', items: ['bag'], mode: 'alternate' });
  });
});

describe('Temas de color', () => {
  it('«colores del juego» usa el color del juego; los temas, los suyos; personalizado, los propios', () => {
    expect(resolveColors({ theme: 'game', custom: THEMES.rubi }, { accent: '#ff0000', accentDark: '#880000' }).frame).toBe('#ff0000');
    expect(resolveColors({ theme: 'zafiro', custom: THEMES.rubi }, null)).toEqual(THEMES.zafiro);
    expect(resolveColors({ theme: 'custom', custom: THEMES.claro }, null)).toEqual(THEMES.claro);
    expect(colorVars(THEMES.oscuro)['--screen']).toBe(THEMES.oscuro.panel);
  });
});

describe('Integración: turnos en el directo', () => {
  it('los overlays reciben su turno, y la ficha de combate aparta a los demás de su grupo', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeobs-slots-'));
    const { service } = makeService();
    const app = createApp({
      service,
      sprites: new SpriteCache(dataDir, 'https://raw.githubusercontent.com/PokeAPI/sprites/', 'test'),
      settings: new SettingsStore(dataDir, ['red', 'emerald']),
      publicDir: path.join(dataDir, 'public'),
      localOnly: true,
      readyTimeoutMs: 200,
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
    const open = async (role: string) => {
      const ws = new WebSocket(base);
      const inbox: ServerMessage[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'hello', role }));
      return { ws, inbox };
    };
    const wait = async (pred: () => boolean) => {
      for (let i = 0; i < 300 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
      return pred();
    };
    const lastSlots = (c: { inbox: ServerMessage[] }) =>
      [...c.inbox].reverse().find((m): m is Extract<ServerMessage, { type: 'slots' }> => m.type === 'slots')?.slots;
    try {
      const control = await open('control');
      const team = await open('team');
      const overlay = await open('overlay');
      // Partida de ejemplo para que haya datos; grupo de lugar compartido con ficha, PC y mapa.
      control.ws.send(JSON.stringify({ type: 'demo', enabled: true }));
      control.ws.send(
        JSON.stringify({
          type: 'settings',
          patch: { groups: [{ id: 'g1', name: 'Esquina', mode: 'shared', items: ['card', 'pc', 'map'], seconds: 30 }] },
        }),
      );
      expect(await wait(() => lastSlots(team)?.pc?.active === true)).toBe(true);
      expect(lastSlots(team)?.map).toMatchObject({ active: false, layout: { anchor: 'bottom-right' } });
      expect(lastSlots(overlay)?.card?.layout?.anchor).toBe('bottom-right');

      // Combate de prueba (Pikachu, que está en los datos de prueba): la ficha toma el turno.
      const random = vi.spyOn(Math, 'random').mockReturnValue(24.5 / 151);
      control.ws.send(JSON.stringify({ type: 'testBattle', double: false }));
      expect(await wait(() => lastSlots(team)?.card?.active === true)).toBe(true);
      random.mockRestore();
      expect(lastSlots(team)?.pc?.active).toBe(false);
      control.ws.send(JSON.stringify({ type: 'hide' }));
      expect(await wait(() => lastSlots(team)?.card?.active === false)).toBe(true);
      expect(lastSlots(team)?.map?.active).toBe(true); // sigue por el siguiente
      for (const c of [control, team, overlay]) c.ws.close();
    } finally {
      app.server.close();
      app.auto.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 15000);
});
