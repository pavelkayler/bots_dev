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
  const openByPositionIdRef = useRef<Map<string, number>>(new Map());
  const openBySymbolRef = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    if (sessionState === "RUNNING" && sessionId && prevRunningSessionIdRef.current !== sessionId) {
      prevRunningSessionIdRef.current = sessionId;
      lastProcessedIndexRef.current = events.length;
      openByPositionIdRef.current.clear();
      openBySymbolRef.current.clear();
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
        const eventType = String(ev?.type ?? "");
        const symbol = String(ev.symbol ?? "").trim();
        if (!symbol) continue;

        if (eventType === "POSITION_OPEN") {
          const openedTs = parseTs(ev.payload?.openedAt ?? ev.payload?.openedTs ?? ev.ts);
          if (openedTs == null) continue;
          const positionId = String(ev.payload?.positionId ?? "").trim();
          if (positionId) {
            openByPositionIdRef.current.set(positionId, openedTs);
          } else {
            const queue = openBySymbolRef.current.get(symbol) ?? [];
            queue.push(openedTs);
            openBySymbolRef.current.set(symbol, queue);
          }
          continue;
        }

        if (!eventType.startsWith("POSITION_CLOSE")) continue;

        const closeTs = parseTs(ev.payload?.closedAt ?? ev.payload?.closedTs ?? ev.ts);
        let openedTs: number | null = null;
        const positionId = String(ev.payload?.positionId ?? "").trim();

        if (positionId && openByPositionIdRef.current.has(positionId)) {
          openedTs = openByPositionIdRef.current.get(positionId) ?? null;
          openByPositionIdRef.current.delete(positionId);
        } else {
          const queue = openBySymbolRef.current.get(symbol) ?? [];
          const fallback = queue.pop();
          if (queue.length > 0) openBySymbolRef.current.set(symbol, queue);
          else openBySymbolRef.current.delete(symbol);
          openedTs = typeof fallback === "number" ? fallback : null;
        }

        const holdMs = openedTs != null && closeTs != null ? Math.max(0, closeTs - openedTs) : 0;
        const realizedPnl = eventRealizedPnl(ev);
        const feesPaid = toFiniteNumber(ev.payload?.feesPaid, 0);
        const fundingAccrued = toFiniteNumber(ev.payload?.fundingAccrued, 0);
        const lastCloseTs = closeTs;

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
