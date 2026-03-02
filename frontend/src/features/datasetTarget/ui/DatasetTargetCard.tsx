import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import { setDatasetTarget, getDatasetTarget, type DatasetRangePreset, type DatasetTarget } from "../api/datasetTargetApi";
import { listUniverses } from "../../universe/api";
import type { UniverseMeta } from "../../universe/types";
import { cancelReceiveDataJob, getReceiveDataJob, startReceiveData, type ReceiveDataJob } from "../../dataReceive/api/dataReceiveApi";
import { CenteredProgressBar } from "../../../shared/ui/CenteredProgressBar";

type DraftState = {
  universeId: string | null;
  rangeKind: "preset" | "manual";
  preset: DatasetRangePreset;
  manualStart: string;
  manualEnd: string;
};

const STORAGE_KEY = "datasetTargetDraft";
const RECEIVE_JOB_STORAGE_KEY = "receiveDataJobId";
const PRESETS: DatasetRangePreset[] = ["24h", "48h", "1w", "2w", "4w", "1mo"];
const SAVE_DEBOUNCE_MS = 400;

function toDatetimeLocal(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const offsetMs = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(input: string): number | null {
  if (!input) return null;
  const ms = new Date(input).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function defaultDraft(): DraftState {
  const now = Date.now();
  return {
    universeId: null,
    rangeKind: "preset",
    preset: "24h",
    manualStart: toDatetimeLocal(now - 24 * 60 * 60 * 1000),
    manualEnd: toDatetimeLocal(now),
  };
}

function draftFromTarget(target: DatasetTarget): DraftState {
  const base = defaultDraft();
  if (target.range.kind === "preset") {
    return {
      ...base,
      universeId: target.universeId,
      rangeKind: "preset",
      preset: target.range.preset,
    };
  }
  return {
    ...base,
    universeId: target.universeId,
    rangeKind: "manual",
    manualStart: toDatetimeLocal(target.range.startMs),
    manualEnd: toDatetimeLocal(target.range.endMs),
  };
}

function parseStoredDraft(raw: string | null): DraftState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    const defaults = defaultDraft();
    const preset = typeof parsed.preset === "string" && PRESETS.includes(parsed.preset as DatasetRangePreset)
      ? (parsed.preset as DatasetRangePreset)
      : "24h";
    const rangeKind = parsed.rangeKind === "manual" ? "manual" : "preset";
    const universeId = typeof parsed.universeId === "string" && parsed.universeId.trim() ? parsed.universeId : null;
    const manualStart = typeof parsed.manualStart === "string" ? parsed.manualStart : defaults.manualStart;
    const manualEnd = typeof parsed.manualEnd === "string" ? parsed.manualEnd : defaults.manualEnd;
    return { universeId, rangeKind, preset, manualStart, manualEnd };
  } catch {
    return null;
  }
}



type SavePayload =
  | { universeId: string | null; range: { kind: "preset"; preset: DatasetRangePreset } }
  | { universeId: string | null; range: { kind: "manual"; startMs: number; endMs: number } };

function buildSavePayload(draft: DraftState): SavePayload | null {
  if (draft.rangeKind === "preset") {
    return {
      universeId: draft.universeId,
      range: { kind: "preset", preset: draft.preset },
    };
  }
  const startMs = fromDatetimeLocal(draft.manualStart);
  const endMs = fromDatetimeLocal(draft.manualEnd);
  if (startMs == null || endMs == null || endMs <= startMs) return null;
  return {
    universeId: draft.universeId,
    range: { kind: "manual", startMs, endMs },
  };
}
export default function DatasetTargetCard() {
  const [universes, setUniverses] = useState<UniverseMeta[]>([]);
  const [draft, setDraft] = useState<DraftState>(() => defaultDraft());
  const [loadingInit, setLoadingInit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiveJobId, setReceiveJobId] = useState<string | null>(null);
  const [receiveJob, setReceiveJob] = useState<ReceiveDataJob | null>(null);
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
    let active = true;
    void (async () => {
      const local = parseStoredDraft(window.localStorage.getItem(STORAGE_KEY));
      if (local) {
        if (active) setDraft(local);
        if (active) setLoadingInit(false);
        return;
      }
      try {
        const res = await getDatasetTarget();
        if (!active) return;
        const next = draftFromTarget(res.datasetTarget);
        setDraft(next);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        if (!active) return;
        const fallback = defaultDraft();
        setDraft(fallback);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
      } finally {
        if (active) setLoadingInit(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loadingInit) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft, loadingInit]);

  const savePayload = useMemo(() => buildSavePayload(draft), [draft]);
  const lastSavedPayloadRef = useRef<string>("");

  useEffect(() => {
    if (loadingInit || !savePayload) {
      setSaving(false);
      return;
    }
    const payloadKey = JSON.stringify(savePayload);
    if (lastSavedPayloadRef.current === payloadKey) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          const res = await setDatasetTarget(savePayload);
          if (!active) return;
          const next = draftFromTarget(res.datasetTarget);
          const normalizedPayload = buildSavePayload(next);
          if (normalizedPayload) {
            lastSavedPayloadRef.current = JSON.stringify(normalizedPayload);
          }
          setDraft(next);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (e: any) {
          if (!active) return;
          setError(String(e?.message ?? e));
        } finally {
          if (active) setSaving(false);
        }
      })();
    }, SAVE_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadingInit, savePayload]);

  useEffect(() => {
    const storedJobId = window.localStorage.getItem(RECEIVE_JOB_STORAGE_KEY);
    if (!storedJobId) return;
    setReceiveJobId(storedJobId);
  }, []);

  useEffect(() => {
    if (!receiveJobId) return;
    let active = true;
    const fetchJob = () => {
      void (async () => {
        try {
          const res = await getReceiveDataJob(receiveJobId);
          if (!active) return;
          setReceiveJob(res.job);
          if (res.job.status === "done" || res.job.status === "error" || res.job.status === "cancelled") {
            setReceiveJobId(null);
            window.localStorage.removeItem(RECEIVE_JOB_STORAGE_KEY);
          }
        } catch (e: any) {
          if (!active) return;
          setReceiveJobId(null);
          window.localStorage.removeItem(RECEIVE_JOB_STORAGE_KEY);
          setError(String(e?.message ?? e));
        }
      })();
    };
    fetchJob();
    const timer = window.setInterval(fetchJob, 400);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [receiveJobId]);

  const receiveRunning = receiveJob?.status === "queued" || receiveJob?.status === "running";

  async function onReceiveData() {
    if (receiveRunning) return;
    setError("");
    try {
      const started = await startReceiveData();
      setReceiveJobId(started.jobId);
      window.localStorage.setItem(RECEIVE_JOB_STORAGE_KEY, started.jobId);
      setReceiveJob({
        id: started.jobId,
        status: "queued",
        progress: { pct: 0, completedSteps: 0, totalSteps: 0 },
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setReceiveJobId(null);
      window.localStorage.removeItem(RECEIVE_JOB_STORAGE_KEY);
    }
  }

  async function onCancelReceive() {
    if (!receiveJobId) return;
    try {
      await cancelReceiveDataJob(receiveJobId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  return (
    <Card className="mb-2">
      <Card.Header>
        <b>Dataset Target</b>
      </Card.Header>
      <Card.Body>
        <Row className="g-2 align-items-end">
          <Col xl={3} lg={3} md={6} sm={6} xs={12}>
            <Form.Group>
              <Form.Label style={{ fontSize: 12 }}>Universe</Form.Label>
              <Form.Select
                value={draft.universeId ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, universeId: e.currentTarget.value || null }))}
              >
                <option value="">Not selected</option>
                {universes.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col xl={2} lg={2} md={6} sm={6} xs={12}>
            <Form.Group>
              <Form.Label style={{ fontSize: 12 }}>Range mode</Form.Label>
              <Form.Select
                value={draft.rangeKind}
                onChange={(e) => setDraft((prev) => ({ ...prev, rangeKind: e.currentTarget.value === "manual" ? "manual" : "preset" }))}
              >
                <option value="preset">Preset</option>
                <option value="manual">Manual</option>
              </Form.Select>
            </Form.Group>
          </Col>

          {draft.rangeKind === "preset" ? (
            <Col xl={2} lg={2} md={6} sm={6} xs={12}>
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>Preset</Form.Label>
                <Form.Select
                  value={draft.preset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, preset: e.currentTarget.value as DatasetRangePreset }))}
                >
                  {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
          ) : (
            <>
              <Col xl={2} lg={2} md={6} sm={6} xs={12}>
                <Form.Group>
                  <Form.Label style={{ fontSize: 12 }}>Start</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={draft.manualStart}
                    onChange={(e) => setDraft((prev) => ({ ...prev, manualStart: e.currentTarget.value }))}
                  />
                </Form.Group>
              </Col>
              <Col xl={2} lg={2} md={6} sm={6} xs={12}>
                <Form.Group>
                  <Form.Label style={{ fontSize: 12 }}>End</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={draft.manualEnd}
                    onChange={(e) => setDraft((prev) => ({ ...prev, manualEnd: e.currentTarget.value }))}
                  />
                </Form.Group>
              </Col>
            </>
          )}

          <Col xl={3} lg={3} md={12} sm={12} xs={12}>
            <div className="d-flex gap-2">
              <Button variant="primary" onClick={() => void onReceiveData()} disabled={receiveRunning || saving || loadingInit}>
                {receiveRunning ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Receive Data
              </Button>
              {(receiveJob?.status === "queued" || receiveJob?.status === "running") ? (
                <Button variant="outline-secondary" onClick={() => void onCancelReceive()}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </Col>
        </Row>
        <div style={{ marginTop: 10, minHeight: 48 }}>
          <CenteredProgressBar
            now={receiveJob?.progress.pct ?? 0}
            label={`${(receiveJob?.progress.pct ?? 0).toFixed(2)}%`}
          />
          <div style={{ fontSize: 12, marginTop: 6, minHeight: 18 }}>
            {receiveJob ? [receiveJob.progress.currentSymbol, receiveJob.progress.message].filter(Boolean).join(" — ") : ""}
          </div>
        </div>
        {error ? <div style={{ color: "#b02a37", marginTop: 8, fontSize: 12 }}>{error}</div> : null}
      </Card.Body>
    </Card>
  );
}
