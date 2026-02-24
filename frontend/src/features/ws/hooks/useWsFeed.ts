import { useCallback, useEffect, useRef, useState } from "react";
import { getWsUrl } from "../../../shared/config/env";
import type {
  BotStats,
  ConnStatus,
  LogEvent,
  SessionState,
  StreamsState,
  SymbolRow,
  WsMessage
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
  fundingAccrued: 0
};

export function useWsFeed() {
  const wsUrl = getWsUrl();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const [conn, setConn] = useState<ConnStatus>("CONNECTING");
  const [rows, setRows] = useState<SymbolRow[]>([]);
  const [lastServerTime, setLastServerTime] = useState<number | null>(null);
  const [lastMsg, setLastMsg] = useState<string>("");

  const [wsSessionState, setWsSessionState] = useState<SessionState>("STOPPED");
  const [wsSessionId, setWsSessionId] = useState<string | null>(null);

  const [streams, setStreams] = useState<StreamsState>({ streamsEnabled: true, bybitConnected: false });
  const [universeSelectedId, setUniverseSelectedId] = useState<string>("");
  const [universeSymbolsCount, setUniverseSymbolsCount] = useState<number>(0);

  const [botStats, setBotStats] = useState<BotStats>(EMPTY_BOT_STATS);

  // events (via WS)
  const [events, setEvents] = useState<LogEvent[]>([]);
  const eventsLimitRef = useRef<number>(5);

  const send = useCallback((msg: ClientWsMessage) => {
    try {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }, []);

  const requestEventsTail = useCallback(
    (limit: number) => {
      const lim = Math.max(1, Math.min(5, Math.floor(limit)));
      eventsLimitRef.current = lim;
      send({ type: "events_tail_request", payload: { limit: lim } });
    },
    [send]
  );

  const requestRowsRefresh = useCallback(
    (mode: "tick" | "snapshot" = "tick") => {
      send({ type: "rows_refresh_request", payload: { mode } });
    },
    [send]
  );

  const toggleStreams = useCallback(() => {
    send({ type: "streams_toggle_request" });
  }, [send]);

  const applySubscriptions = useCallback(() => {
    send({ type: "streams_apply_subscriptions_request" });
  }, [send]);

  useEffect(() => {
    let stopped = false;

    function connect(kind: "CONNECTING" | "RECONNECTING") {
      if (stopped) return;

      setConn(kind);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped) return;
        setConn("CONNECTED");

        // initial sync
        send({ type: "rows_refresh_request", payload: { mode: "snapshot" } });
        send({ type: "events_tail_request", payload: { limit: eventsLimitRef.current } });
      };

      ws.onmessage = (e) => {
        if (stopped) return;
        setLastMsg(String(e.data));

        try {
          const msg = JSON.parse(String(e.data)) as WsMessage;

          if (msg.type === "hello") {
            setLastServerTime(msg.serverTime);
            return;
          }

          if (msg.type === "snapshot") {
            setWsSessionState(msg.payload.sessionState);
            setWsSessionId(msg.payload.sessionId ?? null);
            const snapshotRows = (msg as any)?.payload?.rows;
            setRows(Array.isArray(snapshotRows) ? snapshotRows : []);

            setStreams({
              streamsEnabled: msg.payload.streamsEnabled,
              bybitConnected: msg.payload.bybitConnected
            });

            setUniverseSelectedId((msg.payload as any).universeSelectedId ?? "");
            setUniverseSymbolsCount(Number((msg.payload as any).universeSymbolsCount ?? 0));

            setBotStats(((msg.payload as any).botStats as BotStats) ?? EMPTY_BOT_STATS);
            return;
          }

          if (msg.type === "tick") {
            setLastServerTime(msg.payload.serverTime);
            const tickRows = (msg as any)?.payload?.rows;
            setRows(Array.isArray(tickRows) ? tickRows : []);

            setUniverseSelectedId((msg.payload as any).universeSelectedId ?? "");
            setUniverseSymbolsCount(Number((msg.payload as any).universeSymbolsCount ?? 0));

            setBotStats(((msg.payload as any).botStats as BotStats) ?? EMPTY_BOT_STATS);
            return;
          }

          if (msg.type === "streams_state") {
            setStreams(msg.payload);
            return;
          }

          if (msg.type === "events_tail") {
            setEvents(msg.payload.events ?? []);
            return;
          }

          if (msg.type === "events_append") {
            const ev = msg.payload.event;
            setEvents((prev) => {
              const next = [...prev, ev];
              const lim = eventsLimitRef.current;
              return next.length > lim ? next.slice(next.length - lim) : next;
            });
            return;
          }

          if (msg.type === "error") {
            // eslint-disable-next-line no-console
            console.error("WS error:", msg.message);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setConn("DISCONNECTED");

        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => connect("RECONNECTING"), 1500);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    }

    connect("CONNECTING");

    return () => {
      stopped = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [wsUrl]);

  return {
    conn,
    rows,
    lastServerTime,
    lastMsg,
    wsSessionState,
    wsSessionId,
    wsUrl,

    streams,
    toggleStreams,
    applySubscriptions,

    universeSelectedId,
    universeSymbolsCount,

    botStats,

    events,
    requestEventsTail,
    requestRowsRefresh
  };
}
