// Comprobación visual automática del overlay y del panel en un navegador real
// (Microsoft Edge o Google Chrome instalados, en modo headless).
//
// - Arranca el servidor compilado en un puerto de pruebas.
// - Muestra varias fichas y verifica: fondo transparente fuera de la ficha,
//   ficha dentro del lienzo 1920 × 1080, sin desbordamientos internos y que al
//   ocultar no queda ningún píxel visible.
// - Comprueba que un overlay recargado recupera la ficha con el tiempo restante.
// - Guarda capturas en data/visual-check/.
//
// Requiere conexión a Internet la primera vez (o la caché de data/cache).
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data', 'visual-check');
const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  OK ' : ' FAIL'}  ${name}${info ? ` — ${info}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Abre una pestaña del panel (Directo, Diseño, Turnos, Partida, OBS o Registro). */
const tab = (page, name) => page.click(`.nav button[data-page="${name}"]`);

// --- servidor ---
const server = spawn(process.execPath, [path.join(root, 'dist', 'server.js')], {
  env: { ...process.env, POKEOBS_PORT: String(PORT), POKEOBS_DATA: path.join(root, 'data') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('PokeOBS en marcha') && resolve());
  server.on('exit', (c) => reject(new Error(`El servidor terminó (${c})`)));
});

const games = Object.fromEntries((await (await fetch(`${BASE}/api/games`)).json()).map((g) => [g.id, g.name]));

// --- navegador ---
let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    console.log(`Navegador: ${channel}`);
    break;
  } catch {
    /* probar el siguiente */
  }
}
if (!browser) throw new Error('No se encontró Microsoft Edge ni Google Chrome.');

// --- control por WebSocket (como haría el panel) ---
const control = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const inbox = [];
control.on('message', (d) => inbox.push(JSON.parse(String(d))));
await new Promise((r) => control.once('open', r));
control.send(JSON.stringify({ type: 'hello', role: 'control' }));
const send = (m) => control.send(JSON.stringify(m));
const setLayout = (overlay) => send({ type: 'settings', patch: { overlay } });

const overlayPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await overlayPage.goto(`${BASE}/overlay`);
await sleep(500);

async function analyze(name, scale = 1) {
  const buf = await overlayPage.screenshot({ omitBackground: true, path: path.join(outDir, `${name}.png`) });
  const png = PNG.sync.read(buf);
  const rect = await overlayPage.evaluate(() => {
    const el = document.querySelector('.dex-slot.visible');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  let outside = 0;
  let inside = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const a = png.data[(y * png.width + x) * 4 + 3];
      if (!a) continue;
      // margen para la sombra difusa de la tarjeta (box-shadow 0 4px 12px)
      const inRect =
        rect &&
        x >= rect.left - 16 * scale &&
        x <= rect.right + 16 * scale &&
        y >= rect.top - 12 * scale &&
        y <= rect.bottom + 20 * scale;
      if (inRect) inside++;
      else outside++;
    }
  }
  return { rect, outside, inside, png };
}

async function internalOverflow() {
  return overlayPage.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.dex-slot.visible .dex-card, .dex-slot.visible .dex-family, .dex-slot.visible .dex-info, .dex-slot.visible .dex-head')) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(el.className);
    }
    return bad;
  });
}

async function showAndCheck(name, expected, request) {
  send({ type: 'show', request: { durationSec: 30, ...request } });
  await overlayPage.waitForFunction(
    ([n, game]) => {
      const v = document.querySelectorAll('.dex-slot.visible:not(.leaving)');
      return (
        v.length === 1 &&
        v[0].querySelector('.dex-name').textContent === n &&
        v[0].querySelector('.dex-foot').textContent.startsWith(game) &&
        !document.querySelector('.leaving')
      );
    },
    [expected, games[request.gameId]],
    { timeout: 20000 },
  );
  await sleep(700); // fin de la transición
  const title = await overlayPage.textContent('.dex-slot.visible .dex-name');
  const { rect, outside, inside } = await analyze(name);
  const w = rect ? Math.round(rect.right - rect.left) : 0;
  const h = rect ? Math.round(rect.bottom - rect.top) : 0;
  check(`${name}: ficha visible (${title})`, inside > 1000, `${w}×${h}px`);
  check(`${name}: fondo transparente fuera de la ficha`, outside === 0, `${outside} píxeles opacos fuera`);
  check(
    `${name}: dentro del lienzo 1920×1080`,
    rect && rect.left >= 0 && rect.top >= 0 && rect.right <= 1920 && rect.bottom <= 1080,
  );
  const ov = await internalOverflow();
  check(`${name}: sin desbordamientos internos`, ov.length === 0, ov.join(', '));
  return rect;
}

try {
  setLayout({ scale: 1, anchor: 'top-right', offsetX: 48, offsetY: 48 });
  await sleep(200);
  check('overlay vacío al cargar es totalmente transparente', (await analyze('00-vacio')).outside === 0);

  await showAndCheck('01-rojo-pikachu', 'Pikachu', { gameId: 'red', catalogMode: 'regional', spriteMode: 'game', speciesId: 25 });
  const desc = await overlayPage.textContent('.dex-slot.visible .dex-desc');
  check('descripción de Rojo en español (texto oficial vía WikiDex)', /^Cuando varios de estos Pokémon se juntan/.test(desc), desc);
  await showAndCheck('02-rojo-eevee', 'Eevee', { gameId: 'red', catalogMode: 'regional', spriteMode: 'game', speciesId: 133 });
  await showAndCheck('03-esmeralda-eevee-nacional', 'Eevee', {
    gameId: 'emerald',
    catalogMode: 'national',
    spriteMode: 'animated',
    speciesId: 133,
  });
  await showAndCheck('04-esmeralda-wurmple', 'Wurmple', { gameId: 'emerald', catalogMode: 'regional', spriteMode: 'animated', speciesId: 265 });
  await showAndCheck('05-esmeralda-gloom', 'Gloom', { gameId: 'emerald', catalogMode: 'national', spriteMode: 'game', speciesId: 44 });
  await showAndCheck('06-rojo-mewtwo-animado', 'Mewtwo', { gameId: 'red', catalogMode: 'regional', spriteMode: 'animated', speciesId: 150 });
  await showAndCheck('07-esmeralda-poliwag', 'Poliwag', { gameId: 'emerald', catalogMode: 'national', spriteMode: 'game', speciesId: 60 });

  // Remakes y Gen. II
  await showAndCheck('12-rubi-omega-eevee-8-ramas', 'Eevee', { gameId: 'omega-ruby', catalogMode: 'national', spriteMode: 'game', speciesId: 133 });
  await showAndCheck('13-heartgold-eevee-animado', 'Eevee', { gameId: 'heartgold', catalogMode: 'regional', spriteMode: 'animated', speciesId: 133 });
  await showAndCheck('14-letsgo-pikachu', 'Pikachu', { gameId: 'lets-go-pikachu', catalogMode: 'regional', spriteMode: 'game', speciesId: 25 });
  await showAndCheck('15-cristal-pikachu-animado', 'Pikachu', { gameId: 'crystal', catalogMode: 'regional', spriteMode: 'animated', speciesId: 25 });
  await showAndCheck('16-rojo-fuego-gloom', 'Gloom', { gameId: 'firered', catalogMode: 'regional', spriteMode: 'game', speciesId: 44 });

  // Generación IV y V
  await showAndCheck('17-diamante-eevee', 'Eevee', { gameId: 'diamond', catalogMode: 'national', spriteMode: 'game', speciesId: 133 });
  await showAndCheck('18-platino-turtwig-animado', 'Turtwig', { gameId: 'platinum', catalogMode: 'regional', spriteMode: 'animated', speciesId: 387 });
  await showAndCheck('19-negro-victini-animado', 'Victini', { gameId: 'black', catalogMode: 'regional', spriteMode: 'animated', speciesId: 494 });
  const num = await overlayPage.textContent('.dex-slot.visible .dex-num');
  check('Victini muestra el número regional 000 de Teselia', /000/.test(num), num);
  await showAndCheck('20-blanco2-mime-jr', 'Mime Jr.', { gameId: 'white-2', catalogMode: 'national', spriteMode: 'game', speciesId: 439 });
  const lang = await overlayPage.$$eval('.dex-slot.visible .dex-lang', (els) => els.map((e) => e.textContent));
  check('Blanco 2: descripción en español sin etiqueta de inglés', !lang.some((t) => /inglés/.test(t)), lang.join(' | '));

  // Escala y posición
  setLayout({ scale: 1.5, anchor: 'bottom-left', offsetX: 40, offsetY: 40 });
  await sleep(300);
  const r = await analyze('08-escala-150-abajo-izq', 1.5);
  check(
    'escala 150 % abajo a la izquierda: posición y tamaño',
    r.rect && Math.round(r.rect.left) === 40 && Math.round(1080 - r.rect.bottom) === 40 && r.rect.right - r.rect.left === 900,
    r.rect ? `left=${r.rect.left} bottom=${1080 - r.rect.bottom} ancho=${r.rect.right - r.rect.left}` : '',
  );
  check('escala 150 %: transparente fuera de la ficha', r.outside === 0);
  setLayout({ scale: 1, anchor: 'top-right', offsetX: 48, offsetY: 48 });
  await sleep(300);

  // Combate doble: dos tarjetas apiladas que se intercambian
  send({ type: 'settings', patch: { doubleSwapSec: 2 } });
  await showAndCheck('21-doble-zigzagoon-poochyena', 'Zigzagoon', {
    gameId: 'emerald',
    catalogMode: 'regional',
    spriteMode: 'game',
    speciesId: 263,
    partnerSpeciesId: 261,
  });
  // El análisis de píxeles tarda más de un segundo: se mide desde aquí el siguiente intercambio.
  const frontName = () =>
    overlayPage.$eval('.dex-slot.visible .dex-stack.double > .dex-card.front .dex-name', (e) => e.textContent);
  const cardCount = await overlayPage.$$eval('.dex-slot.visible .dex-stack.double > .dex-card', (c) => c.length);
  const front1 = await frontName();
  check('doble: dos tarjetas apiladas, una delante', cardCount === 2 && ['Zigzagoon', 'Poochyena'].includes(front1), front1);
  const tSwap = Date.now();
  await overlayPage.waitForFunction(
    (prev) => document.querySelector('.dex-stack.double > .dex-card.front .dex-name')?.textContent !== prev,
    front1,
    { timeout: 3000, polling: 50 },
  );
  const front2 = await frontName();
  check('doble: se intercambian en ≤ 2 s', front2 !== front1, `${front1} → ${front2} en ${((Date.now() - tSwap) / 1000).toFixed(1)} s`);
  await sleep(900); // fin de la animación
  const swapped = await analyze('22-doble-intercambiado');
  check('doble: tras el intercambio sigue transparente fuera de la ficha', swapped.outside === 0, `${swapped.outside} píxeles opacos fuera`);
  send({ type: 'settings', patch: { doubleSwapSec: 4 } });

  // Ocultar: no debe quedar nada
  send({ type: 'hide' });
  await sleep(800);
  const hidden = await analyze('09-oculto');
  const nodes = await overlayPage.evaluate(() => document.getElementById('stage').children.length);
  check('tras ocultar no queda ningún píxel visible', hidden.inside + hidden.outside === 0);
  check('tras ocultar no queda ningún elemento en el DOM', nodes === 0, `${nodes} elementos`);

  // Reconexión: recargar el overlay a mitad de exposición
  send({
    type: 'show',
    request: { gameId: 'red', catalogMode: 'regional', spriteMode: 'game', speciesId: 1, durationSec: 6 },
  });
  await overlayPage.waitForSelector('.dex-slot.visible', { timeout: 20000 });
  const t0 = Date.now();
  await sleep(2500);
  await overlayPage.reload();
  await overlayPage.waitForSelector('.dex-slot.visible', { timeout: 5000 });
  check('al reconectar se recupera la ficha vigente', true);
  await overlayPage.waitForSelector('.dex-slot', { state: 'detached', timeout: 10000 });
  const total = (Date.now() - t0) / 1000;
  check('tras reconectar respeta el tiempo restante (no reinicia)', total > 5 && total < 7.5, `oculta a los ${total.toFixed(1)} s de 6 s`);
  await overlayPage.reload();
  await sleep(1000);
  const after = await overlayPage.evaluate(() => document.getElementById('stage').children.length);
  check('una ficha caducada no reaparece al reconectar', after === 0);

  // Ocultar durante la carga (Pokémon no cacheado o caché caliente: se oculta enseguida)
  send({
    type: 'show',
    request: { gameId: 'emerald', catalogMode: 'national', spriteMode: 'game', speciesId: 386, durationSec: 10 },
  });
  send({ type: 'hide' });
  await sleep(2500);
  const ghost = await overlayPage.evaluate(() => document.getElementById('stage').children.length);
  check('Ocultar durante la carga impide que la ficha aparezca', ghost === 0);

  // Panel de control: flujo real con los botones
  {
    setLayout({ scale: 1, anchor: 'top-right', offsetX: 48, offsetY: 48 });
    send({ type: 'settings', patch: { gameId: 'red', catalogMode: 'regional', spriteMode: 'game', durationSec: 8 } });
    await sleep(300);
    const page = await browser.newPage({ viewport: { width: 400, height: 1400 } });
    await page.goto(`${BASE}/control`);
    await tab(page, 'directo');
    await page.waitForSelector('#results button');
    await page.fill('#search', '1');
    await sleep(300);
    const first = await page.textContent('#results button');
    check('panel: buscar "1" en Kanto da Bulbasaur primero', /Bulbasaur/.test(first), first.trim());
    await page.locator('#results button').first().click();
    await page.waitForSelector('#preview .dex-card');
    await page.waitForFunction(() => !document.getElementById('btn-show').disabled);
    // Pestaña al frente: en segundo plano Chromium agrupa los temporizadores a 1 s.
    await page.bringToFront();
    await page.click('#btn-show');
    await overlayPage.waitForFunction(() => document.querySelector('.dex-slot.visible .dex-name')?.textContent === 'Bulbasaur', null, { timeout: 15000 });
    await page.waitForFunction(() => /En directo: Bulbasaur · quedan \d+ s/.test(document.getElementById('live-text').textContent));
    const t1 = await page.textContent('#live-text');
    // Segundos redondeados hacia arriba: en 3,1 s el contador baja entre 2 y 4 unidades.
    await sleep(3100);
    const t2 = await page.textContent('#live-text');
    const n1 = Number(/quedan (\d+)/.exec(t1)[1]);
    const n2 = Number(/quedan (\d+)/.exec(t2)?.[1]);
    check('panel: indicador de tiempo restante desciende', n1 >= 7 && n2 <= n1 - 2 && n2 >= n1 - 4, `${t1} → ${t2}`);
    const pill = await page.textContent('#pill-overlay');
    check('panel: muestra el overlay conectado', /1 conectado/.test(pill), pill);
    await page.click('#btn-hide');
    await overlayPage.waitForSelector('.dex-slot', { state: 'detached', timeout: 3000 });
    check('panel: "Ocultar ahora" retira la ficha del overlay', true);
    await page.waitForFunction(() => document.getElementById('live-text').textContent === 'Oculto');

    // Cambio de juego: Bulbasaur no está en Hoenn → la selección se limpia
    await page.selectOption('#game', 'emerald');
    await page.waitForFunction(() => /Hoenn/.test(document.getElementById('catalog-status').textContent));
    await sleep(300);
    const cleared = await page.evaluate(() => ({
      placeholder: !!document.querySelector('#preview .placeholder'),
      disabled: document.getElementById('btn-show').disabled,
      log: document.getElementById('log').textContent,
    }));
    check(
      'panel: al cambiar a Esmeralda se limpia la selección incompatible',
      cleared.placeholder && cleared.disabled && /Bulbasaur no está/.test(cleared.log),
    );
    // Pikachu sí está en ambos: se mantiene al volver a cambiar
    await page.fill('#search', 'pikachu');
    await sleep(300);
    await page.locator('#results button').first().click();
    await page.waitForSelector('#preview .dex-card');
    const regional = await page.textContent('#preview .dex-num');
    check('panel: Pikachu en Hoenn muestra su número regional 156', /156/.test(regional), regional);
    await page.selectOption('#game', 'lets-go-eevee');
    await page.waitForFunction(() => /Let's Go/.test(document.getElementById('catalog-status').textContent));
    const lgpe = await page.evaluate(() => ({
      disabled: document.querySelector('input[name="catalog"][value="national"]').disabled,
      regional: document.querySelector('input[name="catalog"][value="regional"]').checked,
    }));
    check("panel: en Let's Go la Pokédex Nacional está desactivada", lgpe.disabled && lgpe.regional);
    await page.selectOption('#game', 'emerald');
    await page.waitForFunction(() => /Hoenn/.test(document.getElementById('catalog-status').textContent));
    await sleep(500);
    await page.click('input[name="sprite"][value="animated"]');
    await page.waitForFunction(() => /animad|Animación/.test(document.getElementById('sprite-notes').textContent));
    await page.reload();
    await page.waitForSelector('#preview .dex-card', { timeout: 15000 });
    const remembered = await page.evaluate(() => ({
      game: document.getElementById('game').value,
      sprite: document.querySelector('input[name="sprite"]:checked').value,
      name: document.getElementById('preview-name').textContent,
      duration: document.getElementById('duration').value,
    }));
    check(
      'panel: recuerda juego, sprites, selección y duración al recargar',
      remembered.game === 'emerald' && remembered.sprite === 'animated' && /Pikachu/.test(remembered.name) && remembered.duration === '8',
      JSON.stringify(remembered),
    );
    // Detección automática: interruptor y estado (con o sin RetroArch abierto en este equipo)
    await page.waitForFunction(() => !document.getElementById('auto-enabled').disabled);
    await tab(page, 'partida');
    await page.check('#auto-enabled');
    await page.waitForFunction(() => !/apagado/.test(document.getElementById('pill-auto').textContent), null, { timeout: 5000 });
    const autoUi = await page.evaluate(() => ({
      pill: document.getElementById('pill-auto').textContent,
      state: document.getElementById('auto-state').textContent,
      events: document.getElementById('auto-events').textContent,
    }));
    check('panel: al activar la conexión muestra su estado', /Conexión con RetroArch activada para Pokémon Esmeralda/.test(autoUi.events), `${autoUi.pill} · ${autoUi.state}`);
    await page.uncheck('#auto-enabled');
    await page.waitForFunction(() => /apagado/.test(document.getElementById('pill-auto').textContent));
    await tab(page, 'directo');
    await page.selectOption('#game', 'red');
    await page.waitForFunction(() => document.getElementById('auto-enabled').disabled);
    check('panel: en un juego sin detección el interruptor está desactivado', true);

    send({ type: 'settings', patch: { gameId: 'red', spriteMode: 'game', durationSec: 15, selectedSpeciesId: 133 } });
    await page.close();
  }

  // Partida leída de RetroArch (simulado): equipo, medallas, mochila, PC y «¡Nuevo!»
  {
    // Memoria simulada de Esmeralda (tests/gen3fake.ts), empaquetada al vuelo.
    const fakeFile = path.join(outDir, 'gen3fake.mjs');
    await esbuild.build({
      entryPoints: [path.join(root, 'tests', 'gen3fake.ts')],
      outfile: fakeFile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const { FakeMemory } = await import(pathToFileURL(fakeFile).href);
    const mem = new FakeMemory();
    mem.load({
      player: { name: 'ALEX', gender: 'male' },
      location: { mapsec: 19, mapType: 3, x: 15, y: 60, width: 30, height: 80 }, // Ruta 104
      party: [
        { species: 260, nickname: 'SWAMPERT', level: 38, hp: 121, maxHp: 131, personality: 11 },
        { species: 262, nickname: 'Colmillos', level: 33, hp: 40, maxHp: 98, personality: 12, ball: 3 },
        { species: 282, nickname: 'GARDEVOIR', level: 31, hp: 85, maxHp: 85, personality: 0, otId: 0, ball: 2 },
        { species: 286, nickname: 'BRELOOM', level: 30, hp: 14, maxHp: 80, status: 0x08, personality: 13, ball: 8 },
        { species: 279, nickname: 'PELIPPER', level: 29, hp: 0, maxHp: 79, personality: 14, ball: 6 },
        { species: 1, isEgg: true, personality: 15 },
      ],
      badges: 5,
      money: 48250,
      pockets: {
        items: [[13, 7], [22, 4], [14, 2], [24, 3], [68, 1], [85, 2], [86, 5], [19, 1]],
        balls: [[4, 15], [3, 6], [2, 4], [1, 1]],
        tmhm: [[289, 1], [339, 1], [341, 1]],
        key: [[259, 1], [265, 1]],
      },
      seen: [252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 279, 280, 281, 282, 286],
      owned: [252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 279, 280, 281, 282, 286],
      boxes: [
        {
          name: 'CAJA 1',
          wallpaper: 3, // sabana, como la referencia
          mons: [
            { species: 263, nickname: 'ZIGZAGOON', experience: 3000 },
            { species: 265, nickname: 'WURMPLE', experience: 500 },
            { species: 25, nickname: 'Chispa', experience: 9000 },
            null,
            { species: 133, nickname: 'EEVEE', experience: 15000, personality: 0, otId: 0 },
            { species: 280, nickname: 'RALTS', experience: 1200 },
            { species: 255, nickname: 'TORCHIC', experience: 400 },
          ],
        },
        { name: 'CAJA 2', mons: [] },
        {
          name: 'PLAYA',
          wallpaper: 8,
          mons: [null, null, null, null, null, null, null, { species: 263, experience: 100 }, null, { species: 252, experience: 100 }, null, null, null, null, { species: 1, isEgg: true }],
        },
      ],
    });
    const fakeRa = dgram.createSocket('udp4');
    fakeRa.on('message', (m, r) => {
      const [cmd, a, n] = String(m).trim().split(' ');
      let out = null;
      if (cmd === 'VERSION') out = '1.21.0';
      else if (cmd === 'GET_STATUS') out = 'GET_STATUS PLAYING game_gba,Pokemon - Edicion Esmeralda (Spain)';
      else if (cmd === 'READ_CORE_MEMORY') {
        const addr = parseInt(a, 16);
        out = `READ_CORE_MEMORY ${addr.toString(16)} ${[...mem.read(addr, Number(n))].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
      }
      if (out) fakeRa.send(out, r.port, r.address);
    });
    await new Promise((r) => fakeRa.bind(0, '127.0.0.1', r));
    const raPort = fakeRa.address().port;

    const pages = {};
    for (const p of ['equipo', 'medallas', 'mochila', 'pc', 'mapa']) {
      pages[p] = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await pages[p].goto(`${BASE}/${p}`);
    }
    const layout = (anchor) => ({ scale: 1, anchor, offsetX: 48, offsetY: 48 });
    const views = {
      party: { visible: true, layout: layout('bottom-left') },
      badges: { visible: true, layout: layout('top-left') },
      bag: { visible: false, layout: layout('bottom-right') },
      pc: { visible: false, layout: layout('center-right') },
      map: { visible: true, layout: layout('top-right') },
      pocket: 'items',
      box: 0,
      rotateSec: 3,
      showcaseSec: 30,
    };
    send({
      type: 'settings',
      patch: {
        gameId: 'emerald',
        catalogMode: 'regional',
        spriteMode: 'game',
        auto: { enabled: true, battleCards: true, intervalMs: 250, port: raPort },
        views,
      },
    });
    /** Captura de un overlay de la partida: fondo transparente fuera de su contenido y dentro del lienzo. */
    async function analyzeView(page, name) {
      await sleep(700);
      const buf = await page.screenshot({ omitBackground: true, path: path.join(outDir, `${name}.png`) });
      const png = PNG.sync.read(buf);
      const rect = await page.evaluate(() => {
        const r = document.getElementById('view-root').getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      let outside = 0;
      for (let y = 0; y < png.height; y++)
        for (let x = 0; x < png.width; x++) {
          if (!png.data[(y * png.width + x) * 4 + 3]) continue;
          if (x < rect.left - 16 || x > rect.right + 16 || y < rect.top - 12 || y > rect.bottom + 20) outside++;
        }
      check(`${name}: fondo transparente fuera del overlay`, outside === 0, `${outside} píxeles opacos fuera`);
      check(`${name}: dentro del lienzo 1920×1080`, rect.left >= 0 && rect.top >= 0 && rect.right <= 1920 && rect.bottom <= 1080, JSON.stringify(rect));
    }
    const isEmpty = (page) => page.evaluate(() => !document.querySelector('#view-root .view-part:not(.leaving)'));

    // /equipo: solo el equipo
    const team = pages.equipo;
    await team.waitForFunction(() => document.querySelectorAll('.gm-mon:not(.empty)').length === 6, null, { timeout: 20000 });
    // Sprites de las especies (PokéAPI): esperar a que carguen.
    await team.waitForFunction(() => document.querySelectorAll('.gm-sprite img').length === 5, null, { timeout: 30000 });
    const teamInfo = await team.evaluate(() => ({
      names: [...document.querySelectorAll('.gm-name')].map((e) => e.textContent),
      fainted: document.querySelectorAll('.gm-mon.fainted').length,
      status: [...document.querySelectorAll('.gm-status')].map((e) => e.textContent),
      badges: document.querySelectorAll('.gm-badge').length,
    }));
    check(
      '/equipo: 6 huecos con motes, huevo, variocolor, estado y debilitado (sin medallas)',
      teamInfo.names.join(',') === 'SWAMPERT,Colmillos,★GARDEVOIR,BRELOOM,PELIPPER,Huevo' &&
        teamInfo.fainted === 1 &&
        teamInfo.status.join(',') === 'ENV,DEB' &&
        teamInfo.badges === 0,
      JSON.stringify(teamInfo),
    );
    await team.waitForFunction(() => [...document.querySelectorAll('.gm-ball-img')].filter((i) => i.naturalWidth === 16).length === 5, null, { timeout: 30000 });
    const balls = await team.$$eval('.gm-ball-img', (els) => els.map((e) => e.getAttribute('src').replace(/\D+/g, '')));
    check('/equipo: Poké Ball de captura original de cada Pokémon', balls.join(',') === '4,3,2,8,6', balls.join(','));
    for (const layout of ['grid', 'horizontal', 'vertical']) {
      send({ type: 'settings', patch: { views: { ...views, styles: { party: { layout } } } } });
      await team.waitForFunction((l) => document.querySelector(`.gm-party.layout-${l}`), layout, { timeout: 5000 });
      await analyzeView(team, `23-overlay-equipo-${layout}`);
    }

    // /medallas: solo las medallas, con nombres
    const badges = pages.medallas;
    // Las medallas llegan en la lectura de la partida, una vuelta después del equipo.
    await badges.waitForFunction(() => document.querySelectorAll('.gm-badge').length === 8, null, { timeout: 15000 });
    const badgeInfo = await badges.evaluate(() => ({
      owned: [...document.querySelectorAll('.gm-badge.owned .gm-badge-name')].map((e) => e.textContent),
      mons: document.querySelectorAll('.gm-mon').length,
    }));
    check(
      '/medallas: 5 de 8 con sus nombres (sin equipo)',
      badgeInfo.owned.join(',') === 'Piedra,Puño,Dinamo,Calor,Equilibrio' && badgeInfo.mons === 0,
      JSON.stringify(badgeInfo),
    );
    await badges.waitForFunction(() => [...document.querySelectorAll('.gm-badge-img')].filter((i) => i.naturalWidth === 16).length === 8, null, { timeout: 30000 });
    check('/medallas: los 8 sprites originales de la tarjeta de entrenador', true);
    await analyzeView(badges, '24-overlay-medallas');

    // /mochila y /pc: vacíos hasta que se piden
    check('/mochila y /pc: no muestran nada si no están fijos ni se piden', (await isEmpty(pages.mochila)) && (await isEmpty(pages.pc)));

    // /mochila: «Mostrar en directo» durante unos segundos
    const bag = pages.mochila;
    send({ type: 'showcase', showcase: { kind: 'bag', pocket: 'items' } });
    await bag.waitForFunction(() => document.querySelectorAll('.gm-item').length === 8, null, { timeout: 15000 });
    await bag.waitForFunction(
      () => [...document.querySelectorAll('.gm-item-name')].every((e) => !/^Objeto /.test(e.textContent)),
      null,
      { timeout: 30000 },
    );
    const bagNames = await bag.$$eval('.gm-item-name', (els) => els.map((e) => e.textContent));
    check('/mochila: nombres en español de PokéAPI', bagNames[0] === 'Poción' && bagNames.includes('Caramelo Raro'), bagNames.join(', '));
    check('/mochila: el equipo y las medallas siguen en sus overlays', !(await isEmpty(team)) && !(await isEmpty(badges)));
    await bag.waitForFunction(
      () => document.querySelector('.gm-bag-img')?.naturalWidth === 64 && [...document.querySelectorAll('.gm-item-icon img')].every((i) => i.naturalWidth === 24),
      null,
      { timeout: 30000 },
    );
    const bagSrc = await bag.getAttribute('.gm-bag-img', 'src');
    check('/mochila: mochila original abierta por el bolsillo e iconos originales', bagSrc === '/gba/bag-male-1.png', bagSrc);
    await analyzeView(bag, '25-overlay-mochila');
    // Rotación: pasa por los bolsillos con objetos (las Bayas están vacías y se saltan).
    const pocketsSeen = [];
    for (let t = 0; t < 20000 && new Set(pocketsSeen).size < 4; t += 250) {
      const label = await bag.evaluate(() => document.querySelector('.view-part:not(.leaving) .gm-title')?.textContent ?? '');
      const name = label.replace('Mochila · ', '');
      if (name && pocketsSeen.at(-1) !== name) pocketsSeen.push(name);
      await sleep(250);
    }
    check(
      '/mochila: se turnan los bolsillos con objetos y se salta el vacío',
      ['Objetos', 'Poké Balls', 'MT y MO', 'Objetos clave'].every((b) => pocketsSeen.includes(b)) && !pocketsSeen.includes('Bayas'),
      pocketsSeen.join(' → '),
    );
    send({ type: 'showcaseHide' });
    await bag.waitForFunction(() => !document.querySelector('#view-root .view-part:not(.leaving)'), null, { timeout: 5000 });
    check('/mochila: «Quitar» la retira', true);

    // /mochila fija: enseña el bolsillo elegido en el panel
    send({ type: 'settings', patch: { views: { ...views, bag: { ...views.bag, visible: true }, pocket: 'balls' } } });
    await bag.waitForFunction(() => /Poké Balls/.test(document.querySelector('.gm-title')?.textContent ?? ''), null, { timeout: 15000 });
    check('/mochila fija: muestra el bolsillo elegido (Poké Balls)', (await bag.$$eval('.gm-item', (e) => e.length)) === 4);
    send({ type: 'settings', patch: { views } });

    // /pc: lectura bajo demanda y «Mostrar en directo»
    const pc = pages.pc;
    send({ type: 'refreshPc' });
    await sleep(1500);
    send({ type: 'showcase', showcase: { kind: 'pc', box: 0 } });
    await pc.waitForFunction(
      () => document.querySelector('.gm-pc-bg')?.naturalWidth === 160 && document.querySelectorAll('.gm-pc-mon img').length === 6,
      null,
      { timeout: 30000 },
    );
    const pcInfo = await pc.evaluate(() => ({
      wallpaper: document.querySelector('.gm-pc-bg').getAttribute('src'),
      name: document.querySelector('.gm-pc-name').textContent,
      levels: document.querySelectorAll('.gm-cell-level').length,
    }));
    check('/pc: caja con su fondo original (sabana) y su nombre, sin niveles', pcInfo.wallpaper === '/gba/wallpaper-3.png' && pcInfo.name === 'CAJA 1' && pcInfo.levels === 0, JSON.stringify(pcInfo));
    // Los Pokémon se mueven y nunca salen de la caja (rebotan en los laterales).
    const positions = () =>
      pc.evaluate(() => {
        const area = document.querySelector('.view-part:not(.leaving) .gm-pc-area').getBoundingClientRect();
        return [...document.querySelectorAll('.view-part:not(.leaving) .gm-pc-mon')].map((m) => {
          const r = m.getBoundingClientRect();
          return { x: r.left - area.left, y: r.top - area.top, inside: r.left >= area.left - 1 && r.right <= area.right + 1 && r.top >= area.top - 1 && r.bottom <= area.bottom + 1 };
        });
      });
    const p1 = await positions();
    let allInside = p1.every((m) => m.inside);
    for (let i = 0; i < 8; i++) {
      await sleep(250);
      allInside &&= (await positions()).every((m) => m.inside);
    }
    const p2 = await positions();
    const moved = p1.filter((m, i) => Math.hypot(m.x - p2[i].x, m.y - p2[i].y) > 20).length;
    check('/pc: los Pokémon flotan por la caja y rebotan sin salirse', moved >= 5 && allInside, `${moved} de 6 se han movido; dentro: ${allInside}`);
    await analyzeView(pc, '26-overlay-pc');
    // Rotación: CAJA 1 → PLAYA (la caja 2 está vacía y se salta) → CAJA 1
    const boxesSeen = [];
    for (let t = 0; t < 12000 && boxesSeen.length < 3; t += 250) {
      const name = await pc.evaluate(() => document.querySelector('.view-part:not(.leaving) .gm-pc-name')?.textContent ?? '');
      if (name && boxesSeen.at(-1) !== name) boxesSeen.push(name);
      await sleep(250);
    }
    const alternating = boxesSeen.length === 3 && boxesSeen[0] === boxesSeen[2] && new Set(boxesSeen).size === 2 && boxesSeen.every((b) => b === 'CAJA 1' || b === 'PLAYA');
    check('/pc: se turnan las cajas con Pokémon y se salta la vacía', alternating, boxesSeen.join(' | '));
    send({ type: 'showcaseHide' });

    // /mapa: mapa de Hoenn con la cara del personaje, que se mueve al andar
    const mapPage = pages.mapa;
    await mapPage.waitForFunction(() => document.querySelector('.gm-map-place')?.textContent === 'RUTA 104', null, { timeout: 15000 });
    const markerAt = () =>
      mapPage.evaluate(() => {
        const m = document.querySelector('.gm-marker');
        return m && !m.hidden ? { left: parseFloat(m.style.left), top: parseFloat(m.style.top) } : null;
      });
    const m1 = await markerAt();
    await mapPage.waitForFunction(
      () => document.querySelector('.gm-map-img')?.naturalWidth === 240 && document.querySelector('.gm-face')?.naturalWidth === 16,
      null,
      { timeout: 30000 },
    );
    // Ruta 104 (casillas 0–1 × 7–10 de la tabla) → en el mapa del juego, columnas 1–2 y filas 9–12 (× 8 px × 2).
    check('/mapa: mapa original, cara del personaje y marcador en la Ruta 104', !!m1 && m1.left >= 16 && m1.left <= 32 && m1.top >= 144 && m1.top <= 192, JSON.stringify(m1));
    await analyzeView(mapPage, '29-overlay-mapa');
    mem.setLocation({ mapsec: 19, mapType: 3, x: 15, y: 5, width: 30, height: 80 }); // anda hacia el norte
    await mapPage.waitForFunction((top) => parseFloat(document.querySelector('.gm-marker').style.top) < top - 20, m1.top, { timeout: 5000 });
    check('/mapa: al andar se mueve la cara sin redibujar el mapa', (await mapPage.evaluate(() => document.querySelectorAll('.gm-map-img').length)) === 1);
    mem.setLocation({ mapsec: 10, mapType: 2, x: 20, y: 30, width: 40, height: 60 }); // llega a Ciudad Férrica
    await mapPage.waitForFunction(() => document.querySelector('.gm-map-place')?.textContent === 'CIUDAD FÉRRICA', null, { timeout: 5000 });
    check('/mapa: al cambiar de zona cambia el nombre', true);

    // Presentación de la mochila: lista debajo, 1 columna, 3 filas visibles que se desplazan
    send({
      type: 'settings',
      patch: {
        views: {
          ...views,
          bag: { ...views.bag, visible: true },
          rotateSec: 30, // sin cambiar de bolsillo mientras se comprueba el desplazamiento
          styles: { bag: { listPosition: 'bottom', columns: 1, rows: 3, scroll: true, bagSize: 2, iconSize: 2, textSize: 24, showTitle: true } },
          colors: { bag: { theme: 'rubi', custom: { frame: '#000000', frameDark: '#000000', border: '#000000', text: '#ffffff', title: '#ffffff', panel: '#ffffff', panelText: '#000000' } } },
        },
      },
    });
    await bag.waitForFunction(() => document.querySelector('.gm-pocket.list-bottom .gm-items-window.scrolling'), null, { timeout: 10000 });
    const bagLayout = await bag.evaluate(() => {
      const win = document.querySelector('.gm-items-window');
      const img = document.querySelector('.gm-bag').getBoundingClientRect();
      return {
        below: win.getBoundingClientRect().top >= img.bottom - 1,
        overflow: document.querySelector('.gm-items').scrollHeight > win.clientHeight + 4,
        accent: getComputedStyle(document.querySelector('.view-part')).getPropertyValue('--accent').trim(),
      };
    });
    // Tras una pausa arriba, la lista baja despacio.
    const scrolled = await bag
      .waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('.gm-items')).transform).m42 < -5, null, { timeout: 8000 })
      .then(() => true, () => false);
    check('/mochila: lista debajo, en 1 columna, que se desplaza despacio porque no cabe', bagLayout.below && bagLayout.overflow && scrolled, JSON.stringify({ ...bagLayout, scrolled }));
    check('/mochila: tema de color «Rubí»', bagLayout.accent === '#d42a2a', bagLayout.accent);
    await analyzeView(bag, '32-mochila-lista-abajo-rubi');
    send({ type: 'settings', patch: { views: { ...views, styles: { bag: { listPosition: 'right', columns: 2, rows: 6, iconSize: 1, textSize: 20 } }, colors: { bag: { theme: 'game' } } } } });

    // Mapa: nombre de la zona encima
    send({ type: 'settings', patch: { views: { ...views, styles: { map: { labelPosition: 'top', scale: 2 } } } } });
    await mapPage.waitForFunction(() => document.querySelector('.view-map.label-top .gm-map-place + .gm-map'), null, { timeout: 5000 });
    check('/mapa: el nombre de la zona puede ir encima', true);
    send({ type: 'settings', patch: { views: { ...views, styles: { map: { labelPosition: 'bottom' } } } } });

    // Turnos: PC y mapa en el mismo lugar, 3 s cada uno
    send({
      type: 'settings',
      patch: {
        groups: [{ id: 'esquina', name: 'Esquina', enabled: true, mode: 'shared', items: ['card', 'pc', 'map'], seconds: 3, layout: { scale: 1, anchor: 'bottom-left', offsetX: 30, offsetY: 30 } }],
      },
    });
    const visibleNow = async () => {
      const [pcOn, mapOn] = await Promise.all([pc, mapPage].map((pg) => pg.evaluate(() => !!document.querySelector('#view-root .view-part:not(.leaving)'))));
      return pcOn && mapOn ? 'ambos' : pcOn ? 'PC' : mapOn ? 'Mapa' : 'nada';
    };
    const seen = [];
    for (let t = 0; t < 9000; t += 250) {
      const v = await visibleNow();
      if (v !== 'nada' && seen.at(-1) !== v) seen.push(v);
      await sleep(250);
    }
    check('turnos: el PC y el mapa se turnan y nunca coinciden', seen.length >= 3 && !seen.includes('ambos'), seen.join(' → '));
    const pos = await mapPage.evaluate(() => {
      const r = document.getElementById('view-root').getBoundingClientRect();
      return { left: Math.round(r.left), bottom: Math.round(1080 - r.bottom) };
    });
    check('turnos: «mismo lugar» usa la posición del grupo (abajo a la izquierda)', pos.left === 30 && pos.bottom === 30, JSON.stringify(pos));
    // La ficha tiene prioridad en su grupo
    send({ type: 'show', request: { gameId: 'emerald', catalogMode: 'regional', spriteMode: 'game', speciesId: 263, durationSec: 6 } });
    await overlayPage.waitForSelector('.dex-slot.visible', { timeout: 20000 });
    await sleep(800);
    check('turnos: con la ficha en pantalla, el PC y el mapa de su grupo se apartan', (await visibleNow()) === 'nada');
    const cardPos = await overlayPage.evaluate(() => {
      const r = document.querySelector('.dex-slot.visible').getBoundingClientRect();
      return { left: Math.round(r.left), bottom: Math.round(1080 - r.bottom) };
    });
    check('turnos: la ficha aparece en la posición del grupo', cardPos.left === 30 && cardPos.bottom === 30, JSON.stringify(cardPos));
    send({ type: 'hide' });
    await sleep(1200);
    check('turnos: al quitar la ficha, siguen los turnos', (await visibleNow()) !== 'nada');
    send({ type: 'settings', patch: { groups: [], views: { ...views, bag: { ...views.bag, visible: false } } } });
    await sleep(500);

    // Rival nuevo en la Pokédex
    mem.setBattle(0, [{ species: 271, personality: 999 }]); // Lombre: no visto
    mem.markSeen(271); // el juego lo marca como visto al empezar el combate
    await overlayPage.waitForFunction(() => document.querySelector('.dex-slot.visible .dex-new'), null, { timeout: 20000 });
    await sleep(700);
    const newName = await overlayPage.textContent('.dex-slot.visible .dex-name');
    check('combate: un rival no visto lleva «¡Nuevo!»', newName === 'Lombre', newName);
    const nuevo = await analyze('27-rival-nuevo');
    check('«¡Nuevo!»: transparente fuera de la ficha', nuevo.outside === 0, `${nuevo.outside} píxeles opacos fuera`);
    check('«¡Nuevo!»: sin desbordamientos internos', (await internalOverflow()).length === 0);
    mem.endBattle();
    send({ type: 'hide' });

    // Panel: sección Partida
    const panel = await browser.newPage({ viewport: { width: 720, height: 1600 } });
    await panel.goto(`${BASE}/control`);
    await tab(panel, 'partida');
    await panel.waitForSelector('#tab-party .gm-mon');
    await panel.click('button[data-tab="bag"]');
    await panel.waitForSelector('#bag-view .gm-item');
    await panel.click('button[data-tab="pc"]');
    await panel.waitForSelector('#pc-view .gm-cell-sprite img', { timeout: 15000 });
    const summary = await panel.textContent('#game-summary');
    // 20 vistos: los 19 de la partida más Lombre, visto en el combate anterior.
    check('panel: resumen de la partida (Pokédex y dinero)', /20 vistos, 17 capturados/.test(summary) && /48\.250/.test(summary), summary);
    // Editor de overlays: al elegir otro overlay se cargan sus ajustes
    await tab(panel, 'diseno');
    await panel.click('#design-chips button[data-target="badges"]');
    const badgesAnchor = await panel.inputValue('#design-anchor');
    await panel.click('#design-chips button[data-target="pc"]');
    const pcAnchor = await panel.inputValue('#design-anchor');
    // Vista previa del elemento elegido, ampliada, y textos que se pueden quitar
    await panel.click('#design-chips button[data-target="party"]');
    const editorFrame = () => panel.frames().find((f) => /editor=1/.test(f.url()) && new URL(f.url()).pathname === '/equipo');
    for (let i = 0; i < 40 && !editorFrame(); i++) await sleep(250);
    await editorFrame().waitForFunction(() => document.querySelectorAll('.gm-level').length > 0, null, { timeout: 15000 });
    await sleep(600);
    const zoom = await panel.evaluate(() => {
      const stage = document.getElementById('editor-stage');
      return { h: stage.clientHeight, w: stage.clientWidth, t: stage.querySelector('iframe').style.transform };
    });
    check('editor: vista previa ampliada sobre el equipo', zoom.h > 150 && /translate/.test(zoom.t), JSON.stringify(zoom));
    await panel.locator('.design-preview').screenshot({ path: path.join(outDir, '29-editor-equipo.png') });
    const textLabels = await panel.$$eval('#design-texts .check span, #design-texts .field > span', (els) => els.map((e) => e.textContent));
    check('editor: textos del equipo (mote, nivel, PS, estado y alineación)', textLabels.length === 6, textLabels.join(' · '));
    await panel.uncheck('#design-texts input[data-key="showLevel"]');
    await editorFrame().waitForFunction(() => document.querySelectorAll('.gm-level').length === 0, null, { timeout: 5000 });
    check('editor: quitar el nivel se ve al momento en la vista previa', true);
    await panel.click('#design-texts input[name="align-party-textAlign"][value="center"]');
    await editorFrame().waitForSelector('.gm-party.text-center', { state: 'attached', timeout: 5000 });
    check('editor: alinear los textos del equipo al centro', true);
    await panel.check('#design-texts input[data-key="showLevel"]');
    await panel.click('#design-texts input[name="align-party-textAlign"][value="left"]');
    await panel.click('input[name="editor-view"][value="canvas"]');
    await sleep(400);
    const canvasH = await panel.evaluate(() => document.getElementById('editor-stage').clientHeight);
    check('editor: «Lienzo completo» enseña los 1920 × 1080 a escala', Math.abs(canvasH - Math.round((zoom.w * 1080) / 1920)) <= 2, `${canvasH} px`);
    await panel.click('input[name="editor-view"][value="zoom"]');
    // Ficha: textos propios y ficha de ejemplo en la vista previa
    await panel.click('#design-chips button[data-target="card"]');
    const cardFrame = () => panel.frames().find((f) => /editor=1/.test(f.url()) && new URL(f.url()).pathname === '/overlay');
    for (let i = 0; i < 40 && !cardFrame(); i++) await sleep(250);
    await cardFrame().waitForSelector('.dex-slot.visible .dex-card', { timeout: 20000 });
    await panel.uncheck('#design-texts input[data-key="showTypes"]');
    await cardFrame().waitForSelector('.dex-card.hide-types', { state: 'attached', timeout: 5000 });
    check('editor: la ficha de ejemplo se ve y se le pueden quitar los tipos', true);
    await panel.check('#design-texts input[data-key="showTypes"]');
    // Presentación y colores del elemento elegido
    await panel.click('#design-chips button[data-target="bag"]');
    const fields = await panel.$$eval('#design-style .field span, #design-style .check span', (els) => els.map((e) => e.textContent));
    check('panel: opciones de presentación de la mochila', fields.some((f) => /Lista de objetos/.test(f)) && fields.some((f) => /Columnas/.test(f)), fields.length + ' opciones');
    const colorInputs = await panel.$$eval('#design-colors input[type=color]', (els) => els.length);
    check('panel: siete colores personalizables', colorInputs === 7, String(colorInputs));
    await tab(panel, 'turnos');
    await panel.click('#group-add');
    await panel.waitForSelector('#groups-list .group');
    const groupUi = await panel.evaluate(() => ({
      items: [...document.querySelectorAll('#groups-list .group-items input:checked')].map((i) => i.parentElement.textContent),
      shared: !!document.querySelector('#groups-list .group-layout'),
    }));
    check('panel: «Añadir grupo» crea un grupo de PC y mapa en el mismo lugar', groupUi.items.join(',') === 'PC,Mapa' && groupUi.shared, JSON.stringify(groupUi));
    await panel.click('#groups-list .group .danger');
    await panel.waitForFunction(() => !document.querySelector('#groups-list .group'));
    check('panel: cada overlay de la partida tiene su propia posición', badgesAnchor === 'top-left' && pcAnchor === 'center-right', `${badgesAnchor} / ${pcAnchor}`);
    const urls = await panel.$$eval('input[data-path]', (els) => els.map((e) => e.value.replace(location.origin, '')));
    check('panel: direcciones para OBS de los overlays de la partida', urls.join(',') === '/equipo,/medallas,/mochila,/pc,/mapa', urls.join(','));
    await tab(panel, 'partida');
    await panel.click('button[data-tab="party"]');
    await sleep(500);
    await panel.locator('#game-box').screenshot({ path: path.join(outDir, '28-panel-partida.png') });
    const hscroll = await panel.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('panel: la sección Partida no provoca scroll horizontal', !hscroll);
    await panel.close();

    // Vista previa del panel con la partida de ejemplo (sin RetroArch)
    send({ type: 'settings', patch: { auto: { enabled: false, battleCards: true, intervalMs: 250, port: 55355 } } });
    await sleep(800);
    const prev = await browser.newPage({ viewport: { width: 720, height: 1400 } });
    await prev.goto(`${BASE}/control`);
    await tab(prev, 'obs');
    await prev.waitForSelector('#preview-box summary');
    await prev.waitForFunction(() => /conectado/.test(document.getElementById('pill-server').textContent));
    await prev.click('#preview-box summary');
    await prev.check('#demo-enabled');
    await prev.waitForFunction(() => /PARTIDA DE EJEMPLO/.test(document.getElementById('game-summary').textContent), null, { timeout: 10000 });
    const frames = () => prev.frames().filter((f) => /preview=1/.test(f.url()));
    const frameFor = (pathName) => frames().find((f) => new URL(f.url()).pathname === pathName);
    for (let i = 0; i < 40 && frames().length < 6; i++) await sleep(250);
    check('vista previa: seis capas (ficha, equipo, medallas, mochila, PC y mapa)', frames().length === 6, `${frames().length} capas`);
    await frameFor('/equipo').waitForFunction(() => document.querySelectorAll('.gm-sprite img').length === 5, null, { timeout: 30000 });
    await frameFor('/mapa').waitForSelector('.gm-marker:not([hidden])', { state: 'attached', timeout: 10000 });
    await sleep(800);
    await prev.locator('#live-preview').screenshot({ path: path.join(outDir, '30-vista-previa-ejemplo.png') });
    // El directo (las páginas abiertas como en OBS) no recibe la partida de ejemplo.
    const realEmpty = await Promise.all(['equipo', 'medallas', 'mapa'].map((k) => isEmpty(pages[k])));
    check('partida de ejemplo: el directo no la recibe', realEmpty.every(Boolean), realEmpty.join(','));
    const ov = await prev.textContent('#pill-overlay');
    check('vista previa: no cuenta como overlay de OBS', /1 conectado/.test(ov), ov);
    await prev.uncheck('#demo-enabled');

    // Botones de prueba: llegan al directo de verdad
    await prev.click('#test-overlays');
    await pages.equipo.waitForFunction(() => document.querySelectorAll('.gm-mon:not(.empty)').length === 6, null, { timeout: 15000 });
    await pages.pc.waitForFunction(() => document.querySelector('.gm-pc-mon'), null, { timeout: 15000 });
    await prev.waitForFunction(() => /Detener la prueba/.test(document.getElementById('test-overlays').textContent), null, { timeout: 5000 });
    const btn = await prev.textContent('#test-overlays');
    check('«Probar overlays en directo»: OBS enseña la partida de ejemplo (también PC sin estar fijo)', /Detener la prueba/.test(btn), btn);
    await prev.click('#test-overlays'); // detener
    await pages.equipo.waitForFunction(() => !document.querySelector('#view-root .view-part:not(.leaving)'), null, { timeout: 5000 });
    check('«Probar overlays en directo»: al detenerla, el directo vuelve a los datos reales', true);
    await tab(prev, 'partida');
    await prev.click('#test-battle-double');
    await overlayPage.waitForFunction(() => document.querySelectorAll('.dex-slot.visible .dex-stack.double > .dex-card').length === 2 && document.querySelector('.dex-slot.visible .dex-new'), null, { timeout: 30000 });
    await sleep(700);
    await analyze('31-probar-combate-doble');
    check('«Probar combate doble»: dos tarjetas y «¡Nuevo!» en el directo', true);
    send({ type: 'hide' });
    await prev.close();

    send({ type: 'settings', patch: { gameId: 'red' } });
    await sleep(300);
    for (const p of Object.values(pages)) await p.close();
    fakeRa.close();
  }

  // Panel de control: capturas
  for (const [w, h, name] of [
    [380, 1600, '10-panel-estrecho'],
    [720, 1400, '11-panel-ancho'],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`${BASE}/control`);
    await tab(page, 'directo');
    await page.waitForSelector('#results button');
    await page.fill('#search', 'eevee');
    await sleep(300);
    const res = await page.locator('#results button').count();
    if (name === '10-panel-estrecho') check('panel: la búsqueda filtra resultados', res >= 1, `${res} resultado(s)`);
    await page.locator('#results button').first().click().catch(() => {});
    await page.waitForSelector('#preview .dex-card', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`${name}: sin scroll horizontal`, !hscroll);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    // Diseño en el mismo ancho: sin scroll horizontal.
    await tab(page, 'diseno');
    await page.waitForSelector('#editor-stage iframe');
    await sleep(1500);
    const dscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`${name} (Diseño): sin scroll horizontal`, !dscroll);
    await page.screenshot({ path: path.join(outDir, `${name}-diseno.png`), fullPage: true });
    await page.close();
  }
  // Diseño en pantalla ancha: vista previa a la izquierda y ajustes a la derecha.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${BASE}/control`);
    await tab(page, 'diseno');
    await page.click('#design-chips button[data-target="map"]');
    await page.waitForSelector('#editor-stage iframe');
    await sleep(2000);
    const cols = await page.evaluate(() => {
      const a = document.querySelector('.design-preview').getBoundingClientRect();
      const b = document.querySelector('.design-settings').getBoundingClientRect();
      return { side: b.left >= a.right - 1, top: Math.abs(a.top - b.top) < 4 };
    });
    check('Diseño en pantalla ancha: vista previa y ajustes en dos columnas', cols.side && cols.top, JSON.stringify(cols));
    await page.screenshot({ path: path.join(outDir, '12-panel-diseno-ancho.png') });
    await page.close();
  }
} finally {
  control.close();
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas. Capturas en ${outDir}`);
process.exit(failed ? 1 : 0);
