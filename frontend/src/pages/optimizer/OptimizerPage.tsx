import { memo, type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Container, Form, Pagination, ProgressBar, Spinner, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeed } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import {
  getJobResults,
  getJobStatus,
  getStatus,
  listTapes,
  runOptimizationJob,
  startTape,
  stopTape,
  type OptimizationResult,
  type OptimizerSortDir,
  type OptimizerSortKey,
} from "../../features/optimizer/api/optimizerApi";

type RangeKey = "priceTh" | "oivTh" | "tp" | "sl" | "offset";
type RangeState = Record<RangeKey, { min: string; max: string }>;

const RANGE_DEFAULTS: RangeState = {
  priceTh: { min: "0.5", max: "6" },
  oivTh: { min: "0.5", max: "15" },
  tp: { min: "2", max: "12" },
  sl: { min: "2", max: "12" },
  offset: { min: "0", max: "1" },
};

const pageSize = 50;
const RANGES_STORAGE_KEY = "bots_dev.optimizer.ranges";

type TapeRow = { id: string; createdAt: number; symbolsCount: number; tf: number | null };

const TapesTable = memo(function TapesTable({
  isRecording,
  selectedTapeId,
  onSelectTape,
  refreshKey,
  recordingTapeId,
  onError,
}: {
  isRecording: boolean;
  selectedTapeId: string;
  onSelectTape: (id: string) => void;
  refreshKey: number;
  recordingTapeId: string | null;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TapeRow[]>([]);
  const [sizeById, setSizeById] = useState<Record<string, number>>({});

  async function fetchTapes() {
    setLoading(true);
    try {
      const res = await listTapes();
      const nextTapes = res.tapes ?? [];
      setRows((prev) => {
        const prevById = new Map(prev.map((r) => [r.id, r]));
        return nextTapes.map((t) => {
          const next: TapeRow = {
            id: t.id,
            createdAt: t.createdAt,
            symbolsCount: Array.isArray(t.meta?.symbols) ? t.meta.symbols.length : 0,
            tf: t.meta?.klineTfMin ?? null,
          };
          const old = prevById.get(t.id);
          if (!old) return next;
          if (old.createdAt === next.createdAt && old.symbolsCount === next.symbolsCount && old.tf === next.tf) return old;
          return next;
        });
      });
      setSizeById(() => {
        const next: Record<string, number> = {};
        for (const t of nextTapes) next[t.id] = Number(t.fileSizeBytes) || 0;
        return next;
      });
      if (!selectedTapeId && recordingTapeId) onSelectTape(recordingTapeId);
    } catch (e: any) {
      onError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchTapes();
  }, [refreshKey]);

  useEffect(() => {
    if (!isRecording) return;
    const intervalId = window.setInterval(() => {
      void fetchTapes();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
        <Spinner animation="border" size="sm" /> loading...
      </div>
    );
  }

  return (
    <Table striped bordered hover size="sm" className="mb-3">
      <thead>
        <tr>
          <th style={{ width: 50 }}>Use</th>
          <th>id</th>
          <th>createdAt</th>
          <th>symbolsCount</th>
          <th>tf</th>
          <th>size</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td>
              <Form.Check
                type="radio"
                name="selectedTape"
                checked={selectedTapeId === t.id}
                onChange={() => onSelectTape(t.id)}
              />
            </td>
            <td style={{ fontSize: 12 }}>{t.id}</td>
            <td style={{ fontSize: 12 }}>{new Date(t.createdAt).toLocaleString()}</td>
            <td style={{ fontSize: 12 }}>{t.symbolsCount}</td>
            <td style={{ fontSize: 12 }}>{t.tf ?? "-"}</td>
            <td style={{ fontSize: 12 }}>{formatSize(sizeById[t.id] ?? 0)}</td>
          </tr>
        ))}
        {!rows.length ? (
          <tr>
            <td colSpan={6} style={{ fontSize: 12, opacity: 0.75 }}>No tapes</td>
          </tr>
        ) : null}
      </tbody>
    </Table>
  );
});

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseMaybeNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isValidRangeState(value: unknown): value is RangeState {
  if (!value || typeof value !== "object") return false;
  const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset"];
  for (const key of keys) {
    const row = (value as Record<string, any>)[key];
    if (!row || typeof row !== "object") return false;
    if (typeof row.min !== "string" || typeof row.max !== "string") return false;
  }
  return true;
}

function loadSavedRanges(): RangeState {
  try {
    const raw = localStorage.getItem(RANGES_STORAGE_KEY);
    if (!raw) return RANGE_DEFAULTS;
    const parsed = JSON.parse(raw) as unknown;
    return isValidRangeState(parsed) ? parsed : RANGE_DEFAULTS;
  } catch {
    return RANGE_DEFAULTS;
  }
}

function quantizeTo3(value: number): number {
  return Number((Math.round(value / 0.001) * 0.001).toFixed(3));
}

export function OptimizerPage() {
  const { conn, lastServerTime, wsUrl, streams } = useWsFeed();
  const { status, busy, start, stop, canStart, canStop } = useSessionRuntime();

  const [selectedTapeId, setSelectedTapeId] = useState<string>("");
  const [recordingTapeId, setRecordingTapeId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [tapesRefreshKey, setTapesRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const [results, setResults] = useState<OptimizationResult[]>([]);
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [sortKey, setSortKey] = useState<OptimizerSortKey>("netPnl");
  const [sortDir, setSortDir] = useState<OptimizerSortDir>("desc");

  const [ranges, setRanges] = useState<RangeState>(RANGE_DEFAULTS);
  const [rangesSaved, setRangesSaved] = useState(false);

  async function refreshStatus() {
    try {
      const statusRes = await getStatus();
      setIsRecording(Boolean(statusRes.isRecording));
      setRecordingTapeId(statusRes.tapeId ?? null);
      if (statusRes.tapeId) setSelectedTapeId((prev) => prev || statusRes.tapeId || "");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    setRanges(loadSavedRanges());
    void refreshStatus();
    setTapesRefreshKey((prev) => prev + 1);
  }, []);

  async function onStartRecording() {
    setError(null);
    try {
      const res = await startTape();
      setIsRecording(true);
      setRecordingTapeId(res.tapeId);
      setSelectedTapeId(res.tapeId);
      setTapesRefreshKey((prev) => prev + 1);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onStopRecording() {
    setError(null);
    try {
      await stopTape();
      setIsRecording(false);
      setRecordingTapeId(null);
      setTapesRefreshKey((prev) => prev + 1);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  const rangeError = useMemo(() => {
    const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset"];
    for (const key of keys) {
      const minText = ranges[key].min;
      const maxText = ranges[key].max;
      const min = parseMaybeNumber(minText);
      const max = parseMaybeNumber(maxText);
      if (minText.trim() && min === undefined) return `${key} min must be a valid number`;
      if (maxText.trim() && max === undefined) return `${key} max must be a valid number`;
      if (min !== undefined && max !== undefined && min > max) return `${key} min must be less than or equal to max`;
    }
    return null;
  }, [ranges]);

  function buildRangesPayload() {
    const payload: Partial<Record<RangeKey, { min: number; max: number }>> = {};
    const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset"];
    for (const key of keys) {
      const min = parseMaybeNumber(ranges[key].min);
      const max = parseMaybeNumber(ranges[key].max);
      if (min !== undefined && max !== undefined) {
        payload[key] = { min, max };
      }
    }
    return payload;
  }

  const onRangeChange =
    (key: RangeKey, bound: "min" | "max") => (e: ChangeEvent<HTMLInputElement>) => {
      const nextValue = e.currentTarget.value;
      setRangesSaved(false);
      setRanges((prev) => ({
        ...prev,
        [key]: { ...prev[key], [bound]: nextValue },
      }));
    };

  function onSaveRanges() {
    if (rangeError) return;
    localStorage.setItem(RANGES_STORAGE_KEY, JSON.stringify(ranges));
    setRangesSaved(true);
  }

  async function fetchResults(nextPage: number, nextSortKey: OptimizerSortKey, nextSortDir: OptimizerSortDir, activeJobId: string) {
    const res = await getJobResults(activeJobId, { page: nextPage, sortKey: nextSortKey, sortDir: nextSortDir });
    setResults(res.results ?? []);
    setPage(res.page);
    setTotalRows(res.totalRows);
  }

  async function onRunOptimization() {
    if (!selectedTapeId || rangeError) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setPage(1);
    setTotalRows(0);
    setDone(0);
    setTotal(0);
    try {
      const rangePayload = buildRangesPayload();
      const runRes = await runOptimizationJob({
        tapeId: selectedTapeId,
        candidates: Number(candidates),
        seed: Number(seed),
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
      });
      setJobId(runRes.jobId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!jobId || !running) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await getJobStatus(jobId);
        setDone(res.done);
        setTotal(res.total);
        if (res.status === "error") {
          setRunning(false);
          setError(res.message ?? "Optimization job failed.");
        }
        if (res.status === "done") {
          window.clearInterval(timer);
          setRunning(false);
          await fetchResults(1, sortKey, sortDir, jobId);
        }
      } catch (e: any) {
        setRunning(false);
        setError(String(e?.message ?? e));
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [jobId, running, sortDir, sortKey]);

  async function onSort(nextSortKey: OptimizerSortKey) {
    if (!jobId) return;
    const nextSortDir: OptimizerSortDir = sortKey === nextSortKey && sortDir === "desc" ? "asc" : "desc";
    setSortKey(nextSortKey);
    setSortDir(nextSortDir);
    await fetchResults(1, nextSortKey, nextSortDir, jobId);
  }

  async function onPageChange(nextPage: number) {
    if (!jobId) return;
    await fetchResults(nextPage, sortKey, sortDir, jobId);
  }

  function copyToSettings(row: OptimizationResult) {
    const patch = {
      source: "optimizer",
      ts: Date.now(),
      tapeId: selectedTapeId,
      jobId,
      rank: row.rank,
      patch: {
        signals: {
          priceThresholdPct: quantizeTo3(row.params.priceThresholdPct),
          oivThresholdPct: quantizeTo3(row.params.oivThresholdPct),
        },
        paper: {
          tpRoiPct: quantizeTo3(row.params.tpRoiPct),
          slRoiPct: quantizeTo3(row.params.slRoiPct),
          entryOffsetPct: quantizeTo3(row.params.entryOffsetPct),
        },
      },
    };
    localStorage.setItem("bots_dev.pendingConfigPatch", JSON.stringify(patch));
  }

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const progressPct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

  return (
    <>
      <HeaderBar
        conn={conn}
        sessionState={status.sessionState}
        wsUrl={wsUrl}
        lastServerTime={lastServerTime}
        streams={streams}
        canStart={canStart}
        canStop={canStop}
        busy={busy}
        onStart={() => void start()}
        onStop={() => void stop()}
      />

      <Container fluid className="py-2 px-2">
        <Card>
          <Card.Header className="d-flex align-items-center justify-content-between">
            <b>Optimizer</b>
            <Button size="sm" variant="outline-secondary" onClick={() => setTapesRefreshKey((prev) => prev + 1)}>
              Refresh tapes
            </Button>
          </Card.Header>
          <Card.Body>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <h6>Tape recording</h6>
            <div className="d-flex align-items-center gap-2 mb-2">
              <Button size="sm" onClick={() => void onStartRecording()} disabled={isRecording}>Start recording</Button>
              <Button size="sm" variant="outline-danger" onClick={() => void onStopRecording()} disabled={!isRecording}>Stop recording</Button>
              <span style={{ fontSize: 12 }}>
                recording: <b>{isRecording ? "ON" : "OFF"}</b>
                {recordingTapeId ? ` · ${recordingTapeId}` : ""}
              </span>
            </div>

            <TapesTable
              isRecording={isRecording}
              selectedTapeId={selectedTapeId}
              onSelectTape={setSelectedTapeId}
              refreshKey={tapesRefreshKey}
              recordingTapeId={recordingTapeId}
              onError={setError}
            />

            <h6>Optimization</h6>
            <div className="d-flex gap-2 align-items-end mb-2 flex-wrap">
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>candidates</Form.Label>
                <Form.Control value={candidates} onChange={(e) => setCandidates(e.currentTarget.value)} type="number" min={1} max={2000} />
              </Form.Group>
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>seed</Form.Label>
                <Form.Control value={seed} onChange={(e) => setSeed(e.currentTarget.value)} type="number" />
              </Form.Group>
              <Button onClick={() => void onRunOptimization()} disabled={!selectedTapeId || running || Boolean(rangeError)}>
                Run optimization
              </Button>
            </div>

            <h6>Ranges</h6>
            <Table bordered size="sm" className="mb-2" style={{ maxWidth: 620 }}>
              <thead>
                <tr>
                  <th>Param</th>
                  <th>Min</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                {(["priceTh", "oivTh", "tp", "sl", "offset"] as RangeKey[]).map((key) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>
                      <Form.Control
                        size="sm"
                        value={ranges[key].min}
                        onChange={onRangeChange(key, "min")}
                      />
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        value={ranges[key].max}
                        onChange={onRangeChange(key, "max")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {rangeError ? <div style={{ color: "#b00020", fontSize: 12, marginBottom: 8 }}>{rangeError}</div> : null}
            <div className="d-flex align-items-center gap-2 mb-2">
              <Button size="sm" variant="outline-secondary" onClick={onSaveRanges} disabled={Boolean(rangeError)}>Save</Button>
              {rangesSaved ? <span style={{ fontSize: 12, opacity: 0.8 }}>Saved</span> : null}
            </div>

            {selectedTapeId ? <div style={{ fontSize: 12, marginBottom: 8 }}>selected tape: <b>{selectedTapeId}</b></div> : null}

            {jobId ? <ProgressBar now={running ? progressPct : 100} label={`${running ? done : 100}/${total || 100}`} className="mb-2" /> : null}

            <Table striped bordered hover size="sm">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("netPnl")}>netPnl</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("trades")}>trades</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("winRatePct")}>winRate</th>
                  <th>params</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const paramsText = `priceTh=${r.params.priceThresholdPct.toFixed(3)} oivTh=${r.params.oivThresholdPct.toFixed(3)} tp=${r.params.tpRoiPct.toFixed(3)} sl=${r.params.slRoiPct.toFixed(3)} offset=${r.params.entryOffsetPct.toFixed(3)}`;
                  return (
                    <tr key={`${r.rank}-${r.netPnl}`}>
                      <td>{r.rank}</td>
                      <td>{r.netPnl.toFixed(4)}</td>
                      <td>{r.trades}</td>
                      <td>{r.winRatePct.toFixed(2)}%</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span style={{ fontSize: 12 }}>{paramsText}</span>
                          <Button size="sm" variant="outline-secondary" onClick={() => copyToSettings(r)}>Copy to settings</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!results.length ? (
                  <tr>
                    <td colSpan={5} style={{ fontSize: 12, opacity: 0.75 }}>No results</td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
            {results.length ? (
              <Pagination>
                <Pagination.Prev onClick={() => void onPageChange(Math.max(1, page - 1))} disabled={page <= 1} />
                <Pagination.Item active>{page}</Pagination.Item>
                <Pagination.Next onClick={() => void onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} />
              </Pagination>
            ) : null}
          </Card.Body>
        </Card>
      </Container>
    </>
  );
}
