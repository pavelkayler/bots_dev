import { useSyncExternalStore } from 'react';
import type {
  Cooldown,
  Counts,
  EventRow,
  SessionStartRequest,
  SessionStartResponse,
  SessionState,
  SessionStateMessage,
  SessionStatusResponse,
  SessionStopResponse,
  SnapshotMessage,
  SymbolRow,
  TickMessage,
} from '../ws/types';

const MAX_EVENTS = 2000;
const DEFAULT_COUNTS: Counts = { symbolsTotal: 0, ordersActive: 0, positionsOpen: 0 };
const DEFAULT_COOLDOWN: Cooldown = { isActive: false, reason: null, fromTs: null, untilTs: null };
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type WsConnectionState = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export interface AppState {
  wsConnected: boolean;
  wsConnectionState: WsConnectionState;
  wsLastMessageTs: number | null;
  wsHello: { protocolVersion: number; serverName: string; serverEnv: string } | null;
  sessionId: string | null;
  sessionState: SessionState;
  tfMin: number | null;
  config: SessionStartRequest | null;
  counts: Counts;
  cooldown: Cooldown;
  symbolsByKey: Map<string, SymbolRow>;
  liveSymbolsByKey: Map<string, SymbolRow>;
  symbolsRenderPaused: boolean;
  events: EventRow[];
  lastError: string | null;
  startResponse: SessionStartResponse | null;
}

const state: AppState = {
  wsConnected: false,
  wsConnectionState: 'DISCONNECTED',
  wsLastMessageTs: null,
  wsHello: null,
  sessionId: null,
  sessionState: 'STOPPED',
  tfMin: null,
  config: null,
  counts: DEFAULT_COUNTS,
  cooldown: DEFAULT_COOLDOWN,
  symbolsByKey: new Map<string, SymbolRow>(),
  liveSymbolsByKey: new Map<string, SymbolRow>(),
  symbolsRenderPaused: false,
  events: [],
  lastError: null,
  startResponse: null,
};

const listeners = new Set<() => void>();

function setState(partial: Partial<AppState>) {
  Object.assign(state, partial);
  listeners.forEach((listener) => listener());
}

export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selector(state),
  );
}

export const appStore = {
  getState: () => state,
  setWsConnected: (connected: boolean) =>
    setState({ wsConnected: connected, wsConnectionState: connected ? 'CONNECTED' : 'DISCONNECTED' }),
  setWsConnectionState: (wsConnectionState: WsConnectionState) =>
    setState({ wsConnectionState, wsConnected: wsConnectionState === 'CONNECTED' }),
  setWsLastMessageTs: (ts: number) => setState({ wsLastMessageTs: ts }),
  setWsHello: (protocolVersion: number, serverName: string, serverEnv: string) =>
    setState({ wsHello: { protocolVersion, serverName, serverEnv } }),
  setError: (message: string | null) => setState({ lastError: message }),

  toggleSymbolsRenderPaused: () => {
    if (state.symbolsRenderPaused) {
      setState({
        symbolsRenderPaused: false,
        symbolsByKey: new Map(state.liveSymbolsByKey),
      });
      return;
    }

    setState({ symbolsRenderPaused: true });
  },

  applySnapshot: (message: SnapshotMessage) => {
    const symbolsByKey = new Map<string, SymbolRow>();
    for (const row of message.symbols) {
      symbolsByKey.set(row.symbol, row);
    }

    setState({
      sessionId: message.session.sessionId,
      sessionState: message.session.state,
      tfMin: message.session.tfMin,
      config: message.config,
      counts: message.counts,
      cooldown: message.cooldown,
      symbolsByKey,
      liveSymbolsByKey: new Map(symbolsByKey),
      events: message.eventsTail.slice(-MAX_EVENTS),
      wsLastMessageTs: message.ts,
    });
  },

  applyTick: (message: TickMessage) => {
    const nextLiveMap = new Map(state.liveSymbolsByKey);
    for (const delta of message.symbolsDelta) {
      nextLiveMap.set(delta.symbol, delta);
    }

    const partial: Partial<AppState> = {
      sessionId: message.session.sessionId,
      sessionState: message.session.state,
      counts: message.counts,
      cooldown: message.cooldown,
      liveSymbolsByKey: nextLiveMap,
      wsLastMessageTs: message.ts,
    };

    if (!state.symbolsRenderPaused) {
      partial.symbolsByKey = new Map(nextLiveMap);
    }

    setState(partial);
  },

  applySessionState: (message: SessionStateMessage) => {
    setState({
      sessionId: message.sessionId,
      sessionState: message.state,
      cooldown: message.cooldown,
      wsLastMessageTs: message.ts,
    });
  },

  appendEvents: (events: EventRow[]) => {
    setState({ events: [...state.events, ...events].slice(-MAX_EVENTS) });
  },

  fetchSessionStatus: async () => {
    const response = await fetch(`${API_BASE_URL}/api/session/status`);
    if (!response.ok) {
      throw new Error(`Failed to fetch status (${response.status})`);
    }
    const payload = (await response.json()) as SessionStatusResponse;
    setState({
      sessionId: payload.sessionId,
      sessionState: payload.state,
      tfMin: payload.tfMin,
      counts: payload.counts,
      cooldown: payload.cooldown,
    });
  },

  startSession: async (payload: SessionStartRequest) => {
    const response = await fetch(`${API_BASE_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? `Start failed (${response.status})`);
    }
    const startResponse = data as SessionStartResponse;
    setState({
      startResponse,
      sessionId: startResponse.sessionId,
      sessionState: startResponse.state,
      config: payload,
      lastError: null,
    });
    return startResponse;
  },

  stopSession: async () => {
    const response = await fetch(`${API_BASE_URL}/api/session/stop`, {
      method: 'POST',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? `Stop failed (${response.status})`);
    }
    const stopResponse = data as SessionStopResponse;
    setState({
      sessionId: stopResponse.sessionId,
      sessionState: stopResponse.state,
    });
    return stopResponse;
  },
};
