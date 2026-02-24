import { useEffect, useMemo, useRef, useState } from "react";
import type { LogEvent, SessionState } from "../../../shared/types/domain";

export type TradeStatsBySymbol = {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  fees: number;
  funding: number;
  totalHoldMs: number;
  avgHoldMs: number;
  lastCloseTs: number | null;
};


function toFiniteNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseTs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsedNum = Number(v);
    if (Number.isFinite(parsedNum)) return parsedNum;
    const parsedDate = Date.parse(v);
    if (Number.isFinite(parsedDate)) return parsedDate;
  }
  return null;
}

function eventHoldMs(ev: LogEvent): number {
  const payload = ev.payload ?? {};
  const opened = parseTs(payload.openedAt ?? payload.openedTs ?? payload.opened);
  const closed = parseTs(payload.closedAt ?? payload.closedTs ?? payload.closed ?? ev.ts);
  if (opened == null || closed == null) return 0;
  return Math.max(0, closed - opened);
}

function eventRealizedPnl(ev: LogEvent): number {
  const payload = ev.payload ?? {};
  if (Number.isFinite(Number(payload.realizedPnl))) {
    return toFiniteNumber(payload.realizedPnl, 0);
  }

  const pnlFromMove = toFiniteNumber(payload.pnlFromMove, 0);
  const feesPaid = toFiniteNumber(payload.feesPaid, 0);
  const fundingAccrued = toFiniteNumber(payload.fundingAccrued, 0);
  return pnlFromMove + feesPaid + fundingAccrued;
}

export function useTradeStatsBySymbol(sessionState: SessionState, sessionId: string | null, events: LogEvent[]) {
  const [statsMap, setStatsMap] = useState<Record<string, TradeStatsBySymbol>>({});
  const lastProcessedIndexRef = useRef(0);
  const prevRunningSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionState === "RUNNING" && sessionId && prevRunningSessionIdRef.current !== sessionId) {
      prevRunningSessionIdRef.current = sessionId;
      lastProcessedIndexRef.current = events.length;
      setStatsMap({});
      return;
    }

    if (sessionState !== "RUNNING") {
      return;
    }

    if (lastProcessedIndexRef.current > events.length) {
      lastProcessedIndexRef.current = events.length;
    }

    const start = lastProcessedIndexRef.current;
    if (start >= events.length) return;

    const nextEvents = events.slice(start);
    lastProcessedIndexRef.current = events.length;

    setStatsMap((prev) => {
      const next: Record<string, TradeStatsBySymbol> = { ...prev };

      for (const ev of nextEvents) {
        if (!ev?.type || !String(ev.type).startsWith("POSITION_CLOSE")) continue;

        const symbol = String(ev.symbol ?? "").trim();
        if (!symbol) continue;

        const realizedPnl = eventRealizedPnl(ev);
        const feesPaid = toFiniteNumber(ev.payload?.feesPaid, 0);
        const fundingAccrued = toFiniteNumber(ev.payload?.fundingAccrued, 0);
        const holdMs = eventHoldMs(ev);
        const lastCloseTs = parseTs(ev.payload?.closedAt ?? ev.payload?.closedTs ?? ev.ts);

        const cur =
          next[symbol] ??
          ({
            symbol,
            trades: 0,
            wins: 0,
            losses: 0,
            netPnl: 0,
            fees: 0,
            funding: 0,
            totalHoldMs: 0,
            avgHoldMs: 0,
            lastCloseTs: null
          } as TradeStatsBySymbol);

        cur.trades += 1;
        if (realizedPnl > 0) cur.wins += 1;
        else cur.losses += 1;

        cur.netPnl += realizedPnl;
        cur.fees += feesPaid;
        cur.funding += fundingAccrued;
        cur.totalHoldMs += holdMs;
        cur.avgHoldMs = cur.trades > 0 ? cur.totalHoldMs / cur.trades : 0;
        cur.lastCloseTs = lastCloseTs ?? cur.lastCloseTs;

        next[symbol] = cur;
      }

      return next;
    });
  }, [sessionState, sessionId, events]);

  return useMemo(() => Object.values(statsMap), [statsMap]);
}
