import { memo, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Container, Form, Modal, Pagination, ProgressBar, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeed } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import {
  getJobResults,
  getJobStatus,
  cancelCurrentJob,
  getCurrentJob,
  getSettings,
  getStatus,
  listTapes,
  runOptimizationJob,
  setSettings,
  startTape,
  stopTape,
  type OptimizationResult,
  type OptimizerPrecision,
  type OptimizerSortDir,
  type OptimizerSortKeyExtended,
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
const CANDIDATES_STORAGE_KEY = "bots_dev.optimizer.candidates";
const SEED_STORAGE_KEY = "bots_dev.optimizer.seed";
const DIRECTION_STORAGE_KEY = "bots_dev.optimizer.directionMode";
const RANGES_SAVE_DEBOUNCE_MS = 400;
const DEFAULT_PRECISION: OptimizerPrecision = { priceTh: 3, oivTh: 3, tp: 3, sl: 3, offset: 3 };

type TapeRow = { id: string; createdAt: number; symbolsCount: number; tf: number | null; initialBytes: number };

const TapeSizeCell = memo(function TapeSizeCell({
  tapeId,
  initialBytes,
  pollActive,
}: {
  tapeId: string;
  initialBytes: number;
  pollActive: boolean;
}) {
  const [bytes, setBytes] = useState(initialBytes);

  useEffect(() => {
    setBytes(initialBytes);
  }, [initialBytes]);

  useEffect(() => {
    if (!pollActive) return;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const res = await listTapes();
          const next = (res.tapes ?? []).find((t) => t.id === tapeId);
          if (!next) return;
          setBytes(Number(next.fileSizeBytes) || 0);
        } catch {
          return;
        }
      })();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [pollActive, tapeId]);

  return <>{formatSize(bytes)}</>;
});

const TapeTableRow = memo(function TapeTableRow({
  tape,
  checked,
  onToggleTape,
  isRecording,
  recordingTapeId,
}: {
  tape: TapeRow;
  checked: boolean;
  onToggleTape: (id: string, checked: boolean) => void;
  isRecording: boolean;
  recordingTapeId: string | null;
}) {
  const onCheckChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onToggleTape(tape.id, e.currentTarget.checked);
    },
    [onToggleTape, tape.id]
  );

  return (
    <tr>
      <td>
        <Form.Check type="checkbox" checked={checked} onChange={onCheckChange} />
      </td>
      <td style={{ fontSize: 12 }}>{tape.id}</td>
      <td style={{ fontSize: 12 }}>{new Date(tape.createdAt).toLocaleString()}</td>
      <td style={{ fontSize: 12 }}>{tape.symbolsCount}</td>
      <td style={{ fontSize: 12 }}>{tape.tf ?? "-"}</td>
      <td style={{ fontSize: 12 }}>
        <TapeSizeCell
          tapeId={tape.id}
          initialBytes={tape.initialBytes}
          pollActive={Boolean(isRecording && recordingTapeId === tape.id)}
        />
      </td>
    </tr>
  );
});

const TapesTable = memo(function TapesTable({
  isRecording,
  selectedTapeIds,
  onToggleTape,
  refreshKey,
  recordingTapeId,
  onError,
}: {
  isRecording: boolean;
  selectedTapeIds: string[];
  onToggleTape: (id: string, checked: boolean) => void;
  refreshKey: number;
  recordingTapeId: string | null;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<TapeRow[]>([]);

  const fetchTapes = useCallback(async () => {
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
            initialBytes: Number(t.fileSizeBytes) || 0,
          };
          const old = prevById.get(t.id);
          if (!old) return next;
          if (old.createdAt === next.createdAt && old.symbolsCount === next.symbolsCount && old.tf === next.tf && old.initialBytes === next.initialBytes) return old;
          return next;
        });
      });
    } catch (e: any) {
      onError(String(e?.message ?? e));
    }
  }, [onError]);

  useEffect(() => {
    void fetchTapes();
  }, [fetchTapes, refreshKey]);

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
          <TapeTableRow
            key={t.id}
            tape={t}
            checked={selectedTapeIds.includes(t.id)}
            onToggleTape={onToggleTape}
            isRecording={isRecording}
            recordingTapeId={recordingTapeId}
          />
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

function countDecimals(value: string): number {
  const text = value.trim();
  if (!text.includes(".")) return 0;
  return text.split(".")[1]?.length ?? 0;
}

function quantizeByPrecision(value: number, precision: number): number {
  const step = 10 ** (-precision);
  return Number((Math.round(value / step) * step).toFixed(precision));
}

function loadStoredPositiveInt(key: string, fallback: string, min: number): string {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= min) return String(n);
    return fallback;
  } catch {
    return fallback;
  }
}

export function OptimizerPage() {
  const { conn, lastServerTime, wsUrl, streams } = useWsFeed();
  const { status, busy, start, stop, canStart, canStop } = useSessionRuntime();

  const [selectedTapeIds, setSelectedTapeIds] = useState<string[]>([]);
  const [recordingTapeId, setRecordingTapeId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [tapesRefreshKey, setTapesRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [directionMode, setDirectionMode] = useState<"both" | "long" | "short">("both");
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const [results, setResults] = useState<OptimizationResult[]>([]);
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [sortKey, setSortKey] = useState<OptimizerSortKeyExtended>("netPnl");
  const [sortDir, setSortDir] = useState<OptimizerSortDir>("desc");
  const [jobPrecisionById, setJobPrecisionById] = useState<Record<string, OptimizerPrecision>>({});
  const [tapesDir, setTapesDir] = useState("");
  const [showTapesDirModal, setShowTapesDirModal] = useState(false);
  const [tapesDirDraft, setTapesDirDraft] = useState("");

  const [ranges, setRanges] = useState<RangeState>(RANGE_DEFAULTS);
  const rangesSaveTimerRef = useRef<number | null>(null);

  async function refreshStatus() {
    try {
      const statusRes = await getStatus();
      setIsRecording(Boolean(statusRes.isRecording));
      setRecordingTapeId(statusRes.tapeId ?? null);
      if (statusRes.tapeId) {
        setSelectedTapeIds((prev) => (prev.includes(statusRes.tapeId as string) ? prev : [...prev, statusRes.tapeId as string]));
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    setRanges(loadSavedRanges());
    setCandidates(loadStoredPositiveInt(CANDIDATES_STORAGE_KEY, "200", 1));
    setSeed(loadStoredPositiveInt(SEED_STORAGE_KEY, "1", 0));
    const savedDirection = localStorage.getItem(DIRECTION_STORAGE_KEY);
    if (savedDirection === "long" || savedDirection === "short" || savedDirection === "both") setDirectionMode(savedDirection);
    void refreshStatus();
    setTapesRefreshKey((prev) => prev + 1);
    void (async () => {
      try {
        const settings = await getSettings();
        setTapesDir(settings.tapesDir);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
    void (async () => {
      try {
        const current = await getCurrentJob();
        if (!current.jobId) return;
        setJobId(current.jobId);
        const statusRes = await getJobStatus(current.jobId);
        setDone(statusRes.done);
        setTotal(statusRes.total);
        if (statusRes.status === "running") {
          setRunning(true);
          return;
        }
        if (statusRes.status === "done" || statusRes.status === "cancelled") {
          setRunning(false);
          await fetchResults(1, sortKey, sortDir, current.jobId);
          return;
        }
        setRunning(false);
        setError(statusRes.message ?? "Optimization job failed.");
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  useEffect(() => {
    const n = Math.floor(Number(candidates));
    if (!Number.isFinite(n) || n < 1) return;
    localStorage.setItem(CANDIDATES_STORAGE_KEY, String(n));
  }, [candidates]);

  useEffect(() => {
    const n = Math.floor(Number(seed));
    if (!Number.isFinite(n) || n < 0) return;
    localStorage.setItem(SEED_STORAGE_KEY, String(n));
  }, [seed]);

  useEffect(() => {
    localStorage.setItem(DIRECTION_STORAGE_KEY, directionMode);
  }, [directionMode]);

  async function onStartRecording() {
    setError(null);
    try {
      const res = await startTape();
      setIsRecording(true);
      setRecordingTapeId(res.tapeId);
      setSelectedTapeIds((prev) => (prev.includes(res.tapeId) ? prev : [...prev, res.tapeId]));
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
      setRanges((prev) => ({
        ...prev,
        [key]: { ...prev[key], [bound]: nextValue },
      }));
    };

  useEffect(() => {
    if (rangeError) return;
    if (rangesSaveTimerRef.current != null) {
      window.clearTimeout(rangesSaveTimerRef.current);
    }
    rangesSaveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(RANGES_STORAGE_KEY, JSON.stringify(ranges));
      rangesSaveTimerRef.current = null;
    }, RANGES_SAVE_DEBOUNCE_MS);
    return () => {
      if (rangesSaveTimerRef.current != null) {
        window.clearTimeout(rangesSaveTimerRef.current);
        rangesSaveTimerRef.current = null;
      }
    };
  }, [rangeError, ranges]);

  const onToggleTape = useCallback((id: string, checked: boolean) => {
    setSelectedTapeIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((v) => v !== id);
    });
  }, []);

  async function fetchResults(nextPage: number, nextSortKey: OptimizerSortKeyExtended, nextSortDir: OptimizerSortDir, activeJobId: string) {
    const res = await getJobResults(activeJobId, { page: nextPage, sortKey: nextSortKey, sortDir: nextSortDir });
    setResults(res.results ?? []);
    setPage(res.page);
    setTotalRows(res.totalRows);
  }

  async function onRunOptimization() {
    if (!selectedTapeIds.length || rangeError) return;
    setRunning(true);
    setError(null);
    setDone(0);
    setTotal(0);
    try {
      const rangePayload = buildRangesPayload();
      const precision: OptimizerPrecision = {
        priceTh: Math.max(countDecimals(ranges.priceTh.min), countDecimals(ranges.priceTh.max)),
        oivTh: Math.max(countDecimals(ranges.oivTh.min), countDecimals(ranges.oivTh.max)),
        tp: Math.max(countDecimals(ranges.tp.min), countDecimals(ranges.tp.max)),
        sl: Math.max(countDecimals(ranges.sl.min), countDecimals(ranges.sl.max)),
        offset: Math.max(countDecimals(ranges.offset.min), countDecimals(ranges.offset.max)),
      };
      const runRes = await runOptimizationJob({
        tapeIds: selectedTapeIds,
        candidates: Number(candidates),
        seed: Number(seed),
        directionMode,
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
        precision,
      });
      setJobId(runRes.jobId);
      setJobPrecisionById((prev) => ({ ...prev, [runRes.jobId]: precision }));
      setResults([]);
      setPage(1);
      setTotalRows(0);
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
        if (res.status === "done" || res.status === "cancelled") {
          window.clearInterval(timer);
          setRunning(false);
          if (res.status === "cancelled") setError(res.message ?? "Optimization cancelled.");
          await fetchResults(1, sortKey, sortDir, jobId);
        }
      } catch (e: any) {
        setRunning(false);
        setError(String(e?.message ?? e));
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [jobId, running, sortDir, sortKey]);


  async function onStopOptimization() {
    setError(null);
    try {
      await cancelCurrentJob();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onSort(nextSortKey: OptimizerSortKeyExtended) {
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

  const activePrecision = (jobId ? jobPrecisionById[jobId] : undefined) ?? DEFAULT_PRECISION;

  function copyToSettings(row: OptimizationResult) {
    const patch = {
      source: "optimizer",
      ts: Date.now(),
      tapeId: selectedTapeIds[0] ?? null,
      jobId,
      rank: row.rank,
      patch: {
        signals: {
          priceThresholdPct: quantizeByPrecision(row.params.priceThresholdPct, activePrecision.priceTh),
          oivThresholdPct: quantizeByPrecision(row.params.oivThresholdPct, activePrecision.oivTh),
        },
        paper: {
          tpRoiPct: quantizeByPrecision(row.params.tpRoiPct, activePrecision.tp),
          slRoiPct: quantizeByPrecision(row.params.slRoiPct, activePrecision.sl),
          entryOffsetPct: quantizeByPrecision(row.params.entryOffsetPct, activePrecision.offset),
        },
      },
    };
    localStorage.setItem("bots_dev.pendingConfigPatch", JSON.stringify(patch));
  }

  async function onApplyTapesDir() {
    setError(null);
    try {
      const next = await setSettings({ tapesDir: tapesDirDraft });
      setTapesDir(next.tapesDir);
      setShowTapesDirModal(false);
      setSelectedTapeIds([]);
      setTapesRefreshKey((prev) => prev + 1);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
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
              <Button size="sm" variant="outline-secondary" onClick={() => { setTapesDirDraft(tapesDir); setShowTapesDirModal(true); }}>
                Tapes directory
              </Button>
              <span style={{ fontSize: 12 }}>
                recording: <b>{isRecording ? "ON" : "OFF"}</b>
                {recordingTapeId ? ` · ${recordingTapeId}` : ""}
              </span>
            </div>
            <div style={{ fontSize: 12, marginBottom: 8 }}>tapesDir: <b>{tapesDir || "-"}</b></div>

            <TapesTable
              isRecording={isRecording}
              selectedTapeIds={selectedTapeIds}
              onToggleTape={onToggleTape}
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
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>direction</Form.Label>
                <Form.Select value={directionMode} onChange={(e) => setDirectionMode(e.currentTarget.value as "both" | "long" | "short")}>
                  <option value="both">Both</option>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </Form.Select>
              </Form.Group>
              <Button onClick={() => void onRunOptimization()} disabled={!selectedTapeIds.length || running || Boolean(rangeError)}>
                Run optimization
              </Button>
              {running ? (
                <Button variant="outline-danger" onClick={() => void onStopOptimization()}>
                  Stop
                </Button>
              ) : null}
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

            <div style={{ fontSize: 12, marginBottom: 8 }}>
              selected tapes: <b>{selectedTapeIds.length}</b>
              {selectedTapeIds.length ? ` · ${selectedTapeIds.join(", ")}` : ""}
            </div>

            {jobId ? <ProgressBar now={running ? progressPct : 100} label={`${running ? done : 100}/${total || 100}`} className="mb-2" /> : null}

            <Table striped bordered hover size="sm">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("netPnl")}>netPnl</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("trades")}>trades</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("winRatePct")}>winRate</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("priceTh")}>priceTh</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("oivTh")}>oivTh</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("tp")}>tp</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("sl")}>sl</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("offset")}>offset</th>
                  <th>action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  return (
                    <tr key={`${r.rank}-${r.netPnl}`}>
                      <td>{r.rank}</td>
                      <td>{r.netPnl.toFixed(4)}</td>
                      <td>{r.trades}</td>
                      <td>{r.winRatePct.toFixed(2)}%</td>
                      <td>{r.params.priceThresholdPct.toFixed(activePrecision.priceTh)}</td>
                      <td>{r.params.oivThresholdPct.toFixed(activePrecision.oivTh)}</td>
                      <td>{r.params.tpRoiPct.toFixed(activePrecision.tp)}</td>
                      <td>{r.params.slRoiPct.toFixed(activePrecision.sl)}</td>
                      <td>{r.params.entryOffsetPct.toFixed(activePrecision.offset)}</td>
                      <td>
                        <Button size="sm" variant="outline-secondary" onClick={() => copyToSettings(r)}>Copy to settings</Button>
                      </td>
                    </tr>
                  );
                })}
                {!results.length ? (
                  <tr>
                    <td colSpan={10} style={{ fontSize: 12, opacity: 0.75 }}>No results</td>
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

      <Modal show={showTapesDirModal} onHide={() => setShowTapesDirModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Tapes directory</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Directory path</Form.Label>
            <Form.Control value={tapesDirDraft} onChange={(e) => setTapesDirDraft(e.currentTarget.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowTapesDirModal(false)}>Cancel</Button>
          <Button onClick={() => void onApplyTapesDir()}>Apply</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
