import type { ClientMessage, ServerMessage } from '../shared/types.js';

export interface LiveSocket {
  send(msg: ClientMessage): boolean;
  readonly connected: boolean;
}

/** WebSocket con reconexión automática (backoff hasta 5 s). Envía "hello" al conectar. */
export function connectSocket(
  role: 'control' | 'overlay' | 'team',
  onMessage: (msg: ServerMessage) => void,
  onConnection: (connected: boolean) => void,
  /** Vista previa del panel: el servidor no la cuenta como overlay de OBS. */
  preview = false,
  /** Vista previa del editor de diseño. */
  editor = false,
): LiveSocket {
  let ws: WebSocket | null = null;
  let delay = 500;
  let connected = false;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 500;
      connected = true;
      ws!.send(JSON.stringify({ type: 'hello', role, ...(preview ? { preview } : {}), ...(editor ? { editor } : {}) } satisfies ClientMessage));
      onConnection(true);
    };
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch (e) {
        console.error(e);
      }
    };
    ws.onclose = () => {
      if (connected) onConnection(false);
      connected = false;
      ws = null;
      setTimeout(open, delay);
      delay = Math.min(5000, delay * 2);
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return {
    send(msg) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    get connected() {
      return connected;
    },
  };
}
