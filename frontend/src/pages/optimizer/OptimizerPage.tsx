import { Fragment, memo, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ButtonGroup, Card, Col, Collapse, Container, Form, Modal, Pagination, ProgressBar, Row, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeedLite } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import {
  getJobResults,
  getJobStatus,
  cancelCurrentJob,
  pauseCurrentJob,
  resumeCurrentJob,
  getCurrentJob,
  getSettings,
  getStatus,
  listTapes,
  runOptimizationJob,
  setSettings,
  getJobExportUrl,
  getCurrentJobExportUrl,
  startOptimizerLoop,
  stopOptimizerLoop,
  pauseOptimizerLoop,
  resumeOptimizerLoop,
  getOptimizerLoopStatus,
  getDoctorStatus,
  getLastSoakSnapshot,
  getOptimizerJobHistory,
  type DoctorStatus,
  type OptimizerJobHistoryRecord,
  type OptimizerLoopStatus,
  type OptimizationResult,
  type SoakLastStatus,
  type OptimizerPrecision,
  type OptimizerSortDir,
  type OptimizerSortKeyExtended,
  type OptimizerHistorySortKey,
} from "../../features/optimizer/api/optimizerApi";

type OptimizerResultRow = OptimizationResult;

type RangeKey = "priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs";
type RangeState = Record<RangeKey, { min: string; max: string }>;

const RANGE_DEFAULTS: RangeState = {
  priceTh: { min: "0.5", max: "6" },
  oivTh: { min: "0.5", max: "15" },
  tp: { min: "2", max: "12" },
  sl: { min: "2", max: "12" },
  offset: { min: "0", max: "1" },
  timeoutSec: { min: "5", max: "60" },
  rearmMs: { min: "0", max: "3000" },
};

const pageSize = 50;
const HISTORY_PAGE_SIZES = [10, 25, 50, 100] as const;
const RANGES_STORAGE_KEY = "bots_dev.optimizer.ranges";
const CANDIDATES_STORAGE_KEY = "bots_dev.optimizer.candidates";
const SEED_STORAGE_KEY = "bots_dev.optimizer.seed";
const DIRECTION_STORAGE_KEY = "bots_dev.optimizer.directionMode";
const OPT_TF_STORAGE_KEY = "bots_dev.optimizer.optTfMin";
const MIN_TRADES_STORAGE_KEY = "bots_dev.optimizer.minTrades";
const EXCLUDE_NEGATIVE_STORAGE_KEY = "bots_dev.optimizer.excludeNegative";
const REMEMBER_NEGATIVES_STORAGE_KEY = "bots_dev.optimizer.rememberNegatives";
const LOOP_RUNS_COUNT_STORAGE_KEY = "bots_dev.optimizer.loopRunsCount";
const LOOP_INFINITE_STORAGE_KEY = "bots_dev.optimizer.loopInfinite";
const RANGES_SAVE_DEBOUNCE_MS = 400;
const DEFAULT_PRECISION: OptimizerPrecision = { priceTh: 3, oivTh: 3, tp: 3, sl: 3, offset: 3, timeoutSec: 0, rearmMs: 0 };

type TapeRow = { id: string; createdAt: number; symbolsCount: number; tf: number | null; initialBytes: number; runsTotal: number; startTs: number | null; endTs: number | null };
type TapeBounds = { startTs: number | null; endTs: number | null };


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
      <td style={{ fontSize: 12 }}>{tape.runsTotal}</td>
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
  onTapesLoaded,
}: {
  isRecording: boolean;
  selectedTapeIds: string[];
  onToggleTape: (id: string, checked: boolean) => void;
  refreshKey: number;
  recordingTapeId: string | null;
  onError: (message: string) => void;
  onTapesLoaded: (rows: TapeRow[]) => void;
}) {
  const [rows, setRows] = useState<TapeRow[]>([]);

  const fetchTapes = useCallback(async () => {
    try {
      const res = await listTapes();
      const nextTapes = res.tapes ?? [];
      setRows((prev) => {
        const prevById = new Map(prev.map((r) => [r.id, r]));
        const nextRows = nextTapes.map((t) => {
          const next: TapeRow = {
            id: t.id,
            createdAt: t.createdAt,
            symbolsCount: Array.isArray(t.meta?.symbols) ? t.meta.symbols.length : 0,
            tf: t.meta?.klineTfMin ?? null,
            initialBytes: Number(t.fileSizeBytes) || 0,
            runsTotal: Number(t.runsTotal) || 0,
            startTs: Number.isFinite(Number(t.startTs)) ? Number(t.startTs) : null,
            endTs: Number.isFinite(Number(t.endTs)) ? Number(t.endTs) : null,
          };
          const old = prevById.get(t.id);
          if (!old) return next;
          if (old.createdAt === next.createdAt && old.symbolsCount === next.symbolsCount && old.tf === next.tf && old.initialBytes === next.initialBytes && old.runsTotal === next.runsTotal && old.startTs === next.startTs && old.endTs === next.endTs) return old;
          return next;
        });
        onTapesLoaded(nextRows);
        return nextRows;
      });
    } catch (e: any) {
      onError(String(e?.message ?? e));
    }
  }, [onError, onTapesLoaded]);

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
          <th>runs</th>
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
            <td colSpan={7} style={{ fontSize: 12, opacity: 0.75 }}>No tapes</td>
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

function toDatetimeLocalValue(tsMs: number | null | undefined): string {
  if (!Number.isFinite(tsMs)) return "";
  const d = new Date(Number(tsMs));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseDatetimeLocalToTs(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function formatTs(tsMs: number | null | undefined): string {
  if (!Number.isFinite(tsMs)) return "-";
  const d = new Date(Number(tsMs));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function isValidRangeState(value: unknown): value is RangeState {
  if (!value || typeof value !== "object") return false;
  const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"];
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

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "-";
  const total = Math.floor(sec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function formatEta(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "-";
  const total = Math.floor(sec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSigValue(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

function makeResultSignature(row: OptimizerResultRow): string {
  return [
    `priceTh=${toSigValue(row.params.priceThresholdPct)}`,
    `oivTh=${toSigValue(row.params.oivThresholdPct)}`,
    `tp=${toSigValue(row.params.tpRoiPct)}`,
    `sl=${toSigValue(row.params.slRoiPct)}`,
    `offset=${toSigValue(row.params.entryOffsetPct)}`,
    `timeoutSec=${toSigValue(row.params.timeoutSec)}`,
    `rearmMs=${toSigValue(row.params.rearmMs)}`,
  ].join("|");
}

function isBetterResult(next: OptimizerResultRow, prev: OptimizerResultRow): boolean {
  if (next.netPnl !== prev.netPnl) return next.netPnl > prev.netPnl;
  if (next.trades !== prev.trades) return next.trades > prev.trades;
  return next.winRatePct > prev.winRatePct;
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
  const { conn, lastServerTime, wsUrl, streams } = useWsFeedLite();
  const { status, busy, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();

  const [selectedTapeIds, setSelectedTapeIds] = useState<string[]>([]);
  const [recordingTapeId, setRecordingTapeId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [tapesRefreshKey, setTapesRefreshKey] = useState(0);
  const [tapeBoundsById, setTapeBoundsById] = useState<Record<string, TapeBounds>>({});
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [minTrades, setMinTrades] = useState("1");
  const [directionMode, setDirectionMode] = useState<"both" | "long" | "short">("both");
  const [datasetMode, setDatasetMode] = useState<"snapshot" | "followTail">("snapshot");
  const [timeRangeFromTs, setTimeRangeFromTs] = useState("");
  const [timeRangeToTs, setTimeRangeToTs] = useState("");
  const [optTfMin, setOptTfMin] = useState<string>("1");
  const [excludeNegative, setExcludeNegative] = useState(false);
  const [rememberNegatives, setRememberNegatives] = useState(false);
  const [, setOptimizerPaused] = useState(false);
  const [jobStartedAtMs, setJobStartedAtMs] = useState<number | null>(null);
  const [jobUpdatedAtMs, setJobUpdatedAtMs] = useState<number | null>(null);
  const [jobFinishedAtMs, setJobFinishedAtMs] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<"idle" | "running" | "paused" | "done" | "error" | "cancelled">("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [singleJobId, setSingleJobId] = useState<string | null>(null);
  const [loopJobId, setLoopJobId] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const [results, setResults] = useState<OptimizationResult[]>([]);
  const [loopAggRows, setLoopAggRows] = useState<OptimizerResultRow[]>([]);
  const [, setLoopAggMap] = useState<Map<string, OptimizerResultRow>>(new Map());
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [sortKey, setSortKey] = useState<OptimizerSortKeyExtended>("netPnl");
  const [sortDir, setSortDir] = useState<OptimizerSortDir>("desc");
  const [jobPrecisionById, setJobPrecisionById] = useState<Record<string, OptimizerPrecision>>({});
  const [tapesDir, setTapesDir] = useState("");
  const [showTapesDirModal, setShowTapesDirModal] = useState(false);
  const [tapesDirDraft, setTapesDirDraft] = useState("");

  const [ranges, setRanges] = useState<RangeState>(RANGE_DEFAULTS);
  const [loopRunsCount, setLoopRunsCount] = useState("3");
  const [loopInfinite, setLoopInfinite] = useState(false);
  const [loopStatus, setLoopStatus] = useState<OptimizerLoopStatus | null>(null);
  const [loopBusy, setLoopBusy] = useState(false);
  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [lastSoak, setLastSoak] = useState<SoakLastStatus["snapshot"]>(null);
  const [jobHistory, setJobHistory] = useState<OptimizerJobHistoryRecord[]>([]);
  const [jobHistoryTotal, setJobHistoryTotal] = useState(0);
  const [jobHistoryLimit, setJobHistoryLimit] = useState<(typeof HISTORY_PAGE_SIZES)[number]>(25);
  const [jobHistoryOffset, setJobHistoryOffset] = useState(0);
  const [jobHistorySortKey, setJobHistorySortKey] = useState<OptimizerHistorySortKey>("endedAtMs");
  const [jobHistorySortDir, setJobHistorySortDir] = useState<OptimizerSortDir>("desc");
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [historyResults, setHistoryResults] = useState<Record<string, OptimizationResult[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const rangesSaveTimerRef = useRef<number | null>(null);
  const lastStatusFetchRef = useRef<{ jobId: string | null; ts: number }>({ jobId: null, ts: 0 });
  const loopPollTokenRef = useRef(0);
  const prevLoopJobIdRef = useRef<string | null>(null);
  const prevLoopActiveRef = useRef(false);
  const loopJobIdRef = useRef<string | null>(null);
  const lastNonNullLoopJobIdRef = useRef<string | null>(null);
  const lastPctByJobIdRef = useRef<Record<string, number>>({});
  const startedAtByJobIdRef = useRef<Record<string, number>>({});
  const lastTableSourceRef = useRef<"loop" | "single">("single");

  const resetJobProgressState = useCallback(() => {
    setDone(0);
    setTotal(0);
    setJobStartedAtMs(null);
    setJobUpdatedAtMs(null);
    setJobFinishedAtMs(null);
    setJobStatus("idle");
    setOptimizerPaused(false);
  }, []);

  const clearSingleJobState = useCallback(() => {
    setSingleJobId(null);
    setJobStatus("idle");
  }, []);

  const getStableProgressForJob = useCallback((jobId: string, status: { donePct?: number; done?: number; startedAtMs?: number | null }) => {
    const rawPct = typeof status.donePct === "number" ? status.donePct : status.done ?? 0;
    const clampedPct = clamp(roundTo2(Number(rawPct) || 0), 0, 100);
    const lastPct = lastPctByJobIdRef.current[jobId];
    const pct = typeof lastPct === "number" ? Math.max(lastPct, clampedPct) : clampedPct;
    lastPctByJobIdRef.current[jobId] = pct;
    if (typeof status.startedAtMs === "number" && Number.isFinite(status.startedAtMs)) {
      startedAtByJobIdRef.current[jobId] = status.startedAtMs;
    }
    const startedAtMs = startedAtByJobIdRef.current[jobId] ?? null;
    return { pct, startedAtMs };
  }, []);

  const isNoCurrentJobError = useCallback((err: unknown): boolean => {
    const message = String((err as any)?.message ?? err).toLowerCase();
    return message.includes("404") || message.includes("not found") || message.includes("no current job");
  }, []);

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
    if (!isRecording) return;
    const id = window.setInterval(() => {
      void refreshStatus();
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  useEffect(() => {
    setRanges(loadSavedRanges());
    setCandidates(loadStoredPositiveInt(CANDIDATES_STORAGE_KEY, "200", 1));
    setSeed(loadStoredPositiveInt(SEED_STORAGE_KEY, "1", 0));
    const savedDirection = localStorage.getItem(DIRECTION_STORAGE_KEY);
    if (savedDirection === "long" || savedDirection === "short" || savedDirection === "both") setDirectionMode(savedDirection);
    const savedOptTf = localStorage.getItem(OPT_TF_STORAGE_KEY);
    if (savedOptTf != null) {
      const n = Math.floor(Number(savedOptTf));
      if (Number.isFinite(n) && n >= 1) setOptTfMin(String(n));
      else setOptTfMin("1");
    } else {
      setOptTfMin("1");
    }
    const savedMinTrades = localStorage.getItem(MIN_TRADES_STORAGE_KEY);
    if (savedMinTrades != null) {
      const n = Math.floor(Number(savedMinTrades));
      if (Number.isFinite(n) && n >= 0) setMinTrades(String(n));
    }
    setExcludeNegative(localStorage.getItem(EXCLUDE_NEGATIVE_STORAGE_KEY) === "1");
    setRememberNegatives(localStorage.getItem(REMEMBER_NEGATIVES_STORAGE_KEY) === "1");
    setLoopRunsCount(loadStoredPositiveInt(LOOP_RUNS_COUNT_STORAGE_KEY, "3", 1));
    setLoopInfinite(localStorage.getItem(LOOP_INFINITE_STORAGE_KEY) === "1");
    void refreshStatus();
    void refreshJobHistory();
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
        const loopState = await getOptimizerLoopStatus();
        const loopStateActive = Boolean(loopState.loop?.isRunning);
        const currentIsLoopJob = Boolean(loopState.loop?.lastJobId && loopState.loop.lastJobId === current.jobId);
        if (loopStateActive || currentIsLoopJob) return;
        const statusRes = await getJobStatus(current.jobId);
        // Restore only an in-flight single-run job. Completed jobs should not drive UI controls/progress on page load.
        if (statusRes.status === "running" || statusRes.status === "paused") {
          lastTableSourceRef.current = "single";
          setSingleJobId(current.jobId);
          const progress = getStableProgressForJob(current.jobId, statusRes as { donePct?: number; done?: number; startedAtMs?: number | null });
          setDone(progress.pct);
          setTotal(statusRes.total);
        } else {
          clearSingleJobState();
          return;
        }
        if (statusRes.startedAtMs) setJobStartedAtMs(statusRes.startedAtMs);
        else setJobStartedAtMs(startedAtByJobIdRef.current[current.jobId] ?? null);
        if (statusRes.updatedAtMs) setJobUpdatedAtMs(statusRes.updatedAtMs);
        setJobFinishedAtMs(statusRes.finishedAtMs ?? null);
        setJobStatus(statusRes.status);
        if (statusRes.status === "running" || statusRes.status === "paused") {
          setOptimizerPaused(statusRes.status === "paused");
          await fetchResults(1, sortKey, sortDir, current.jobId, { keepPreviousIfEmpty: loopActive });
          return;
        }
        if (statusRes.status === "done" || statusRes.status === "cancelled") {
          await fetchResults(1, sortKey, sortDir, current.jobId, { keepPreviousIfEmpty: loopActive });
          return;
        }
        setError(statusRes.message ?? "Optimization job failed.");
      } catch (e: any) {
        if (isNoCurrentJobError(e)) {
          clearSingleJobState();
          return;
        }
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshJobHistory();
    }, 8000);
    return () => window.clearInterval(id);
  }, [jobHistoryLimit, jobHistoryOffset, jobHistorySortDir, jobHistorySortKey]);



  useEffect(() => {
    void refreshJobHistory();
  }, [jobHistoryLimit, jobHistoryOffset, jobHistorySortDir, jobHistorySortKey]);

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

  useEffect(() => {
    try {
      const n = Math.floor(Number(optTfMin));
      if (Number.isFinite(n) && n >= 1) localStorage.setItem(OPT_TF_STORAGE_KEY, String(n));
    } catch {
      return;
    }
  }, [optTfMin]);

  useEffect(() => {
    const n = Math.floor(Number(minTrades));
    if (Number.isFinite(n) && n >= 0) localStorage.setItem(MIN_TRADES_STORAGE_KEY, String(n));
  }, [minTrades]);

  useEffect(() => {
    localStorage.setItem(EXCLUDE_NEGATIVE_STORAGE_KEY, excludeNegative ? "1" : "0");
  }, [excludeNegative]);

  useEffect(() => {
    localStorage.setItem(REMEMBER_NEGATIVES_STORAGE_KEY, rememberNegatives ? "1" : "0");
  }, [rememberNegatives]);

  useEffect(() => {
    const n = Math.floor(Number(loopRunsCount));
    if (Number.isFinite(n) && n >= 1) localStorage.setItem(LOOP_RUNS_COUNT_STORAGE_KEY, String(n));
  }, [loopRunsCount]);

  useEffect(() => {
    localStorage.setItem(LOOP_INFINITE_STORAGE_KEY, loopInfinite ? "1" : "0");
  }, [loopInfinite]);

  useEffect(() => {
    if (jobStatus !== "running") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [jobStatus]);

  const loopExists = Boolean(loopStatus?.loop);
  const loopRunning = Boolean(loopStatus?.loop?.isRunning);
  const loopPaused = Boolean(loopStatus?.loop?.isRunning && loopStatus?.loop?.isPaused);
  const loopActive = loopRunning || loopPaused;
  const loopStopped = !loopRunning;
  const jobActive = jobStatus === "running" || jobStatus === "paused";
  const activeLoopJobId = loopJobId ?? lastNonNullLoopJobIdRef.current;
  const activeJobId = loopActive ? activeLoopJobId : singleJobId;

  const selectedTapeBounds = useMemo(() => {
    const tapeId = selectedTapeIds[0];
    if (!tapeId) return null;
    return tapeBoundsById[tapeId] ?? null;
  }, [selectedTapeIds, tapeBoundsById]);

  const handleTapesLoaded = useCallback((rows: TapeRow[]) => {
    const next: Record<string, TapeBounds> = {};
    rows.forEach((row) => {
      next[row.id] = { startTs: row.startTs, endTs: row.endTs };
    });
    setTapeBoundsById(next);
  }, []);

  const effectiveTimeRangePreview = useMemo(() => {
    const bounds = selectedTapeBounds;
    let from = parseDatetimeLocalToTs(timeRangeFromTs);
    let to = parseDatetimeLocalToTs(timeRangeToTs);
    if (from == null) from = bounds?.startTs ?? undefined;
    if (to == null) to = bounds?.endTs ?? undefined;
    if (from != null && bounds?.startTs != null && from < bounds.startTs) from = bounds.startTs;
    if (to != null && bounds?.endTs != null && to > bounds.endTs) to = bounds.endTs;
    if (from != null && to != null && from > to) {
      const nextFrom = to;
      const nextTo = from;
      from = nextFrom;
      to = nextTo;
    }
    return { from, to, invalid: false };
  }, [selectedTapeBounds, timeRangeFromTs, timeRangeToTs]);

  const resolveEffectiveTimeRange = useCallback(() => {
    const bounds = selectedTapeBounds;
    let from = parseDatetimeLocalToTs(timeRangeFromTs);
    let to = parseDatetimeLocalToTs(timeRangeToTs);
    if (from == null) from = bounds?.startTs ?? undefined;
    if (to == null) to = bounds?.endTs ?? undefined;
    if (from != null && bounds?.startTs != null && from < bounds.startTs) from = bounds.startTs;
    if (to != null && bounds?.endTs != null && to > bounds.endTs) to = bounds.endTs;
    if (from != null && to != null && from > to) {
      const nextFrom = to;
      const nextTo = from;
      from = nextFrom;
      to = nextTo;
    }
    return { from, to };
  }, [selectedTapeBounds, timeRangeFromTs, timeRangeToTs]);

  useEffect(() => {
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const next = await getOptimizerLoopStatus();
        setLoopStatus(next);
        setLoopJobId(next.loop?.lastJobId ?? null);
      } catch {
        return;
      }
    };
    void refresh();
    if (loopActive) {
      timer = window.setInterval(() => {
        void refresh();
      }, 500);
    }
    return () => {
      if (timer != null) window.clearInterval(timer);
    };
  }, [loopActive]);

  useEffect(() => {
    const prev = prevLoopJobIdRef.current;
    if (loopJobId !== null && prev !== loopJobId) {
      // Do not reset to 0 first: it causes visible 0->100->0 flicker.
      // Show last reported pct for the new jobId (or 0 if we truly have no data yet).
      const pct = lastPctByJobIdRef.current[loopJobId] ?? 0;
      setDone(pct);
      setTotal(100);
      setJobStartedAtMs(startedAtByJobIdRef.current[loopJobId] ?? null);
      setJobUpdatedAtMs(Date.now());
      // Keep jobStatus as-is; it will be updated by WS/progress polling.
    }
    prevLoopJobIdRef.current = loopJobId;
  }, [loopJobId]);

  useEffect(() => {
    loopJobIdRef.current = loopJobId;
    if (loopJobId) lastNonNullLoopJobIdRef.current = loopJobId;
  }, [loopJobId]);

  useEffect(() => {
    const prevLoopActive = prevLoopActiveRef.current;
    if (prevLoopActive && !loopActive && loopAggRows.length > 0) {
      setSingleJobId(null);
      void refreshJobHistory();
    }
    prevLoopActiveRef.current = loopActive;
  }, [loopActive, loopAggRows.length]);

  async function onStartLoop() {
    if (!selectedTapeIds.length || rangeError) return;
    const effectiveRange = resolveEffectiveTimeRange();
    setError(null);
    lastTableSourceRef.current = "loop";
    setLoopBusy(true);
    try {
      const rangePayload = buildRangesPayload();
      const precision: OptimizerPrecision = {
        priceTh: Math.max(countDecimals(ranges.priceTh.min), countDecimals(ranges.priceTh.max)),
        oivTh: Math.max(countDecimals(ranges.oivTh.min), countDecimals(ranges.oivTh.max)),
        tp: Math.max(countDecimals(ranges.tp.min), countDecimals(ranges.tp.max)),
        sl: Math.max(countDecimals(ranges.sl.min), countDecimals(ranges.sl.max)),
        offset: Math.max(countDecimals(ranges.offset.min), countDecimals(ranges.offset.max)),
        timeoutSec: Math.max(countDecimals(ranges.timeoutSec.min), countDecimals(ranges.timeoutSec.max)),
        rearmMs: Math.max(countDecimals(ranges.rearmMs.min), countDecimals(ranges.rearmMs.max)),
      };
      await startOptimizerLoop({
        tapeIds: selectedTapeIds,
        datasetMode,
        timeRangeFromTs: effectiveRange.from ?? null,
        timeRangeToTs: effectiveRange.to ?? null,
        candidates: Number(candidates),
        seed: Number(seed),
        minTrades: Math.max(0, Math.floor(Number(minTrades) || 0)),
        directionMode,
        optTfMin: Number(optTfMin),
        excludeNegative,
        rememberNegatives,
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
        precision,
        runsCount: Math.max(1, Math.floor(Number(loopRunsCount) || 1)),
        infinite: loopInfinite,
      });
      setLoopAggRows([]);
      setLoopAggMap(new Map());
      const next = await getOptimizerLoopStatus();
      setLoopStatus(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoopBusy(false);
    }
  }

  async function onStopLoop() {
    setError(null);
    setLoopBusy(true);
    try {
      await stopOptimizerLoop();
      const next = await getOptimizerLoopStatus();
      setLoopStatus(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoopBusy(false);
    }
  }

  async function onPauseLoop() {
    setError(null);
    setLoopBusy(true);
    try {
      await pauseOptimizerLoop();
      const next = await getOptimizerLoopStatus();
      setLoopStatus(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoopBusy(false);
    }
  }

  async function onResumeLoop() {
    setError(null);
    setLoopBusy(true);
    try {
      await resumeOptimizerLoop();
      const next = await getOptimizerLoopStatus();
      setLoopStatus(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoopBusy(false);
    }
  }


  const rangeError = useMemo(() => {
    const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"];
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
    const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"];
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

  async function fetchResults(
    nextPage: number,
    nextSortKey: OptimizerSortKeyExtended,
    nextSortDir: OptimizerSortDir,
    activeJobId: string,
    options?: { keepPreviousIfEmpty?: boolean }
  ) {
    const res = await getJobResults(activeJobId, { page: nextPage, sortKey: nextSortKey, sortDir: nextSortDir });
    const nextResults = res.results ?? [];
    if (loopActive) {
      const minTradesLimit = Math.max(0, Math.floor(Number(minTrades) || 0));
      setLoopAggMap((prev) => {
        const next = new Map(prev);
        for (const row of nextResults) {
          if (excludeNegative && row.netPnl < 0) continue;
          if (minTradesLimit > 0 && row.trades < minTradesLimit) continue;
          const signature = makeResultSignature(row);
          const existing = next.get(signature);
          if (!existing || isBetterResult(row, existing)) {
            next.set(signature, row);
          }
        }
        const sortedRows = Array.from(next.values()).sort((a, b) => {
          if (b.netPnl !== a.netPnl) return b.netPnl - a.netPnl;
          return b.trades - a.trades;
        });
        setLoopAggRows(() => sortedRows);
        setTotalRows(sortedRows.length);
        return next;
      });
      return;
    }
    const keepPreviousIfEmpty = options?.keepPreviousIfEmpty ?? false;
    if (keepPreviousIfEmpty && nextResults.length === 0) return;
    setResults(nextResults);
    setPage(res.page);
    setTotalRows(res.totalRows);
  }

  async function onRunOptimization() {
    if (!selectedTapeIds.length || rangeError) return;
    const effectiveRange = resolveEffectiveTimeRange();
    setError(null);
    lastTableSourceRef.current = "single";
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
        timeoutSec: Math.max(countDecimals(ranges.timeoutSec.min), countDecimals(ranges.timeoutSec.max)),
        rearmMs: Math.max(countDecimals(ranges.rearmMs.min), countDecimals(ranges.rearmMs.max)),
      };
      const runRes = await runOptimizationJob({
        tapeIds: selectedTapeIds,
        datasetMode,
        timeRangeFromTs: effectiveRange.from ?? null,
        timeRangeToTs: effectiveRange.to ?? null,
        candidates: Number(candidates),
        seed: Number(seed),
        minTrades: Math.max(0, Math.floor(Number(minTrades) || 0)),
        directionMode,
        optTfMin: Number(optTfMin),
        excludeNegative,
        rememberNegatives,
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
        precision,
      });
      setSingleJobId(runRes.jobId);
      const startedAtMs = Date.now();
      startedAtByJobIdRef.current[runRes.jobId] = startedAtMs;
      lastPctByJobIdRef.current[runRes.jobId] = 0;
      setJobStartedAtMs(startedAtMs);
      setJobUpdatedAtMs(Date.now());
      setJobFinishedAtMs(null);
      setJobStatus("running");
      setOptimizerPaused(false);
      setJobPrecisionById((prev) => ({ ...prev, [runRes.jobId]: precision }));
      if (!excludeNegative && !rememberNegatives) setResults([]);
      setPage(1);
      setTotalRows(0);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    if (loopActive || !singleJobId || !jobActive) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const reqJobId = singleJobId;
        const now = Date.now();
        if (lastStatusFetchRef.current.jobId === reqJobId && now - lastStatusFetchRef.current.ts < 200) return;
        lastStatusFetchRef.current = { jobId: reqJobId, ts: now };
        const res = await getJobStatus(reqJobId);
        if (loopActive || singleJobId !== reqJobId) return;
        if (!alive) return;
        const progress = getStableProgressForJob(reqJobId, res as { donePct?: number; done?: number; startedAtMs?: number | null });
        setDone((prev) => (prev === progress.pct ? prev : progress.pct));
        setTotal((prev) => (prev === res.total ? prev : res.total));
        setJobStartedAtMs((prev) => {
          const next = progress.startedAtMs;
          return prev === next ? prev : next;
        });
        setJobUpdatedAtMs((prev) => {
          const next = res.updatedAtMs ?? null;
          return prev === next ? prev : next;
        });
        setJobFinishedAtMs((prev) => {
          const next = res.finishedAtMs ?? null;
          return prev === next ? prev : next;
        });
        setJobStatus((prev) => (prev === res.status ? prev : res.status));
        setNowMs(Date.now());
        setOptimizerPaused((prev) => {
          const next = res.status === "paused";
          return prev === next ? prev : next;
        });
        await fetchResults(page, sortKey, sortDir, reqJobId, { keepPreviousIfEmpty: false });
        if (loopActive || singleJobId !== reqJobId) return;
        if (!alive) return;
        if (res.status === "error") {
          setError(res.message ?? "Optimization job failed.");
        }
        if (res.status === "done" || res.status === "cancelled") {
          window.clearInterval(timer);
          if (res.status === "cancelled") setError(res.message ?? "Optimization cancelled.");
          await fetchResults(1, sortKey, sortDir, reqJobId, { keepPreviousIfEmpty: false });
          await refreshJobHistory();
          if (loopActive || singleJobId !== reqJobId) return;
          if (!alive) return;
        }
        if (res.status === "error") {
          await refreshJobHistory();
        }
      } catch (e: any) {
        if (isNoCurrentJobError(e)) {
          clearSingleJobState();
          return;
        }
        setError(String(e?.message ?? e));
      }
    }, 250);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [clearSingleJobState, getStableProgressForJob, isNoCurrentJobError, jobActive, loopActive, page, singleJobId, sortDir, sortKey]);

  useEffect(() => {
    if (!loopActive || !activeLoopJobId) return;
    const token = ++loopPollTokenRef.current;
    let alive = true;
    const timer = window.setInterval(async () => {
      const reqJobId = loopJobIdRef.current ?? lastNonNullLoopJobIdRef.current;
      const reqToken = loopPollTokenRef.current;
      if (!reqJobId || reqToken !== token) return;
      try {
        const res = await getJobStatus(reqJobId);
        if (!alive) return;
        if (loopPollTokenRef.current !== token) return;
        if ((loopJobIdRef.current ?? lastNonNullLoopJobIdRef.current) !== reqJobId) return;
        const progress = getStableProgressForJob(reqJobId, res as { donePct?: number; done?: number; startedAtMs?: number | null });
        setDone((prev) => (prev === progress.pct ? prev : progress.pct));
        setTotal((prev) => (prev === res.total ? prev : res.total));
        setJobStartedAtMs((prev) => {
          const next = progress.startedAtMs;
          return prev === next ? prev : next;
        });
        setJobUpdatedAtMs((prev) => {
          const next = res.updatedAtMs ?? null;
          return prev === next ? prev : next;
        });
        setJobFinishedAtMs((prev) => {
          const next = res.finishedAtMs ?? null;
          return prev === next ? prev : next;
        });
        setJobStatus((prev) => (prev === res.status ? prev : res.status));
        setNowMs(Date.now());
      } catch {
        return;
      }
    }, 300);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeLoopJobId, getStableProgressForJob, loopActive]);

  useEffect(() => {
    if (!loopActive || !loopJobId) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        await fetchResults(1, sortKey, sortDir, loopJobId, { keepPreviousIfEmpty: true });
        if (!alive) return;
      } catch {
        return;
      }
    }, 1000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [loopActive, loopJobId, sortDir, sortKey]);


  async function onStopOptimization() {
    setError(null);
    try {
      await cancelCurrentJob();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }


  async function onPauseOptimization() {
    setError(null);
    try {
      await pauseCurrentJob();
      setOptimizerPaused(true);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onResumeOptimization() {
    setError(null);
    try {
      await resumeCurrentJob();
      setOptimizerPaused(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onSort(nextSortKey: OptimizerSortKeyExtended) {
    if (!activeJobId) return;
    const nextSortDir: OptimizerSortDir = sortKey === nextSortKey && sortDir === "desc" ? "asc" : "desc";
    setSortKey(nextSortKey);
    setSortDir(nextSortDir);
    await fetchResults(1, nextSortKey, nextSortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
  }

  async function onPageChange(nextPage: number) {
    if (isLoopDisplay) {
      setPage(nextPage);
      return;
    }
    if (!activeJobId) return;
    await fetchResults(nextPage, sortKey, sortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
  }

  const activePrecision = (activeJobId ? jobPrecisionById[activeJobId] : undefined) ?? DEFAULT_PRECISION;


  function copyToSettings(row: OptimizationResult) {
    const patch = {
      source: "optimizer",
      ts: Date.now(),
      tapeId: selectedTapeIds[0] ?? null,
      jobId: activeJobId,
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
          entryTimeoutSec: quantizeByPrecision(row.params.timeoutSec, activePrecision.timeoutSec),
          rearmDelayMs: quantizeByPrecision(row.params.rearmMs, activePrecision.rearmMs),
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



  async function refreshSoakLast() {
    try {
      const res = await getLastSoakSnapshot();
      setLastSoak(res.snapshot);
    } catch {
      setLastSoak(null);
    }
  }

  async function refreshJobHistory() {
    try {
      const res = await getOptimizerJobHistory({
        limit: jobHistoryLimit,
        offset: jobHistoryOffset,
        sortKey: jobHistorySortKey,
        sortDir: jobHistorySortDir,
      });
      setJobHistory(Array.isArray(res.items) ? res.items : []);
      setJobHistoryTotal(Number(res.total) || 0);
    } catch {
      return;
    }
  }

  async function toggleHistoryRow(jobId: string) {
    const nextExpanded = !expandedHistory[jobId];
    setExpandedHistory((prev) => ({ ...prev, [jobId]: nextExpanded }));
    if (!nextExpanded || historyResults[jobId] != null || historyLoading[jobId]) return;
    setHistoryLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      const res = await getJobResults(jobId, { page: 1, sortKey: sortKey, sortDir: sortDir, positiveOnly: true });
      setHistoryResults((prev) => ({ ...prev, [jobId]: Array.isArray(res.results) ? res.results : [] }));
    } catch {
      setHistoryResults((prev) => ({ ...prev, [jobId]: [] }));
    } finally {
      setHistoryLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  }



  function onHistorySort(nextSortKey: OptimizerHistorySortKey) {
    setJobHistorySortKey((prevKey) => {
      setJobHistorySortDir((prevDir) => (prevKey === nextSortKey && prevDir === "desc" ? "asc" : "desc"));
      return nextSortKey;
    });
    setJobHistoryOffset(0);
  }

  function onHistoryLimitChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextLimit = Number(e.currentTarget.value) as (typeof HISTORY_PAGE_SIZES)[number];
    if (!HISTORY_PAGE_SIZES.includes(nextLimit)) return;
    setJobHistoryLimit(nextLimit);
    setJobHistoryOffset(0);
  }

  async function onCheckDoctor() {
    setDoctorBusy(true);
    setError(null);
    try {
      const next = await getDoctorStatus();
      setDoctorStatus(next);
      await refreshSoakLast();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setDoctorBusy(false);
    }
  }

  const isLoopDisplay = lastTableSourceRef.current === "loop";
  const displayedRows = isLoopDisplay ? loopAggRows : results;
  const loopDisplayRows = useMemo(() => {
    if (!isLoopDisplay) return displayedRows;
    const start = (page - 1) * pageSize;
    return displayedRows.slice(start, start + pageSize);
  }, [displayedRows, isLoopDisplay, page]);
  const totalPages = Math.max(1, Math.ceil((isLoopDisplay ? displayedRows.length : totalRows) / pageSize));
  const jobHistoryCurrentPage = Math.floor(jobHistoryOffset / jobHistoryLimit) + 1;
  const jobHistoryTotalPages = Math.max(1, Math.ceil(jobHistoryTotal / jobHistoryLimit));
  const historyHoursByJobId = useMemo(() => {
    const map: Record<string, string> = {};
    jobHistory.forEach((row) => {
      const tapeIds = row.runPayload.tapeIds ?? [];
      if (tapeIds.length < 1) {
        map[row.jobId] = "-";
        return;
      }
      const baseIds = Array.from(new Set(tapeIds.map((id) => String(id).replace(/-seg\d+$/, ""))));
      if (baseIds.length !== 1) {
        // Multi-tape runs are not resolved to a single time window in the UI.
        map[row.jobId] = "-";
        return;
      }
      const tapeId = baseIds[0];
      const bounds = tapeBoundsById[tapeId];
      let fromTs = row.runPayload.timeRangeFromTs;
      let toTs = row.runPayload.timeRangeToTs;
      if (!Number.isFinite(Number(fromTs))) fromTs = bounds?.startTs ?? undefined;
      if (!Number.isFinite(Number(toTs))) toTs = bounds?.endTs ?? undefined;
      if (!Number.isFinite(Number(fromTs)) || !Number.isFinite(Number(toTs))) {
        map[row.jobId] = "-";
        return;
      }
      const delta = Number(toTs) - Number(fromTs);
      if (!Number.isFinite(delta) || delta < 0) {
        map[row.jobId] = "-";
        return;
      }
      map[row.jobId] = (delta / 3600000).toFixed(2);
    });
    return map;
  }, [jobHistory, tapeBoundsById]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const maxOffset = Math.max(0, (jobHistoryTotalPages - 1) * jobHistoryLimit);
    if (jobHistoryOffset > maxOffset) setJobHistoryOffset(maxOffset);
  }, [jobHistoryLimit, jobHistoryOffset, jobHistoryTotalPages]);
  const isRunningStatus = jobStatus === "running";
  const hasTapeSelected = selectedTapeIds.length > 0;
  const singleJobProcessActive = !loopActive && Boolean(singleJobId) && (jobStatus === "running" || jobStatus === "paused");
  const startedAtForActiveJobId = activeJobId ? (jobStartedAtMs ?? startedAtByJobIdRef.current[activeJobId] ?? null) : jobStartedAtMs;
  const endMs = !startedAtForActiveJobId
    ? null
    : isRunningStatus
      ? nowMs
      : (jobFinishedAtMs ?? jobUpdatedAtMs ?? startedAtForActiveJobId);
  const elapsedSec = endMs == null || !startedAtForActiveJobId ? null : Math.max(0, (endMs - startedAtForActiveJobId) / 1000);
  const pctDone = clamp(roundTo2(done), 0, 100);
  const etaSec = isRunningStatus && elapsedSec != null && startedAtForActiveJobId != null && pctDone > 0.1 && pctDone < 100
    ? (elapsedSec * (100 - pctDone)) / pctDone
    : null;
  const lastJobSnapshotExists = Boolean(
    jobStatus !== "idle" ||
    jobStartedAtMs !== null ||
    jobUpdatedAtMs !== null ||
    jobFinishedAtMs !== null ||
    done > 0 ||
    total > 0
  );
  const showProgressBlock = Boolean(activeJobId) || loopActive || lastJobSnapshotExists;
  const pct = pctDone;
  const loopStartMs = loopStatus?.loop?.createdAtMs ?? null;
  const loopEndMs = !loopStartMs
    ? null
    : loopRunning
      ? nowMs
      : (loopStatus?.loop?.finishedAtMs ?? loopStatus?.loop?.updatedAtMs ?? loopStartMs);
  const loopElapsedSec = loopStartMs == null || loopEndMs == null ? null : Math.max(0, (loopEndMs - loopStartMs) / 1000);

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
        onPause={() => void pause()}
        onResume={() => void resume()}
        canPause={canPause}
        canResume={canResume}
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
              <Button size="sm" variant="outline-secondary" onClick={() => { setTapesDirDraft(tapesDir); setShowTapesDirModal(true); }}>
                Tapes directory
              </Button>
              <span style={{ fontSize: 12 }}>
                recording: <b>{isRecording ? "ON" : "OFF"}</b>
                {recordingTapeId ? ` · ${recordingTapeId}` : ""}
              </span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Recording is controlled by Session RUNNING state.</span>
            </div>
            <div style={{ fontSize: 12, marginBottom: 8 }}>tapesDir: <b>{tapesDir || "-"}</b></div>

            <TapesTable
              isRecording={isRecording}
              selectedTapeIds={selectedTapeIds}
              onToggleTape={onToggleTape}
              refreshKey={tapesRefreshKey}
              recordingTapeId={recordingTapeId}
              onError={setError}
              onTapesLoaded={handleTapesLoaded}
            />

            <details style={{ marginBottom: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13 }}><b>Doctor</b></summary>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <Button size="sm" variant="outline-secondary" onClick={() => void onCheckDoctor()} disabled={doctorBusy}>Check</Button>
                {doctorStatus ? (
                  <div style={{ marginTop: 8 }}>
                    <div>ok: <b>{doctorStatus.ok ? "true" : "false"}</b></div>
                    <div>http: <b>{doctorStatus.ports.http}</b></div>
                    <div>dataDir free: <b>{doctorStatus.dataDirBytesFree == null ? "-" : doctorStatus.dataDirBytesFree.toLocaleString()}</b></div>
                    <div>low disk: <b>{doctorStatus.warnings.includes("low_disk") ? "YES" : "NO"}</b></div>
                    <div>warnings: <b>{doctorStatus.warnings.length}</b></div>
                    {doctorStatus.warnings.length ? <ul style={{ marginBottom: 0 }}>{doctorStatus.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
                    <div>Last soak snapshot: <b>{lastSoak?.tsMs ? new Date(lastSoak.tsMs).toLocaleString() : "-"}</b></div>
                  </div>
                ) : null}
              </div>
            </details>

            <h6>Optimization</h6>
            <Row className="g-2 align-items-end mb-2">
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>candidates</Form.Label>
                <Form.Control value={candidates} onChange={(e) => setCandidates(e.currentTarget.value)} type="number" min={1} max={2000} />
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>seed</Form.Label>
                <Form.Control value={seed} onChange={(e) => setSeed(e.currentTarget.value)} type="number" />
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>minTrades</Form.Label>
                <Form.Control value={minTrades} onChange={(e) => setMinTrades(e.currentTarget.value)} type="number" min={0} step={1} />
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>direction</Form.Label>
                <Form.Select value={directionMode} onChange={(e) => setDirectionMode(e.currentTarget.value as "both" | "long" | "short")}>
                  <option value="both">Both</option>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </Form.Select>
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>tf (opt)</Form.Label>
                <Form.Select value={optTfMin} onChange={(e) => setOptTfMin(e.currentTarget.value)}>
                  <option value="1">1</option>
                  <option value="3">3</option>
                  <option value="5">5</option>
                  <option value="15">15</option>
                  <option value="30">30</option>
                  <option value="60">60</option>
                </Form.Select>
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>runsCount</Form.Label>
                <Form.Control value={loopRunsCount} onChange={(e) => setLoopRunsCount(e.currentTarget.value)} type="number" min={1} step={1} disabled={loopInfinite} />
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>dataset</Form.Label>
                <Form.Select value={datasetMode} onChange={(e) => setDatasetMode(e.currentTarget.value as "snapshot" | "followTail")}>
                  <option value="snapshot">Snapshot</option>
                  <option value="followTail">Follow Tail</option>
                </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>from</Form.Label>
                <Form.Control
                  value={timeRangeFromTs}
                  onChange={(e) => setTimeRangeFromTs(e.currentTarget.value)}
                  type="datetime-local"
                  min={toDatetimeLocalValue(selectedTapeBounds?.startTs)}
                  max={toDatetimeLocalValue(selectedTapeBounds?.endTs)}
                />
                </Form.Group>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>to</Form.Label>
                <Form.Control
                  value={timeRangeToTs}
                  onChange={(e) => setTimeRangeToTs(e.currentTarget.value)}
                  type="datetime-local"
                  min={toDatetimeLocalValue(selectedTapeBounds?.startTs)}
                  max={toDatetimeLocalValue(selectedTapeBounds?.endTs)}
                />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {selectedTapeBounds?.startTs != null && selectedTapeBounds?.endTs != null
                    ? `Tape range: ${formatTs(selectedTapeBounds.startTs)} → ${formatTs(selectedTapeBounds.endTs)}`
                    : "Tape range: unknown"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Using: {effectiveTimeRangePreview.from != null ? formatTs(effectiveTimeRangePreview.from) : "-"} → {effectiveTimeRangePreview.to != null ? formatTs(effectiveTimeRangePreview.to) : "-"}
                </div>
              </Col>
              <Col xs={12}>
                <div className="d-flex flex-wrap gap-3">
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Hide negative netPnl" checked={excludeNegative} disabled={loopActive} onChange={(e) => setExcludeNegative(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Remember negatives for this tape" checked={rememberNegatives} disabled={loopActive} onChange={(e) => setRememberNegatives(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Loop until Stop" checked={loopInfinite} disabled={loopActive} onChange={(e) => setLoopInfinite(e.currentTarget.checked)} />
                  </Form.Group>
                </div>
              </Col>
            </Row>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button onClick={() => void onRunOptimization()} disabled={!(hasTapeSelected && !loopActive && !singleJobProcessActive && !rangeError)}>
                  Run optimization
                </Button>
              </Col>
              <Col xs="auto">
                <ButtonGroup>
                  <Button variant="outline-warning" onClick={() => void onPauseOptimization()} disabled={!hasTapeSelected || !singleJobProcessActive || jobStatus !== "running"}>Pause</Button>
                  <Button variant="outline-primary" onClick={() => void onResumeOptimization()} disabled={!hasTapeSelected || !singleJobProcessActive || jobStatus !== "paused"}>Resume</Button>
                  <Button variant="outline-danger" onClick={() => void onStopOptimization()} disabled={!hasTapeSelected || !singleJobProcessActive}>Stop</Button>
                </ButtonGroup>
              </Col>
            </Row>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button variant="outline-primary" onClick={() => void onStartLoop()} disabled={loopBusy || loopRunning || loopPaused || !hasTapeSelected || Boolean(rangeError)}>Start loop</Button>
              </Col>
              <Col xs="auto">
                <ButtonGroup>
                  <Button variant="outline-warning" onClick={() => void onPauseLoop()} disabled={loopBusy || loopStopped || loopPaused}>Pause loop</Button>
                  <Button variant="outline-success" onClick={() => void onResumeLoop()} disabled={loopBusy || loopStopped || !loopPaused}>Resume loop</Button>
                  <Button variant="outline-danger" onClick={() => void onStopLoop()} disabled={loopBusy || loopStopped}>Stop loop</Button>
                </ButtonGroup>
              </Col>
            </Row>

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
                {(["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs"] as RangeKey[]).map((key) => (
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
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Loop: <b>{loopRunning ? (loopPaused ? "paused" : "running") : "stopped"}</b>
              {loopExists && loopStatus?.loop ? ` · Run ${loopStatus.runsCompleted ?? loopStatus.loop.runIndex}/${loopStatus.runsTotal == null ? "∞" : loopStatus.runsTotal}` : ""}
            </div>
            <div style={{ fontSize: 12, marginBottom: 8 }}>Loop elapsed: <b>{formatDuration(loopElapsedSec)}</b></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            </div>

            {showProgressBlock ? <>
              <ProgressBar now={pct} label={`${pct.toFixed(2)}%`} title={`progress ${pct.toFixed(2)} / ${total.toFixed(2)}`} className="mb-2" />
              <div style={{ fontSize: 12, marginBottom: 8 }}>Elapsed: <b>{formatDuration(elapsedSec ?? 0)}</b> · ETA: <b>{isRunningStatus ? formatEta(etaSec) : "-"}</b></div>
              <div style={{ fontSize: 12, marginBottom: 8 }}>Hide negative: <b>{excludeNegative ? "ON" : "OFF"}</b></div>
            </> : null}

            <div className="d-flex align-items-center gap-2 mb-2">
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => window.open(singleJobId ? getJobExportUrl(singleJobId, "json", sortKey, sortDir) : getCurrentJobExportUrl("json", sortKey, sortDir), "_blank", "noopener,noreferrer")}
                disabled={!singleJobId && !activeJobId}
              >
                Export JSON
              </Button>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => window.open(singleJobId ? getJobExportUrl(singleJobId, "csv", sortKey, sortDir) : getCurrentJobExportUrl("csv", sortKey, sortDir), "_blank", "noopener,noreferrer")}
                disabled={!singleJobId && !activeJobId}
              >
                Export CSV
              </Button>
            </div>

            <Table striped bordered hover size="sm">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("netPnl")}>netPnl</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("trades")}>trades</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("winRatePct")}>winRate</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("expectancy")}>expectancy</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("profitFactor")}>profitFactor</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("maxDrawdownUsdt")}>maxDD</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("ordersPlaced")}>placed</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("ordersFilled")}>filled</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("ordersExpired")}>expired</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("priceTh")}>priceTh</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("oivTh")}>oivTh</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("tp")}>tp</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("sl")}>sl</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("offset")}>offset</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("timeoutSec")}>timeoutSec</th>
                  <th style={{ cursor: "pointer" }} onClick={() => void onSort("rearmMs")}>rearmMs</th>
                  <th>action</th>
                </tr>
              </thead>
              <tbody>
                {loopDisplayRows.map((r) => {
                  return (
                    <tr key={`${r.rank}-${r.netPnl}`}>
                      <td>{r.rank}</td>
                      <td>{r.netPnl.toFixed(4)}</td>
                      <td>{r.trades}</td>
                      <td>{r.winRatePct.toFixed(2)}%</td>
                      <td>{r.expectancy.toFixed(4)}</td>
                      <td>{r.profitFactor.toFixed(3)}</td>
                      <td>{r.maxDrawdownUsdt.toFixed(4)}</td>
                      <td>{r.ordersPlaced}</td>
                      <td>{r.ordersFilled}</td>
                      <td>{r.ordersExpired}</td>
                      <td>{r.params.priceThresholdPct.toFixed(activePrecision.priceTh)}</td>
                      <td>{r.params.oivThresholdPct.toFixed(activePrecision.oivTh)}</td>
                      <td>{r.params.tpRoiPct.toFixed(activePrecision.tp)}</td>
                      <td>{r.params.slRoiPct.toFixed(activePrecision.sl)}</td>
                      <td>{r.params.entryOffsetPct.toFixed(activePrecision.offset)}</td>
                      <td>{r.params.timeoutSec.toFixed(activePrecision.timeoutSec)}</td>
                      <td>{r.params.rearmMs.toFixed(activePrecision.rearmMs)}</td>
                      <td>
                        <Button size="sm" variant="outline-secondary" onClick={() => copyToSettings(r)}>Copy to settings</Button>
                      </td>
                    </tr>
                  );
                })}
                {!loopDisplayRows.length ? (
                  <tr>
                    <td colSpan={19} style={{ fontSize: 12, opacity: 0.75 }}>No results</td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
            {displayedRows.length ? (
              <Pagination>
                <Pagination.Prev onClick={() => void onPageChange(Math.max(1, page - 1))} disabled={page <= 1} />
                <Pagination.Item active>{page}</Pagination.Item>
                <Pagination.Next onClick={() => void onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} />
              </Pagination>
            ) : null}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header><b>Completed / Stopped runs</b></Card.Header>
          <Card.Body>
            <div className="d-flex align-items-center justify-content-between mb-2" style={{ fontSize: 12 }}>
              <div className="d-flex align-items-center gap-2">
                <span>Rows per page</span>
                <Form.Select size="sm" value={jobHistoryLimit} onChange={onHistoryLimitChange} style={{ width: 90 }}>
                  {HISTORY_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                </Form.Select>
              </div>
              <div>
                Page <b>{jobHistoryCurrentPage}</b> of <b>{jobHistoryTotalPages}</b> · Total <b>{jobHistoryTotal}</b>
              </div>
            </div>
            <Table striped bordered hover size="sm" style={{ tableLayout: "auto", width: "auto" }}>
              <thead>
                <tr>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("jobId")}>runId</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("endedAtMs")}>endedAt</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("status")}>status</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("mode")}>mode</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("tapes")}>tapes</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("tfMin")}>tfMin</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("candidates")}>candidates</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("seed")}>seed</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("minTrades")}>minTrades</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("direction")}>direction</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("rememberNegatives")}>rememberNegatives</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("hideNegativeNetPnl")}>hideNegativeNetPnl</th>
                  <th>hours</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("bestNetPnl")}>bestNetPnl</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("bestTrades")}>bestTrades</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("bestWinRate")}>bestWinRate</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("bestProfitFactor")}>bestProfitFactor</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("bestMaxDD")}>bestMaxDD</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("rowsPositive")}>rowsPositive</th>
                  <th style={{ cursor: "pointer" }} onClick={() => onHistorySort("rowsTotal")}>rowsTotal</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {jobHistory.map((row) => {
                  const isOpen = Boolean(expandedHistory[row.jobId]);
                  const detailsRows = historyResults[row.jobId] ?? [];
                  return (
                    <Fragment key={row.jobId}>
                      <tr>
                        <td>{row.jobId.slice(-8)}</td>
                        <td style={{ padding: "4px 8px" }}><span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{new Date(row.endedAtMs).toLocaleString()}</span></td>
                        <td>{row.status.toUpperCase()}</td>
                        <td>{row.mode ?? "-"}</td>
                        <td title={row.runPayload.tapeIds.join(",")}>{row.runPayload.tapeIds.length}</td>
                        <td>{row.runPayload.optTfMin ?? "-"}</td>
                        <td>{row.runPayload.candidates}</td>
                        <td>{row.runPayload.seed}</td>
                        <td>{row.runPayload.minTrades}</td>
                        <td>{row.runPayload.directionMode}</td>
                        <td>{row.runPayload.rememberNegatives ? "true" : "false"}</td>
                        <td>{row.runPayload.excludeNegative ? "true" : "false"}</td>
                        <td>{historyHoursByJobId[row.jobId] ?? "-"}</td>
                        <td>{row.summary.bestNetPnl == null ? "-" : row.summary.bestNetPnl.toFixed(4)}</td>
                        <td>{row.summary.bestTrades ?? "-"}</td>
                        <td>{row.summary.bestWinRate == null ? "-" : `${row.summary.bestWinRate.toFixed(2)}%`}</td>
                        <td>{row.summary.bestProfitFactor == null ? "-" : row.summary.bestProfitFactor.toFixed(3)}</td>
                        <td>{row.summary.bestMaxDD == null ? "-" : row.summary.bestMaxDD.toFixed(4)}</td>
                        <td>{row.summary.rowsPositive}</td>
                        <td>{row.summary.rowsTotal}</td>
                        <td><Button size="sm" variant="outline-secondary" onClick={() => void toggleHistoryRow(row.jobId)}>{isOpen ? "Hide" : "View"}</Button></td>
                      </tr>
                      <tr>
                        <td colSpan={21} style={{ padding: 0, borderTop: 0 }}>
                          <Collapse in={isOpen}>
                            <div style={{ padding: isOpen ? 10 : 0, background: "#f5f5f5", borderLeft: "3px solid #d0d0d0", marginTop: 2 }}>
                              {historyLoading[row.jobId] ? <div style={{ fontSize: 12 }}>Loading...</div> : null}
                              {!historyLoading[row.jobId] && row.summary.rowsPositive === 0 ? <div style={{ fontSize: 12 }}>No positive results</div> : null}
                              {!historyLoading[row.jobId] && row.summary.rowsPositive > 0 ? (
                                <Table striped bordered hover size="sm" className="mb-0" style={{ marginTop: 8, marginLeft: 8 }}>
                                  <thead>
                                    <tr>
                                      <th>Rank</th><th>netPnl</th><th>trades</th><th>winRate</th><th>expectancy</th><th>profitFactor</th><th>maxDD</th>
                                      <th>placed</th><th>filled</th><th>expired</th><th>priceTh</th><th>oivTh</th><th>tp</th><th>sl</th><th>offset</th><th>timeoutSec</th><th>rearmMs</th><th>action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailsRows.map((r) => (
                                      <tr key={`${row.jobId}-${r.rank}-${r.netPnl}`}>
                                        <td>{r.rank}</td><td>{r.netPnl.toFixed(4)}</td><td>{r.trades}</td><td>{r.winRatePct.toFixed(2)}%</td><td>{r.expectancy.toFixed(4)}</td><td>{r.profitFactor.toFixed(3)}</td><td>{r.maxDrawdownUsdt.toFixed(4)}</td>
                                        <td>{r.ordersPlaced}</td><td>{r.ordersFilled}</td><td>{r.ordersExpired}</td><td>{r.params.priceThresholdPct.toFixed(activePrecision.priceTh)}</td><td>{r.params.oivThresholdPct.toFixed(activePrecision.oivTh)}</td><td>{r.params.tpRoiPct.toFixed(activePrecision.tp)}</td><td>{r.params.slRoiPct.toFixed(activePrecision.sl)}</td><td>{r.params.entryOffsetPct.toFixed(activePrecision.offset)}</td><td>{r.params.timeoutSec.toFixed(activePrecision.timeoutSec)}</td><td>{r.params.rearmMs.toFixed(activePrecision.rearmMs)}</td>
                                        <td><Button size="sm" variant="outline-secondary" onClick={() => copyToSettings(r)}>Copy to settings</Button></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </Table>
                              ) : null}
                            </div>
                          </Collapse>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                {!jobHistory.length ? (
                  <tr>
                    <td colSpan={21} style={{ fontSize: 12, opacity: 0.75 }}>No completed runs</td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
            {jobHistoryTotal > 0 ? (
              <Pagination>
                <Pagination.Prev
                  onClick={() => setJobHistoryOffset(Math.max(0, jobHistoryOffset - jobHistoryLimit))}
                  disabled={jobHistoryOffset <= 0}
                />
                {Array.from({ length: jobHistoryTotalPages }, (_, i) => i + 1).slice(Math.max(0, jobHistoryCurrentPage - 3), Math.max(0, jobHistoryCurrentPage - 3) + 5).map((pageNum) => (
                  <Pagination.Item
                    key={pageNum}
                    active={pageNum === jobHistoryCurrentPage}
                    onClick={() => setJobHistoryOffset((pageNum - 1) * jobHistoryLimit)}
                  >
                    {pageNum}
                  </Pagination.Item>
                ))}
                <Pagination.Next
                  onClick={() => setJobHistoryOffset(Math.min((jobHistoryTotalPages - 1) * jobHistoryLimit, jobHistoryOffset + jobHistoryLimit))}
                  disabled={jobHistoryCurrentPage >= jobHistoryTotalPages}
                />
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
