import { useEffect, useState } from "react";
import type { StatusResponse } from "../../../shared/types/domain";
import { fetchStatus, pauseSession, resumeSession, startSession, stopSession } from "../api/sessionApi";
import { useInterval } from "../../../shared/hooks/useInterval";

export function useSessionRuntime() {
  const [status, setStatus] = useState<StatusResponse>({
    sessionState: "STOPPED",
    sessionId: null,
    eventsFile: null
  });

  const [busy, setBusy] = useState<"none" | "start" | "stop" | "pause" | "resume">("none");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const st = await fetchStatus();
      setStatus(st);
    } catch {
      return;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useInterval(() => void refresh(), 2000);

  async function start() {
    setError(null);
    setBusy("start");
    try {
      setStatus(await startSession());
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
      setStatus(await stopSession());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("none");
    }
  }

  async function pause() {
    setError(null);
    setBusy("pause");
    try {
      setStatus(await pauseSession());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("none");
    }
  }

  async function resume() {
    setError(null);
    setBusy("resume");
    try {
      setStatus(await resumeSession());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("none");
    }
  }

  const canStart = status.sessionState === "STOPPED" && busy === "none";
  const canStop = (status.sessionState === "RUNNING" || status.sessionState === "PAUSED" || status.sessionState === "RESUMING") && busy === "none";
  const canPause = status.sessionState === "RUNNING" && busy === "none";
  const canResume = status.sessionState === "PAUSED" && busy === "none";

  return { status, busy, error, start, stop, pause, resume, canStart, canStop, canPause, canResume };
}
