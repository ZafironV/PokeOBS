import type { ClientMessage } from '../shared/types.js';

// «Vista previa del directo» del panel: los overlays reales en miniatura, cada uno
// en su posición, sobre un lienzo de 1920 × 1080 a escala. Solo se cargan mientras
// la sección está abierta, y el servidor no los cuenta como overlays de OBS.

const LAYERS = [
  { path: '/overlay', label: 'Ficha' },
  { path: '/equipo', label: 'Equipo' },
  { path: '/medallas', label: 'Medallas' },
  { path: '/mochila', label: 'Mochila' },
  { path: '/pc', label: 'PC' },
  { path: '/mapa', label: 'Mapa' },
];

export function initLivePreview(deps: { send(msg: ClientMessage): boolean }) {
  const box = document.getElementById('preview-box') as HTMLDetailsElement;
  const stage = document.getElementById('live-preview')!;
  const layersUi = document.getElementById('preview-layers')!;
  const demo = document.getElementById('demo-enabled') as HTMLInputElement;
  const hidden = new Set<string>();

  for (const l of LAYERS) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) hidden.delete(l.path);
      else hidden.add(l.path);
      const frame = stage.querySelector<HTMLIFrameElement>(`iframe[data-path="${l.path}"]`);
      if (frame) frame.hidden = hidden.has(l.path);
    });
    const span = document.createElement('span');
    span.textContent = l.label;
    label.append(input, span);
    layersUi.append(label);
  }

  function fit() {
    const scale = stage.clientWidth / 1920;
    stage.style.height = `${Math.round(1080 * scale)}px`;
    for (const f of stage.querySelectorAll('iframe')) f.style.transform = `scale(${scale})`;
  }
  new ResizeObserver(fit).observe(stage);

  box.addEventListener('toggle', () => {
    if (!box.open) {
      stage.textContent = ''; // cierra las conexiones de la vista previa
      return;
    }
    for (const l of LAYERS) {
      const f = document.createElement('iframe');
      f.src = `${l.path}?preview=1`;
      f.dataset.path = l.path;
      f.title = `Vista previa: ${l.label}`;
      f.tabIndex = -1;
      f.hidden = hidden.has(l.path);
      stage.append(f);
    }
    fit();
  });

  demo.addEventListener('change', () => {
    // Sin conexión con el servidor el cambio no llega: la casilla vuelve a su estado.
    if (!deps.send({ type: 'demo', enabled: demo.checked })) demo.checked = !demo.checked;
  });

  return {
    onDemo(enabled: boolean) {
      demo.checked = enabled;
    },
  };
}
