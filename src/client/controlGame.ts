import type {
  ClientMessage,
  GameData,
  GameViews,
  PlayerLocation,
  PocketId,
  Settings,
  SpeciesBrief,
} from '../shared/types.js';
import {
  countBox,
  DEFAULT_PARTY_STYLE,
  placeMarker,
  renderBadges,
  renderBox,
  renderMap,
  renderParty,
  renderPocket,
  type SpeciesMap,
} from './gameView.js';
import { DEFAULT_STYLES } from '../shared/styles.js';

// Sección «Partida» del panel: equipo, medallas, mochila y PC leídos del juego,
// (su diseño en el directo se ajusta en «Diseño del directo», designPanel.ts).

export interface GamePanelDeps {
  send(msg: ClientMessage): boolean;
  settings(): Settings;
  saveViews(views: GameViews): void;
  log(kind: 'error' | 'notice' | 'info', message: string): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initGamePanel(deps: GamePanelDeps) {
  const ui = {
    summary: $('game-summary'),
    hint: $('game-hint'),
    tabs: [...document.querySelectorAll<HTMLButtonElement>('#game-box .tabs button')],
    party: $('tab-party'),
    map: $('tab-map'),
    badges: $('tab-badges'),
    pockets: $('pockets'),
    bagView: $('bag-view'),
    bagShow: $<HTMLButtonElement>('bag-show'),
    pcBox: $<HTMLSelectElement>('pc-box'),
    pcRead: $<HTMLButtonElement>('pc-read'),
    pcStatus: $('pc-status'),
    pcView: $('pc-view'),
    pcShow: $<HTMLButtonElement>('pc-show'),
    showcaseHide: $<HTMLButtonElement>('showcase-hide'),
    testOverlays: $<HTMLButtonElement>('test-overlays'),
    testStatus: $('test-status'),
  };

  const species: SpeciesMap = new Map();
  let data: GameData | null = null;
  let playerLocation: PlayerLocation | null = null;
  let demo = false;
  /** Fin de la prueba de overlays en el directo (0 si no hay ninguna). */
  let testEndsAt = 0;
  let testTicker: number | undefined;
  let tab = 'party';
  // Bolsillo y caja elegidos: se guardan porque son los que enseñan /mochila y /pc fijos.
  const views = () => deps.settings().views;
  const pocket = () => views().pocket;
  const box = () => views().box;
  let pcPending = false;

  /** Los componentes del directo, dentro de un marco con los colores del juego. */
  function framed(content: HTMLElement): HTMLElement {
    const f = document.createElement('div');
    f.className = 'gm-frame';
    if (data?.game) {
      f.style.setProperty('--accent', data.game.accent);
      f.style.setProperty('--accent-dark', data.game.accentDark);
    }
    f.append(content);
    return f;
  }

  function empty(target: HTMLElement, text: string) {
    target.textContent = '';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = text;
    target.append(p);
  }

  function render() {
    const has = !!data?.party;
    ui.hint.hidden = has;
    const parts: string[] = [];
    if (demo) parts.push('PARTIDA DE EJEMPLO');
    if (data?.game) parts.push(data.game.name);
    if (playerLocation?.name) parts.push(`en ${playerLocation.name}`);
    if (data?.pokedex) parts.push(`Pokédex: ${data.pokedex.seen} vistos, ${data.pokedex.owned} capturados`);
    if (data?.money !== null && data?.money !== undefined) parts.push(`${data.money.toLocaleString('es-ES')} ₽`);
    ui.summary.textContent = parts.length ? `· ${parts.join(' · ')}` : '';

    ui.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    for (const id of ['party', 'badges', 'bag', 'pc', 'map']) $(`tab-${id}`).hidden = id !== tab;
    ui.showcaseHide.parentElement!.hidden = tab !== 'bag' && tab !== 'pc';

    if (tab === 'party') {
      if (data?.party) {
        ui.party.textContent = '';
        ui.party.append(framed(renderParty(data, species, { ...DEFAULT_PARTY_STYLE, layout: 'grid' })));
      } else empty(ui.party, 'Sin datos del equipo.');
    } else if (tab === 'map') {
      renderMapTab();
    } else if (tab === 'badges') {
      if (data?.badges) {
        ui.badges.textContent = '';
        ui.badges.append(framed(renderBadges(data, { ...DEFAULT_STYLES.badges, columns: 4 })));
      } else empty(ui.badges, 'Sin datos de medallas.');
    } else if (tab === 'bag') {
      ui.pockets.textContent = '';
      for (const p of data?.bag ?? []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${p.label} (${p.items.length})`;
        b.setAttribute('aria-selected', String(p.id === pocket()));
        b.addEventListener('click', () => {
          deps.saveViews({ ...views(), pocket: p.id });
          render();
        });
        ui.pockets.append(b);
      }
      if (data?.bag) {
        ui.bagView.textContent = '';
        ui.bagView.append(framed(renderPocket(data, pocket())));
      } else empty(ui.bagView, 'Sin datos de la mochila.');
      ui.bagShow.disabled = !data?.bag;
    } else {
      renderPc();
    }
  }

  /** El mapa del panel se construye una vez; al andar solo se mueve el marcador. */
  function renderMapTab() {
    if (!playerLocation) {
      empty(ui.map, 'Sin datos de la ubicación.');
      return;
    }
    const gender = data?.player?.gender ?? 'male';
    let map = ui.map.querySelector<HTMLElement>('.gm-map');
    if (!map || ui.map.dataset.gender !== gender) {
      ui.map.textContent = '';
      ui.map.dataset.gender = gender;
      map = renderMap(gender);
      const label = document.createElement('div');
      label.className = 'gm-map-place';
      ui.map.append(map, label);
      placeMarker(map, playerLocation, false);
    }
    ui.map.querySelector('.gm-map-place')!.textContent = playerLocation.name || 'Fuera de Hoenn';
    placeMarker(map, playerLocation);
  }

  function renderPc() {
    const pc = data?.pc;
    const selected = box();
    ui.pcBox.textContent = '';
    for (let i = 0; i < 14; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = pc ? `${pc.boxes[i].name} (${countBox(data!, i)}/30)` : `Caja ${i + 1}`;
      ui.pcBox.append(o);
    }
    ui.pcBox.value = String(selected);
    ui.pcRead.disabled = pcPending;
    ui.pcRead.textContent = pcPending ? 'Leyendo…' : pc ? 'Volver a leer' : 'Leer el PC';
    ui.pcStatus.textContent = pc
      ? `Leído a las ${new Date(pc.readAt).toLocaleTimeString('es-ES')}. Pulsa «Volver a leer» tras cambiar algo en el PC del juego.`
      : 'El PC no se lee automáticamente (son unos 33 KB): pulsa «Leer el PC».';
    if (pc) {
      ui.pcView.textContent = '';
      ui.pcView.append(framed(renderBox(data!, selected, species)));
    } else ui.pcView.textContent = '';
    ui.pcShow.disabled = !pc;
  }

  ui.tabs.forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab!;
      // Al abrir el PC por primera vez se lee solo.
      if (tab === 'pc' && !data?.pc && data?.party && !pcPending) requestPc();
      render();
    }),
  );
  ui.pcBox.addEventListener('change', () => {
    deps.saveViews({ ...views(), box: Number(ui.pcBox.value) });
    renderPc();
  });
  function requestPc() {
    if (!deps.send({ type: 'refreshPc' })) return;
    pcPending = true;
    // Si no llega respuesta (p. ej. sin conexión con RetroArch), se reactiva el botón.
    setTimeout(() => {
      if (!pcPending) return;
      pcPending = false;
      renderPc();
    }, 8000);
  }
  ui.pcRead.addEventListener('click', () => {
    requestPc();
    renderPc();
  });
  ui.bagShow.addEventListener('click', () => deps.send({ type: 'showcase', showcase: { kind: 'bag', pocket: pocket() } }));
  ui.pcShow.addEventListener('click', () => deps.send({ type: 'showcase', showcase: { kind: 'pc', box: box() } }));
  ui.showcaseHide.addEventListener('click', () => deps.send({ type: 'showcaseHide' }));
  ui.testOverlays.addEventListener('click', () => {
    if (!deps.send({ type: 'testOverlays', enabled: testEndsAt === 0 })) deps.log('error', 'No hay conexión con el servidor.');
  });
  const TEST_HINT = ui.testStatus.textContent;
  function renderTest() {
    const left = Math.max(0, Math.ceil((testEndsAt - Date.now()) / 1000));
    if (testEndsAt && left === 0) testEndsAt = 0;
    ui.testOverlays.textContent = testEndsAt ? `Detener la prueba (${left} s)` : 'Probar overlays en directo';
    ui.testOverlays.classList.toggle('primary', !testEndsAt);
    ui.testOverlays.classList.toggle('danger', !!testEndsAt);
    ui.testStatus.textContent = testEndsAt ? 'En el directo se está viendo la partida de ejemplo.' : TEST_HINT;
    if (!testEndsAt) clearInterval(testTicker);
  }
  return {
    applySettings() {
      render();
    },
    onGame(next: GameData) {
      if (next.pc && next.pc.readAt !== data?.pc?.readAt) pcPending = false;
      data = next.party || next.bag || next.pc ? next : null;
      render();
    },
    onLocation(loc: PlayerLocation | null) {
      const changedPlace = loc?.name !== playerLocation?.name;
      playerLocation = loc;
      if (tab === 'map') renderMapTab();
      if (changedPlace) render();
    },
    onTest(remainingMs: number) {
      testEndsAt = remainingMs > 0 ? Date.now() + remainingMs : 0;
      clearInterval(testTicker);
      if (testEndsAt) testTicker = window.setInterval(renderTest, 250);
      renderTest();
    },
    onDemo(enabled: boolean) {
      demo = enabled;
      render();
    },
    onSpecies(entries: SpeciesBrief[]) {
      for (const s of entries) species.set(s.id, s);
      if (tab === 'party' || tab === 'pc') render();
    },
    /** Resumen para «Copiar diagnóstico». */
    summary(): string {
      if (!data) return 'sin datos';
      const bag = data.bag?.reduce((n, p) => n + p.items.length, 0);
      return (
        `equipo ${data.party?.length ?? '?'} · medallas ${data.badges?.filter((b) => b.owned).length ?? '?'}/8 · ` +
        `mochila ${bag ?? '?'} objetos · Pokédex ${data.pokedex ? `${data.pokedex.seen}/${data.pokedex.owned}` : '?'} · ` +
        `PC ${data.pc ? 'leído' : 'sin leer'}`
      );
    },
  };
}
