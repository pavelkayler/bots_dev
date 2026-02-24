import { useEffect, useState } from "react";
import type { StatusResponse, SessionState } from "../../../shared/types/domain";
import { fetchStatus, startSession, stopSession } from "../api/sessionApi";
import { useInterval } from "../../../shared/hooks/useInterval";

export function useSessionRuntime() {
  const [status, setStatus] = useState<StatusResponse>({
    sessionState: "STOPPED",
    sessionId: null,
    eventsFile: null
  });

  const [busy, setBusy] = useState<"none" | "start" | "stop">("none");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const st = await fetchStatus();
      setStatus(st);
    } catch {
      // ignore polling errors
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(() => void refresh(), 2000);

  async function start() {
    setError(null);
    setBusy("start");
    try {
      const st = await startSession();
      setStatus(st);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("none");
    }
  }

  async function stop() {
    setError(null);
    setBusy("stop");
    try {
      const st = await stopSession();
      setStatus(st);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("none");
    }
  }

  const canStart = status.sessionState !== "RUNNING" && busy === "none";
  const canStop = status.sessionState === "RUNNING" && busy === "none";

  return {
    status,
    busy,
    error,
    start,
    stop,
    canStart,
    canStop
  };
}
