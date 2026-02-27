import { useCallback, useEffect, useState } from "react";
import { getWsUrl } from "../../../shared/config/env";
import type {
  BotStats,
  ConnStatus,
  LogEvent,
  SessionState,
  StreamsState,
  SymbolRow,
  WsMessage,
} from "../../../shared/types/domain";

type ClientWsMessage =
  | { type: "events_tail_request"; payload: { limit: number } }
  | { type: "rows_refresh_request"; payload?: { mode?: "tick" | "snapshot" } }
  | { type: "streams_toggle_request" }
  | { type: "streams_apply_subscriptions_request" };

const EMPTY_BOT_STATS: BotStats = {
  openPositions: 0,
  pendingOrders: 0,
  unrealizedPnl: 0,
  closedTrades: 0,
  wins: 0,
  losses: 0,
  netRealized: 0,
  feesPaid: 0,
  fundingAccrued: 0,
  executionMode: "paper",
};

type WsFeedState = {
  conn: ConnStatus;
  rows: SymbolRow[];
  lastServerTime: number | null;
  lastMsg: string;
  wsSessionState: SessionState;
  wsSessionId: string | null;
  streams: StreamsState;
  universeSelectedId: string;
  universeSymbolsCount: number;
  botStats: BotStats;
  events: LogEvent[];
  eventStream: LogEvent[];
};

const wsUrl = getWsUrl();
const listeners = new Set<(state: WsFeedState) => void>();
const liteListeners = new Set<(state: WsFeedState) => void>();
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let started = false;
let eventsLimit = 5;

let state: WsFeedState = {
  conn: "CONNECTING",
  rows: [],
  lastServerTime: null,
  lastMsg: "",
  wsSessionState: "STOPPED",
  wsSessionId: null,
  streams: { streamsEnabled: true, bybitConnected: false },
  universeSelectedId: "",
  universeSymbolsCount: 0,
  botStats: EMPTY_BOT_STATS,
  events: [],
  eventStream: [],
};

function emitFull() {
  for (const listener of listeners) listener(state);
}

function emitLite() {
  for (const listener of liteListeners) listener(state);
}

function patchState(patch: Partial<WsFeedState>) {
  const prev = state;
  state = { ...state, ...patch };
  emitFull();

  const liteChanged =
    prev.conn !== state.conn ||
    prev.lastServerTime !== state.lastServerTime ||
    prev.wsSessionState !== state.wsSessionState ||
    prev.wsSessionId !== state.wsSessionId ||
    prev.streams !== state.streams ||
    prev.universeSelectedId !== state.universeSelectedId ||
    prev.universeSymbolsCount !== state.universeSymbolsCount;

  if (liteChanged) emitLite();
}

function send(msg: ClientWsMessage) {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  } catch {
    return;
  }
}

function connect(kind: "CONNECTING" | "RECONNECTING") {
  patchState({ conn: kind });
  const nextWs = new WebSocket(wsUrl);
  ws = nextWs;

  nextWs.onopen = () => {
    patchState({ conn: "CONNECTED" });
    send({ type: "rows_refresh_request", payload: { mode: "snapshot" } });
    send({ type: "events_tail_request", payload: { limit: eventsLimit } });
  };

  nextWs.onmessage = (e) => {
    const raw = String(e.data);
    patchState({ lastMsg: raw });

    try {
      const msg = JSON.parse(raw) as WsMessage;

      if (msg.type === "hello") {
        patchState({ lastServerTime: msg.serverTime });
        return;
      }

      if (msg.type === "snapshot") {
        const snapshotRows = (msg as any)?.payload?.rows;
        patchState({
          wsSessionState: msg.payload.sessionState,
          wsSessionId: msg.payload.sessionId ?? null,
          rows: Array.isArray(snapshotRows) ? snapshotRows : [],
          streams: {
            streamsEnabled: msg.payload.streamsEnabled,
            bybitConnected: msg.payload.bybitConnected,
          },
          universeSelectedId: (msg.payload as any).universeSelectedId ?? "",
          universeSymbolsCount: Number((msg.payload as any).universeSymbolsCount ?? 0),
          botStats: ((msg.payload as any).botStats as BotStats) ?? EMPTY_BOT_STATS,
        });
        return;
      }

      if (msg.type === "tick") {
        const tickRows = (msg as any)?.payload?.rows;
        patchState({
          lastServerTime: msg.payload.serverTime,
          rows: Array.isArray(tickRows) ? tickRows : [],
          universeSelectedId: (msg.payload as any).universeSelectedId ?? "",
          universeSymbolsCount: Number((msg.payload as any).universeSymbolsCount ?? 0),
          botStats: ((msg.payload as any).botStats as BotStats) ?? EMPTY_BOT_STATS,
        });
        return;
      }

      if (msg.type === "streams_state") {
        patchState({ streams: msg.payload });
        return;
      }

      if (msg.type === "events_tail") {
        patchState({ events: msg.payload.events ?? [] });
        return;
      }

      if (msg.type === "events_append") {
        const ev = msg.payload.event;
        const nextEvents = [...state.events, ev];
        const trimmedEvents = nextEvents.length > eventsLimit ? nextEvents.slice(nextEvents.length - eventsLimit) : nextEvents;
        patchState({
          events: trimmedEvents,
          eventStream: [...state.eventStream, ev],
        });
        return;
      }

      if (msg.type === "error") {
        console.error("WS error:", msg.message);
      }
    } catch {
      return;
    }
  };

  nextWs.onclose = () => {
    patchState({ conn: "DISCONNECTED" });
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => connect("RECONNECTING"), 1500);
  };

  nextWs.onerror = () => {
    try {
      nextWs.close();
    } catch {
      return;
    }
  };
}

function ensureStarted() {
  if (started) return;
  started = true;
  connect("CONNECTING");
}


export function useWsFeedLite() {
  const [localState, setLocalState] = useState<WsFeedState>(state);

  useEffect(() => {
    ensureStarted();
    liteListeners.add(setLocalState);
    setLocalState(state);
    return () => {
      liteListeners.delete(setLocalState);
    };
  }, []);

  return {
    conn: localState.conn,
    lastServerTime: localState.lastServerTime,
    wsSessionState: localState.wsSessionState,
    wsSessionId: localState.wsSessionId,
    wsUrl,
    streams: localState.streams,
    universeSelectedId: localState.universeSelectedId,
    universeSymbolsCount: localState.universeSymbolsCount,
  };
}

export function useWsFeed() {
  const [localState, setLocalState] = useState<WsFeedState>(state);

  useEffect(() => {
    ensureStarted();
    listeners.add(setLocalState);
    setLocalState(state);
    return () => {
      listeners.delete(setLocalState);
    };
  }, []);

  const requestEventsTail = useCallback((limit: number) => {
    const lim = Math.max(1, Math.min(100, Math.floor(limit)));
    eventsLimit = lim;
    send({ type: "events_tail_request", payload: { limit: lim } });
  }, []);

  const requestRowsRefresh = useCallback((mode: "tick" | "snapshot" = "tick") => {
    send({ type: "rows_refresh_request", payload: { mode } });
  }, []);

  const toggleStreams = useCallback(() => {
    send({ type: "streams_toggle_request" });
  }, []);

  const applySubscriptions = useCallback(() => {
    send({ type: "streams_apply_subscriptions_request" });
  }, []);

  return {
    conn: localState.conn,
    rows: localState.rows,
    lastServerTime: localState.lastServerTime,
    lastMsg: localState.lastMsg,
    wsSessionState: localState.wsSessionState,
    wsSessionId: localState.wsSessionId,
    wsUrl,

    streams: localState.streams,
    toggleStreams,
    applySubscriptions,

    universeSelectedId: localState.universeSelectedId,
    universeSymbolsCount: localState.universeSymbolsCount,

    botStats: localState.botStats,

    events: localState.events,
    eventStream: localState.eventStream,
    requestEventsTail,
    requestRowsRefresh,
  };
}
