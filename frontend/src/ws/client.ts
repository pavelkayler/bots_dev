import { appStore } from '../state/store';
import type { WsIncomingMessage } from './types';

const WS_BASE_URL = import.meta.env.VITE_WS_URL;

function isWsIncomingMessage(value: unknown): value is WsIncomingMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const msg = value as { type?: unknown; ts?: unknown };
  return typeof msg.type === 'string' && typeof msg.ts === 'number';
}

export function createWsClient(): () => void {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const defaultUrl = `${scheme}://${window.location.host}/ws`;
  const wsUrl = WS_BASE_URL ?? defaultUrl;

  let socket: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: number | null = null;
  let isClosedManually = false;

  const connect = () => {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      reconnectAttempt = 0;
      appStore.setWsConnectionState('CONNECTED');
      appStore.setError(null);
    };

    socket.onmessage = (event) => {
      try {
        const decoded = JSON.parse(String(event.data));
        if (!isWsIncomingMessage(decoded)) {
          return;
        }

        const message = decoded as WsIncomingMessage;
        appStore.setWsLastMessageTs(message.ts);

        switch (message.type) {
          case 'hello':
            appStore.setWsHello(message.protocolVersion, message.server.name, message.server.env);
            break;
          case 'snapshot':
            appStore.applySnapshot(message);
            break;
          case 'tick':
            appStore.applyTick(message);
            break;
          case 'events_append':
            appStore.appendEvents(message.events);
            break;
          case 'session_state':
            appStore.applySessionState(message);
            break;
          case 'error':
            if (message.scope === 'BYBIT_WS' && message.code === 'RECONNECTING') {
              appStore.setWsConnectionState('RECONNECTING');
            }
            appStore.setError(`${message.scope}:${message.code} ${message.message}`);
            break;
          default:
            break;
        }
      } catch (error) {
        appStore.setError(`WS parse error: ${(error as Error).message}`);
      }
    };

    socket.onclose = () => {
      appStore.setWsConnectionState('DISCONNECTED');
      if (isClosedManually) {
        return;
      }
      reconnectAttempt += 1;
      appStore.setWsConnectionState('RECONNECTING');
      const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 10000);
      reconnectTimer = window.setTimeout(connect, delayMs);
    };

    socket.onerror = () => {
      appStore.setWsConnectionState('DISCONNECTED');
    };
  };

  connect();

  return () => {
    isClosedManually = true;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close();
    }
  };
}
