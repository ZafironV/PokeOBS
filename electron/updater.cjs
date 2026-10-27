// Actualizaciones automáticas desde GitHub Releases.
//
// Cada push a main publica una versión nueva con su instalador .msi y la suma
// SHA-256 (.github/workflows/release.yml). La aplicación mira al arrancar y cada
// hora si hay una versión mayor, descarga el .msi en segundo plano, comprueba la
// suma y pregunta si se instala ya o al salir de PokeOBS (nunca corta un directo).
// Con la ventana en la bandeja no pregunta: avisa con una notificación y la
// instalación queda en el menú de la bandeja.
const { app, dialog } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 15 * 1000;

/** Repositorio "usuario/proyecto"; lo escribe la compilación de GitHub Actions. */
const REPO = require('../package.json').updateRepo;
const UPDATES_DIR = path.join(app.getPath('userData'), 'updates');
const LOG_FILE = path.join(app.getPath('userData'), 'updater.log');

/** @type {{ version: string; file: string } | null} */
let ready = null;
let busy = false;
let asked = false;
let installing = false;
/** @type {{ window(): import('electron').BrowserWindow | null; notify(title: string, content: string): void; changed(): void }} */
let hooks = { window: () => null, notify: () => {}, changed: () => {} };

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // sin registro
  }
}

/** ¿`a` es mayor que `b`? (versiones 1.2.3) */
function newer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function github(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `PokeOBS/${app.getVersion()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status} a ${url}`);
  return res;
}

/** Descarga `url` en `file` y devuelve su SHA-256 en hexadecimal. */
async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': `PokeOBS/${app.getVersion()}` } });
  if (!res.ok || !res.body) throw new Error(`descarga fallida (${res.status})`);
  const hash = crypto.createHash('sha256');
  const tmp = `${file}.part`;
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(tmp),
  );
  fs.renameSync(tmp, file);
  return hash.digest('hex');
}

/** Borra los instaladores de versiones ya instaladas o a medio descargar. */
function cleanup() {
  try {
    for (const name of fs.readdirSync(UPDATES_DIR)) {
      const v = /^PokeOBS-(\d+\.\d+\.\d+)\.msi$/.exec(name)?.[1];
      if (!v || !newer(v, app.getVersion())) fs.rmSync(path.join(UPDATES_DIR, name), { force: true });
    }
  } catch {
    // aún no hay carpeta
  }
}

async function check() {
  if (busy || ready || installing) return;
  busy = true;
  try {
    const release = await (await github(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
    const version = String(release.tag_name ?? '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version) || !newer(version, app.getVersion())) return;
    const msi = release.assets?.find((a) => a.name === `PokeOBS-${version}.msi`);
    const sum = release.assets?.find((a) => a.name === `PokeOBS-${version}.msi.sha256`);
    if (!msi || !sum) return log(`v${version} sin instalador o sin suma SHA-256`);

    const expected = (await (await github(sum.browser_download_url)).text()).trim().split(/\s+/)[0].toLowerCase();
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    const file = path.join(UPDATES_DIR, msi.name);
    log(`descargando v${version}`);
    const actual = await download(msi.browser_download_url, file);
    if (actual !== expected) {
      fs.rmSync(file, { force: true });
      throw new Error(`la suma SHA-256 de v${version} no coincide: se descarta`);
    }
    ready = { version, file };
    log(`v${version} lista para instalar`);
    hooks.changed();
    await ask(hooks.window());
  } catch (err) {
    log(`error: ${err?.message ?? err}`);
  } finally {
    busy = false;
  }
}

async function ask(win) {
  if (!ready || asked) return;
  asked = true;
  if (!win?.isVisible()) {
    hooks.notify(
      `PokeOBS ${ready.version} está lista`,
      'Se instalará al salir de PokeOBS. Para hacerlo ya: clic derecho en la Poké Ball de la bandeja.',
    );
    return;
  }
  win.setTitle(`PokeOBS · versión ${ready.version} lista`);
  const options = {
    type: 'info',
    title: 'Actualización de PokeOBS',
    message: `PokeOBS ${ready.version} está lista para instalar.`,
    detail: `Tienes la ${app.getVersion()}. Si estás en directo, elige «Al salir de PokeOBS»: se instalará sola cuando salgas desde la bandeja (cerrar la ventana no basta).`,
    buttons: ['Al salir de PokeOBS', 'Reiniciar e instalar ahora'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const { response } = await dialog.showMessageBox(win, options);
  if (response === 1) installNow();
}

/** Cierra PokeOBS, instala la versión descargada y vuelve a abrirla. */
function installNow() {
  if (!ready) return;
  install(true);
  app.quit();
}

/**
 * Lanza el instalador cuando PokeOBS ya se ha cerrado (para que no haya archivos
 * en uso) y, si se pide, vuelve a abrir la aplicación al terminar. Se instala para
 * el usuario actual, sin permisos de administrador.
 */
function install(relaunch) {
  if (!ready || installing) return;
  installing = true;
  const script = path.join(UPDATES_DIR, 'instalar.cmd');
  fs.writeFileSync(
    script,
    [
      '@echo off',
      'timeout /t 3 /nobreak >nul',
      'msiexec /i "%~1" /passive /norestart',
      'if "%~2"=="" exit /b',
      'start "" "%~2"',
      '',
    ].join('\r\n'),
  );
  log(`instalando v${ready.version}${relaunch ? ' y reabriendo' : ''}`);
  spawn('cmd.exe', ['/c', script, ready.file, relaunch ? process.execPath : ''], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

module.exports = {
  /** Empieza a buscar actualizaciones (solo en la aplicación instalada). */
  start(options) {
    hooks = options;
    if (!app.isPackaged || !REPO) return;
    cleanup();
    setTimeout(() => void check(), FIRST_CHECK_MS);
    setInterval(() => void check(), CHECK_EVERY_MS);
  },
  /** Versión descargada y lista para instalar, o null. */
  readyVersion() {
    return ready?.version ?? null;
  },
  installNow,
  /** Al salir de PokeOBS, instala la versión descargada (si la hay). */
  installOnQuit() {
    install(false);
  },
};
