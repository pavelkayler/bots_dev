import { useCallback, useEffect, useState } from "react";
import type { SessionState } from "../../../shared/types/domain";
import type { SessionSummaryResponse } from "../types";
import { fetchSessionSummary } from "../api/summaryApi";

export function useSessionSummary(sessionState: SessionState, sessionId: string | null, suppressStopRefresh = false) {
  const [data, setData] = useState<SessionSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (sessionState === "RUNNING" && sessionId) {
      setData(null);
      setError(null);
      setLastUpdatedAt(null);
      setLoading(false);
    }
  }, [sessionState, sessionId]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    try {
      const d = await fetchSessionSummary();
      setData(d);
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    // Summary is generated on STOP. Refresh when we are not running.
    if (sessionState !== "RUNNING" && !suppressStopRefresh) {
      void refresh();
    }
  }, [sessionState, sessionId, refresh, suppressStopRefresh]);

  return { data, loading, error, lastUpdatedAt, refresh };
}
