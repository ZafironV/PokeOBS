// Aplicación de escritorio de PokeOBS: arranca el servidor local dentro de la
// propia aplicación y abre el panel en su ventana. Las fuentes de OBS siguen
// apuntando a http://127.0.0.1:4520 mientras la aplicación está abierta.
//
// La X de la ventana la oculta en la bandeja de Windows (junto al reloj): PokeOBS
// sigue funcionando para OBS. Solo «Salir» del menú de la bandeja la cierra.
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const updater = require('./updater.cjs');

const PORT = Number(process.env.POKEOBS_PORT ?? 4520);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = app.getAppPath();
// Los datos (ajustes y caché) van en %APPDATA%\PokeOBS: sobreviven a las actualizaciones.
const DATA_DIR = process.env.POKEOBS_DATA ?? path.join(app.getPath('userData'), 'data');
const STATE_FILE = path.join(app.getPath('userData'), 'app-state.json');
const ICON = path.join(ROOT, 'build', 'icon.png');
/** Arranque con Windows: la aplicación empieza oculta en la bandeja. */
const HIDDEN_ARG = '--bandeja';

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;

/** Pequeño estado de la aplicación (p. ej. si ya se avisó de la bandeja). */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeState(patch) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }));
  } catch {
    // sin estado: se volverá a avisar
  }
}

async function healthy() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Protección temporal de los comandos de red de RetroArch (como Iniciar-PokeOBS.bat):
 * Windows pide permiso; la regla se borra sola al cerrar la aplicación.
 */
function startFirewallGuard() {
  const script = path.join(ROOT, 'scripts', 'firewall-guard.ps1');
  // POKEOBS_SKIP_FIREWALL=1: sin aviso de permisos (pruebas automáticas).
  if (!fs.existsSync(script) || process.env.POKEOBS_SKIP_FIREWALL === '1') return;
  const command =
    "try { Start-Process powershell -Verb RunAs -WindowStyle Hidden -ErrorAction Stop -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -DataDir \"{1}\"' -f $env:POKEOBS_GUARD_SCRIPT, $env:POKEOBS_GUARD_DATA) } catch { exit 1 }";
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    env: { ...process.env, POKEOBS_GUARD_SCRIPT: script, POKEOBS_GUARD_DATA: DATA_DIR },
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
}

async function startServer() {
  // Ya hay un PokeOBS en marcha (otra copia o Iniciar-PokeOBS.bat): se usa ese.
  if (await healthy()) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.rmSync(path.join(DATA_DIR, 'pokeobs.pid'), { force: true });
  startFirewallGuard();
  process.env.POKEOBS_PORT = String(PORT);
  process.env.POKEOBS_DATA = DATA_DIR;
  await import(pathToFileURL(path.join(ROOT, 'dist', 'server.js')).href);
  for (let i = 0; i < 100 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 100));
}

// ── Inicio con Windows ───────────────────────────────────────────────────────

/** Solo en la aplicación instalada (en desarrollo se registraría electron.exe). */
const autoStartSupported = () => app.isPackaged;
const autoStartEnabled = () => autoStartSupported() && app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin;
function setAutoStart(enabled) {
  if (!autoStartSupported()) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] });
  refreshTray();
}

ipcMain.handle('autostart:get', () => ({ supported: autoStartSupported(), enabled: autoStartEnabled() }));
ipcMain.handle('autostart:set', (_e, enabled) => {
  setAutoStart(!!enabled);
  return { supported: autoStartSupported(), enabled: autoStartEnabled() };
});

// ── Ventana ──────────────────────────────────────────────────────────────────

function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(show) {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 400,
    minHeight: 500,
    show,
    title: 'PokeOBS',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.setMenuBarVisibility(false);
  // Los enlaces externos (PokéAPI, WikiDex, ayuda…) se abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(BASE)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // La X oculta la ventana en la bandeja; PokeOBS sigue funcionando para OBS.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!readState().trayNoticeShown) {
      writeState({ trayNoticeShown: true });
      tray?.displayBalloon({
        iconType: 'info',
        title: 'PokeOBS sigue abierto',
        content: 'Está en la bandeja, junto al reloj. Para cerrarlo del todo: clic derecho en la Poké Ball → Salir.',
      });
    }
  });
  win.on('closed', () => (win = null));
  void win.loadURL(`${BASE}/control`);
}

// ── Bandeja ──────────────────────────────────────────────────────────────────

function refreshTray() {
  if (!tray) return;
  const update = updater.readyVersion();
  const template = [
    { label: 'Abrir panel', click: showWindow },
    { label: 'Copiar dirección del overlay', click: () => clipboard.writeText(`${BASE}/overlay`) },
    { type: 'separator' },
  ];
  if (autoStartSupported()) {
    template.push({
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: autoStartEnabled(),
      click: (item) => setAutoStart(item.checked),
    });
  }
  if (update) template.push({ label: `Instalar la versión ${update} y reiniciar`, click: () => updater.installNow() });
  template.push({ type: 'separator' }, { label: 'Salir', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(update ? `PokeOBS · versión ${update} lista para instalar` : `PokeOBS · ${BASE}`);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
  refreshTray();
}

// ── Arranque ─────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  // Ya está abierta: la otra copia enseña su ventana.
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox('PokeOBS no ha podido arrancar', String(err?.stack ?? err));
      app.exit(1);
      return;
    }
    createTray();
    createWindow(!process.argv.includes(HIDDEN_ARG));
    updater.start({
      window: () => win,
      notify: (title, content) => tray?.displayBalloon({ iconType: 'info', title, content }),
      changed: refreshTray,
    });
  });

  app.on('before-quit', () => (quitting = true));
  // Con la ventana en la bandeja la aplicación sigue abierta: solo «Salir» la cierra.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => {
    fs.rmSync(path.join(DATA_DIR, 'pokeobs.pid'), { force: true });
    updater.installOnQuit();
  });
}
