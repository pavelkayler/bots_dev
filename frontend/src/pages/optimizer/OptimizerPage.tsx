import { memo, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ButtonGroup, Card, Col, Container, Form, Modal, Pagination, ProgressBar, Row, Table } from "react-bootstrap";
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
  type DoctorStatus,
  type OptimizerLoopStatus,
  type OptimizationResult,
  type SoakLastStatus,
  type OptimizerPrecision,
  type OptimizerSortDir,
  type OptimizerSortKeyExtended,
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

type TapeRow = { id: string; createdAt: number; symbolsCount: number; tf: number | null; initialBytes: number; runsTotal: number };


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
            runsTotal: Number(t.runsTotal) || 0,
          };
          const old = prevById.get(t.id);
          if (!old) return next;
          if (old.createdAt === next.createdAt && old.symbolsCount === next.symbolsCount && old.tf === next.tf && old.initialBytes === next.initialBytes && old.runsTotal === next.runsTotal) return old;
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
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [minTrades, setMinTrades] = useState("1");
  const [directionMode, setDirectionMode] = useState<"both" | "long" | "short">("both");
  const [optTfMin, setOptTfMin] = useState<string>("");
  const [excludeNegative, setExcludeNegative] = useState(false);
  const [rememberNegatives, setRememberNegatives] = useState(false);
  const [, setOptimizerPaused] = useState(false);
  const [jobStartedAtMs, setJobStartedAtMs] = useState<number | null>(null);
  const [jobUpdatedAtMs, setJobUpdatedAtMs] = useState<number | null>(null);
  const [jobFinishedAtMs, setJobFinishedAtMs] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<"running" | "paused" | "done" | "error" | "cancelled" | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [singleJobId, setSingleJobId] = useState<string | null>(null);
  const [loopJobId, setLoopJobId] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const [results, setResults] = useState<OptimizationResult[]>([]);
  const [loopAggRows, setLoopAggRows] = useState<OptimizerResultRow[]>([]);
  const [loopAggMap, setLoopAggMap] = useState<Map<string, OptimizerResultRow>>(new Map());
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
  const rangesSaveTimerRef = useRef<number | null>(null);
  const lastStatusFetchRef = useRef<{ jobId: string | null; ts: number }>({ jobId: null, ts: 0 });
  const prevLoopJobIdRef = useRef<string | null>(null);
  const prevLoopActiveRef = useRef(false);

  const resetJobProgressState = useCallback(() => {
    setDone(0);
    setTotal(0);
    setJobStartedAtMs(null);
    setJobUpdatedAtMs(null);
    setJobFinishedAtMs(null);
    setJobStatus(null);
    setOptimizerPaused(false);
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
        setSingleJobId(current.jobId);
        const statusRes = await getJobStatus(current.jobId);
        setDone(statusRes.done);
        setTotal(statusRes.total);
        if (statusRes.startedAtMs) setJobStartedAtMs(statusRes.startedAtMs);
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

  useEffect(() => {
    try {
      if (!optTfMin.trim()) {
        localStorage.removeItem(OPT_TF_STORAGE_KEY);
      } else {
        const n = Math.floor(Number(optTfMin));
        if (Number.isFinite(n) && n >= 1) localStorage.setItem(OPT_TF_STORAGE_KEY, String(n));
      }
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
    if (jobStatus !== "running" && !loopStatus?.loop?.isRunning) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [jobStatus, loopStatus?.loop?.isRunning]);

  useEffect(() => {
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const next = await getOptimizerLoopStatus();
        setLoopStatus(next);
        const nextJobId = next.loop?.lastJobId ?? null;
        if (nextJobId !== loopJobId) {
          setLoopJobId(nextJobId);
        }
      } catch {
        return;
      }
    };
    void refresh();
    if (loopStatus?.loop?.isRunning || loopStatus?.loop?.isPaused) {
      timer = window.setInterval(() => {
        void refresh();
      }, 500);
    }
    return () => {
      if (timer != null) window.clearInterval(timer);
    };
  }, [loopJobId, loopStatus?.loop?.isPaused, loopStatus?.loop?.isRunning]);

  useEffect(() => {
    const prev = prevLoopJobIdRef.current;
    if (prev !== null && loopJobId !== null && prev !== loopJobId) {
      resetJobProgressState();
    }
    prevLoopJobIdRef.current = loopJobId;
  }, [loopJobId, resetJobProgressState]);

  const loopExists = Boolean(loopStatus?.loop);
  const loopRunning = Boolean(loopStatus?.loop?.isRunning);
  const loopPaused = Boolean(loopStatus?.loop?.isRunning && loopStatus?.loop?.isPaused);
  const loopActive = loopRunning || loopPaused;
  const loopStopped = !loopRunning;
  const jobActive = jobStatus === "running" || jobStatus === "paused";
  const [displayJobId, setDisplayJobId] = useState<string | null>(null);

  useEffect(() => {
    const nextJobId = loopActive ? (loopJobId ?? singleJobId) : (singleJobId ?? loopJobId);
    if (nextJobId) {
      setDisplayJobId((prev) => (prev === nextJobId ? prev : nextJobId));
      return;
    }
    if (!jobActive && !loopActive) {
      setDisplayJobId(null);
    }
  }, [jobActive, loopActive, loopJobId, singleJobId]);

  const activeJobId = displayJobId;

  useEffect(() => {
    const prevLoopActive = prevLoopActiveRef.current;
    if (prevLoopActive && !loopActive && loopAggRows.length > 0) {
      setSingleJobId(null);
    }
    prevLoopActiveRef.current = loopActive;
  }, [loopActive, loopAggRows.length]);

  async function onStartLoop() {
    if (!selectedTapeIds.length || rangeError) return;
    setError(null);
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
        candidates: Number(candidates),
        seed: Number(seed),
        minTrades: Math.max(0, Math.floor(Number(minTrades) || 0)),
        directionMode,
        ...(optTfMin.trim() ? { optTfMin: Number(optTfMin) } : {}),
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
      const merged = new Map(loopAggMap);
      for (const row of nextResults) {
        if (excludeNegative && row.netPnl < 0) continue;
        if (minTradesLimit > 0 && row.trades < minTradesLimit) continue;
        const signature = makeResultSignature(row);
        const existing = merged.get(signature);
        if (!existing || isBetterResult(row, existing)) {
          merged.set(signature, row);
        }
      }
      const sortedRows = Array.from(merged.values()).sort((a, b) => {
        if (b.netPnl !== a.netPnl) return b.netPnl - a.netPnl;
        return b.trades - a.trades;
      });
      setLoopAggMap(merged);
      setLoopAggRows(sortedRows);
      setTotalRows(sortedRows.length);
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
        timeoutSec: Math.max(countDecimals(ranges.timeoutSec.min), countDecimals(ranges.timeoutSec.max)),
        rearmMs: Math.max(countDecimals(ranges.rearmMs.min), countDecimals(ranges.rearmMs.max)),
      };
      const runRes = await runOptimizationJob({
        tapeIds: selectedTapeIds,
        candidates: Number(candidates),
        seed: Number(seed),
        minTrades: Math.max(0, Math.floor(Number(minTrades) || 0)),
        directionMode,
        ...(optTfMin.trim() ? { optTfMin: Number(optTfMin) } : {}),
        excludeNegative,
        rememberNegatives,
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
        precision,
      });
      setSingleJobId(runRes.jobId);
      setJobStartedAtMs(Date.now());
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
    if (!activeJobId || (!jobActive && !loopActive)) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const now = Date.now();
        if (lastStatusFetchRef.current.jobId === activeJobId && now - lastStatusFetchRef.current.ts < 200) return;
        lastStatusFetchRef.current = { jobId: activeJobId, ts: now };
        const res = await getJobStatus(activeJobId);
        if (!alive) return;
        setDone((prev) => (prev === res.done ? prev : res.done));
        setTotal((prev) => (prev === res.total ? prev : res.total));
        setJobStartedAtMs((prev) => {
          const next = res.startedAtMs ?? null;
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
        await fetchResults(page, sortKey, sortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
        if (!alive) return;
        if (res.status === "error") {
          setError(res.message ?? "Optimization job failed.");
        }
        if (res.status === "done" || res.status === "cancelled") {
          window.clearInterval(timer);
          if (res.status === "cancelled") setError(res.message ?? "Optimization cancelled.");
          await fetchResults(1, sortKey, sortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
          if (!alive) return;
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    }, 250);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeJobId, jobActive, loopActive, page, sortDir, sortKey]);


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

  const isLoopDisplay = loopActive || (!singleJobId && loopAggRows.length > 0);
  const displayedRows = loopActive
    ? loopAggRows
    : singleJobId
      ? results
      : (loopAggRows.length > 0 ? loopAggRows : results);
  const loopDisplayRows = useMemo(() => {
    if (!isLoopDisplay) return displayedRows;
    const start = (page - 1) * pageSize;
    return displayedRows.slice(start, start + pageSize);
  }, [displayedRows, isLoopDisplay, page]);
  const totalPages = Math.max(1, Math.ceil((isLoopDisplay ? displayedRows.length : totalRows) / pageSize));

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);
  const isRunningStatus = jobStatus === "running";
  const singleJobActive = !loopActive && Boolean(singleJobId) && (jobStatus === "running" || jobStatus === "paused");
  const endMs = !jobStartedAtMs
    ? null
    : isRunningStatus
      ? nowMs
      : (jobFinishedAtMs ?? jobUpdatedAtMs ?? jobStartedAtMs);
  const elapsedSec = endMs == null || !jobStartedAtMs ? null : Math.max(0, (endMs - jobStartedAtMs) / 1000);
  const etaSec = isRunningStatus && done > 0.01 && elapsedSec != null ? elapsedSec * (100 / done - 1) : null;
  const lastJobSnapshotExists = Boolean(
    jobStatus !== null ||
    jobStartedAtMs !== null ||
    jobUpdatedAtMs !== null ||
    jobFinishedAtMs !== null ||
    done > 0 ||
    total > 0
  );
  const showProgressBlock = Boolean(activeJobId) || loopActive || lastJobSnapshotExists;
  const pct = clamp(roundTo2(jobStatus === "done" ? 100 : done), 0, 100);
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
                  <option value="">Auto (tape tf)</option>
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
              <Col xs={12}>
                <div className="d-flex flex-wrap gap-3">
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Hide negative netPnl" checked={excludeNegative} onChange={(e) => setExcludeNegative(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Remember negatives for this tape" checked={rememberNegatives} onChange={(e) => setRememberNegatives(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Loop until Stop" checked={loopInfinite} onChange={(e) => setLoopInfinite(e.currentTarget.checked)} />
                  </Form.Group>
                </div>
              </Col>
            </Row>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button onClick={() => void onRunOptimization()} disabled={!selectedTapeIds.length || jobActive || loopActive || Boolean(rangeError)}>
                  Run optimization
                </Button>
              </Col>
              {singleJobActive ? (
                <Col xs="auto">
                  <ButtonGroup>
                    <Button variant="outline-warning" onClick={() => void onPauseOptimization()} disabled={jobStatus !== "running"}>Pause</Button>
                    <Button variant="outline-primary" onClick={() => void onResumeOptimization()} disabled={jobStatus !== "paused"}>Resume</Button>
                    <Button variant="outline-danger" onClick={() => void onStopOptimization()} disabled={!singleJobActive}>Stop</Button>
                  </ButtonGroup>
                </Col>
              ) : null}
              <Col xs="auto">
                <Button variant="outline-primary" onClick={() => void onStartLoop()} disabled={loopBusy || loopRunning || loopPaused || !selectedTapeIds.length || Boolean(rangeError)}>Start loop</Button>
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
              <div style={{ fontSize: 12, marginBottom: 8 }}>Elapsed: <b>{formatDuration(elapsedSec ?? 0)}</b> · ETA: <b>{isRunningStatus ? formatDuration(etaSec) : "-"}</b></div>
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
