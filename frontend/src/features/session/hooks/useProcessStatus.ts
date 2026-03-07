import { useEffect, useState } from "react";
import type { ProcessStatusResponse } from "../../../shared/types/domain";
import { useInterval } from "../../../shared/hooks/useInterval";
import { fetchProcessStatus } from "../api/sessionApi";

const EMPTY_STATUS: ProcessStatusResponse = {
  runtime: { state: "STOPPED", runningSinceMs: null, message: null },
  optimizer: {
    state: "stopped",
    runIndex: 0,
    runsCount: 0,
    isInfinite: false,
    currentJobId: null,
    jobStatus: null,
    progressPct: 0,
    message: null,
  },
  receiveData: {
    state: "idle",
    jobId: null,
    progressPct: 0,
    currentSymbol: null,
    message: null,
    etaSec: null,
  },
  recorder: {
    state: "idle",
    mode: "off",
    progressPct: null,
    message: "Recorder is not started.",
  },
};

export function useProcessStatus() {
  const [status, setStatus] = useState<ProcessStatusResponse>(EMPTY_STATUS);

  async function refresh() {
    try {
      const next = await fetchProcessStatus();
      setStatus(next);
    } catch {
      return;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useInterval(() => void refresh(), 2000);

  return { status, refresh };
}
