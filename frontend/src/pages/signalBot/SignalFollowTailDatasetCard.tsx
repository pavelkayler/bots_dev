import { useEffect, useState } from "react";
import { Button, Card, Form } from "react-bootstrap";
import { listUniverses } from "../../features/universe/api";
import type { UniverseMeta } from "../../features/universe/types";
import { DATASET_CACHE_STORAGE_KEY, cancelReceiveDataJob, getReceiveDataJob, startReceiveData, type ReceiveDataJob } from "../../features/dataReceive/api/dataReceiveApi";
import { CenteredProgressBar } from "../../shared/ui/CenteredProgressBar";
import { formatReceiveProgressLine } from "../../features/datasetTarget/ui/receiveProgress";

const RECEIVE_JOB_STORAGE_KEY = "signalBot.followTail.receiveJobId";
const START_DATE_STORAGE_KEY = "signalBot.followTail.startDate";
const UNIVERSE_STORAGE_KEY = "signalBot.followTail.universeId";

function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota errors to keep the page functional.
  }
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocal(text: string): number | null {
  if (!text) return null;
  const value = new Date(text).getTime();
  return Number.isFinite(value) ? value : null;
}

export function SignalFollowTailDatasetCard() {
  const [universes, setUniverses] = useState<UniverseMeta[]>([]);
  const [universeId, setUniverseId] = useState<string>(() => localStorage.getItem(UNIVERSE_STORAGE_KEY) ?? "");
  const [startInput, setStartInput] = useState<string>(() => localStorage.getItem(START_DATE_STORAGE_KEY) ?? toDatetimeLocal(Date.now() - 24 * 60 * 60_000));
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem(RECEIVE_JOB_STORAGE_KEY));
  const [job, setJob] = useState<ReceiveDataJob | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await listUniverses();
        if (!active) return;
        setUniverses(Array.isArray(res.universes) ? res.universes : []);
      } catch {
        if (!active) return;
        setUniverses([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const poll = () => {
      void (async () => {
        try {
          const res = await getReceiveDataJob(jobId);
          if (!active) return;
          setJob(res.job);
          if (res.job.status === "done") {
            const datasetCache = res.datasetCache ?? res.job.id;
            safeSetStorage(DATASET_CACHE_STORAGE_KEY, datasetCache);
          }
          if (res.job.status === "done" || res.job.status === "error" || res.job.status === "cancelled") {
            setJobId(null);
            localStorage.removeItem(RECEIVE_JOB_STORAGE_KEY);
          }
        } catch (e: any) {
          if (!active) return;
          setError(String(e?.message ?? e));
          setJobId(null);
          localStorage.removeItem(RECEIVE_JOB_STORAGE_KEY);
        }
      })();
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobId]);

  const running = job?.status === "queued" || job?.status === "running";

  async function onReceive() {
    setError("");
    const startMs = fromDatetimeLocal(startInput);
    const endMs = Date.now();
    if (!universeId) {
      setError("Universe is required.");
      return;
    }
    if (!startMs || endMs <= startMs) {
      setError("Start date must be in the past.");
      return;
    }
    try {
      safeSetStorage(START_DATE_STORAGE_KEY, startInput);
      safeSetStorage(UNIVERSE_STORAGE_KEY, universeId);
      const started = await startReceiveData({
        universeId,
        interval: "1",
        range: {
          kind: "manual",
          startMs,
          endMs,
        },
      });
      setJobId(started.jobId);
      safeSetStorage(RECEIVE_JOB_STORAGE_KEY, started.jobId);
      setJob({
        id: started.jobId,
        status: "queued",
        progress: { pct: 0, completedSteps: 0, totalSteps: 0 },
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onCancel() {
    if (!jobId) return;
    try {
      await cancelReceiveDataJob(jobId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  return (
    <Card className="mb-2">
      <Card.Header><b>Follow Tail dataset initialization</b></Card.Header>
      <Card.Body>
        <div className="d-flex flex-wrap align-items-end gap-2">
          <div style={{ flex: "1 1 340px" }}>
            <Form.Group>
              <Form.Label style={{ fontSize: 12 }}>Universe</Form.Label>
              <Form.Select value={universeId} onChange={(e) => setUniverseId(e.currentTarget.value)} disabled={running}>
                <option value="">Not selected</option>
                {universes.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Form.Select>
            </Form.Group>
          </div>
          <div style={{ flex: "1 1 340px" }}>
            <Form.Group>
              <Form.Label style={{ fontSize: 12 }}>Start date</Form.Label>
              <Form.Control
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.currentTarget.value)}
                disabled={running}
              />
            </Form.Group>
          </div>
          <div className="d-flex gap-2 ms-auto align-self-end">
            <Button onClick={() => void onReceive()} disabled={running}>Build baseline</Button>
            {running ? <Button variant="outline-secondary" onClick={() => void onCancel()}>Cancel</Button> : null}
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 mt-1">
          <div style={{ flex: "1 1 340px" }}>
            <Form.Text muted>Select symbols for baseline and tail recording.</Form.Text>
          </div>
          <div style={{ flex: "1 1 340px" }}>
            <Form.Text muted>Data window is fixed: from start date to now. Baseline is requested with 1m interval (optimizer source).</Form.Text>
          </div>
          <div style={{ width: running ? 212 : 119 }} />
        </div>

        <CenteredProgressBar now={job?.progress?.pct ?? 0} showPercent className="mt-2" />
        {job ? <div style={{ fontSize: 12, marginTop: 6 }}>{formatReceiveProgressLine(job)}</div> : null}
        {error ? <div style={{ color: "#b00020", marginTop: 6, fontSize: 12 }}>{error}</div> : null}
      </Card.Body>
    </Card>
  );
}
