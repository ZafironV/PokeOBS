import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { config, ROOT } from './config.js';
import { firewallRuleActive } from './firewall.js';
import { CachedFetcher, GbaAssets } from './gbaAssets.js';
import { ItemCatalog } from './items.js';
import { LocalTexts } from './localTexts.js';
import { PokeApiClient, SpriteCache } from './pokeapi.js';
import { PokedexService } from './pokedex.js';
import { loadProfiles } from './profiles.js';
import { SettingsStore } from './settings.js';
import { WikiDexClient } from './wikidex.js';

const profiles = loadProfiles(config.profilesDir);
const cacheDir = path.join(config.dataDir, 'cache');
const api = new PokeApiClient(cacheDir, config.userAgent);
const sprites = new SpriteCache(cacheDir, config.spriteBase, config.userAgent);
const wikidex = new WikiDexClient(cacheDir, config.userAgent);
const service = new PokedexService(api, sprites, new LocalTexts(config.textsDir), config.apiBase, profiles, wikidex);
const settings = new SettingsStore(config.dataDir, profiles.map((p) => p.id));

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
const { server } = createApp({
  service,
  sprites,
  settings,
  publicDir: path.join(ROOT, 'dist', 'public'),
  localOnly: loopback,
  log: (m) => console.error(m),
  firewallActive: firewallRuleActive,
  items: new ItemCatalog(api),
  gba: new GbaAssets(cacheDir, new CachedFetcher(cacheDir, config.userAgent)),
});

/** PID para scripts/firewall-guard.ps1, que borra la regla temporal del firewall al cerrarse PokeOBS. */
const pidFile = path.join(config.dataDir, 'pokeobs.pid');
const removePidFile = () => fs.rmSync(pidFile, { force: true });

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nEl puerto ${config.port} ya está en uso. ¿Hay otra ventana de PokeOBS abierta?\n` +
        `Puedes usar otro puerto con la variable de entorno POKEOBS_PORT.\n`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid));
  const base = `http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`;
  console.log('');
  console.log('  PokeOBS en marcha');
  console.log(`  Perfiles: ${profiles.map((p) => p.name).join(', ')}`);
  console.log('');
  console.log(`  Panel de control (Panel de navegador personalizado): ${base}/control`);
  console.log(`  Overlay (Fuente de navegador, 1920 × 1080):           ${base}/overlay`);
  console.log(`  Partida (Fuentes de navegador, 1920 × 1080): ${base}/equipo  ${base}/medallas  ${base}/mochila  ${base}/pc  ${base}/mapa`);
  console.log('');
  if (!loopback) console.log(`  AVISO: escuchando en ${config.host}, accesible desde otros equipos de la red.`);
  console.log('  Cierra esta ventana o pulsa Ctrl+C para detener el servidor.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    removePidFile();
    server.close();
    process.exit(0);
  });
}
