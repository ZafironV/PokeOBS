// Compila servidor y cliente con esbuild y copia los recursos estáticos a dist/.
// Uso: node scripts/build.mjs          (compilación única)
//      node scripts/build.mjs --watch  (desarrollo: recompila y reinicia el servidor)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

function copyStatic() {
  const pub = path.join(out, 'public');
  fs.cpSync(path.join(root, 'public'), pub, { recursive: true });
  const fonts = path.join(pub, 'fonts');
  fs.mkdirSync(fonts, { recursive: true });
  for (const [pkg, file] of [
    ['silkscreen', 'silkscreen-latin-400-normal.woff2'],
    ['silkscreen', 'silkscreen-latin-700-normal.woff2'],
    ['vt323', 'vt323-latin-400-normal.woff2'],
  ]) {
    fs.copyFileSync(path.join(root, 'node_modules', '@fontsource', pkg, 'files', file), path.join(fonts, file));
  }
}

const common = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'info' };

const serverOptions = {
  ...common,
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(out, 'server.js'),
  platform: 'node',
  format: 'esm',
  packages: 'external',
};

const clientOptions = {
  ...common,
  entryPoints: {
    control: path.join(root, 'src/client/control.ts'),
    overlay: path.join(root, 'src/client/overlay.ts'),
    partida: path.join(root, 'src/client/gameOverlay.ts'),
  },
  outdir: path.join(out, 'public', 'js'),
  platform: 'browser',
  format: 'esm',
  minify: !watch,
};

if (!watch) {
  fs.rmSync(out, { recursive: true, force: true });
  copyStatic();
  await Promise.all([esbuild.build(serverOptions), esbuild.build(clientOptions)]);
} else {
  copyStatic();
  let child = null;
  const restart = () => {
    child?.kill();
    child = spawn(process.execPath, ['--enable-source-maps', path.join(out, 'server.js')], { stdio: 'inherit' });
  };
  const restartPlugin = { name: 'restart', setup: (b) => b.onEnd((r) => r.errors.length === 0 && restart()) };
  const server = await esbuild.context({ ...serverOptions, plugins: [restartPlugin] });
  const client = await esbuild.context(clientOptions);
  await Promise.all([server.watch(), client.watch()]);
  let pending;
  fs.watch(path.join(root, 'public'), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(copyStatic, 100);
  });
  process.on('SIGINT', () => {
    child?.kill();
    process.exit(0);
  });
}
