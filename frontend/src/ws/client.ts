import { appStore } from '../state/store';
import type { WsIncomingMessage } from './types';

const WS_BASE_URL = import.meta.env.VITE_WS_URL;

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
      appStore.setWsConnected(true);
      appStore.setError(null);
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as WsIncomingMessage;
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
      appStore.setWsConnected(false);
      if (isClosedManually) {
        return;
      }
      reconnectAttempt += 1;
      const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 10000);
      reconnectTimer = window.setTimeout(connect, delayMs);
    };

    socket.onerror = () => {
      appStore.setWsConnected(false);
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
