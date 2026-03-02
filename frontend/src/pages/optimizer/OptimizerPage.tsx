import { Fragment, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ButtonGroup, Card, Col, Collapse, Container, Form, Pagination, Row, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeedLite } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import {
  getJobResults,
  getJobStatus,
  getCurrentJob,
  getStatus,
  getJobExportUrl,
  getCurrentJobExportUrl,
  startOptimizerLoop,
  stopOptimizerLoop,
  pauseOptimizerLoop,
  resumeOptimizerLoop,
  getOptimizerLoopStatus,
  getOptimizerJobHistory,
  exportOptimizerHistory,
  importOptimizerHistory,
  type OptimizerJobHistoryRecord,
  type OptimizerLoopStatus,
  type OptimizationResult,
  type OptimizerPrecision,
  type OptimizerSortDir,
  type OptimizerSortKeyExtended,
  type OptimizerHistorySortKey,
} from "../../features/optimizer/api/optimizerApi";
import { CenteredProgressBar } from "../../shared/ui/CenteredProgressBar";
import DatasetTargetCard from "../../features/datasetTarget/ui/DatasetTargetCard";
import { DATASET_CACHE_STORAGE_KEY } from "../../features/dataReceive/api/dataReceiveApi";

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
const SIM_MARGIN_STORAGE_KEY = "bots_dev.optimizer.sim.marginPerTrade";
const SIM_LEVERAGE_STORAGE_KEY = "bots_dev.optimizer.sim.leverage";
const SIM_FEE_BPS_STORAGE_KEY = "bots_dev.optimizer.sim.feeBps";
const SIM_FUNDING_BPS_STORAGE_KEY = "bots_dev.optimizer.sim.fundingBpsPer8h";
const SIM_SLIPPAGE_BPS_STORAGE_KEY = "bots_dev.optimizer.sim.slippageBps";
const EXCLUDE_NEGATIVE_STORAGE_KEY = "bots_dev.optimizer.excludeNegative";
const REMEMBER_NEGATIVES_STORAGE_KEY = "bots_dev.optimizer.rememberNegatives";
const LOOP_RUNS_COUNT_STORAGE_KEY = "bots_dev.optimizer.loopRunsCount";
const LOOP_INFINITE_STORAGE_KEY = "bots_dev.optimizer.loopInfinite";
const TOP_RESULTS_SINGLE_STORAGE_KEY = "bots_dev.optimizer.topResults.single";
const LOOP_RESULTS_DRAFT_STORAGE_KEY = "optimizerLoopResultsDraft";
const DATASET_CACHE_ERROR = "Run Receive Data first";

const RANGES_SAVE_DEBOUNCE_MS = 400;
const DEFAULT_PRECISION: OptimizerPrecision = { priceTh: 3, oivTh: 3, tp: 3, sl: 3, offset: 3, timeoutSec: 0, rearmMs: 0 };
const HISTORY_COMPACT_BREAKPOINT_PX = 1400;
const ACTIVE_RESULTS_POLL_MS = 800;
const LOOP_STATUS_POLL_MS = 1000;

const HISTORY_TABLE_STYLE = { tableLayout: "fixed", width: "100%", fontSize: 12 } as const;
const HISTORY_CELL_STYLE = { padding: "4px 6px", whiteSpace: "nowrap", verticalAlign: "middle", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12 } as const;
const HISTORY_DETAILS_CELL_STYLE = { padding: 0, borderTop: 0 } as const;

function parseMaybeNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function formatHistoryEndedAt(tsMs: number): string {
  const d = new Date(tsMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}:${sec}`;
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
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
  const total = Math.floor(sec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function formatSimSummary(sim: { marginPerTrade?: number; leverage?: number } | undefined): string {
  const margin = Number(sim?.marginPerTrade);
  const lev = Number(sim?.leverage);
  if (!Number.isFinite(margin) || !Number.isFinite(lev)) return "-";
  return `m=${margin}, lev=${lev}`;
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

function areTopResultsSimilar(prev: OptimizationResult[], next: OptimizationResult[]): boolean {
  if (prev.length !== next.length) return false;
  if (prev.length === 0) return true;
  const prevTop = prev[0];
  const nextTop = next[0];
  return prevTop.rank === nextTop.rank && prevTop.netPnl === nextTop.netPnl;
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

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function OptimizerPage() {
  const { conn, lastServerTime, wsUrl, streams } = useWsFeedLite();
  const { status, busy, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();

  const [error, setError] = useState<string | null>(null);
  const [optimizerDataSource, setOptimizerDataSource] = useState<string | null>(null);
  const [optimizerStatusWarning, setOptimizerStatusWarning] = useState<string | null>(null);
  const [datasetCache, setDatasetCache] = useState<string | null>(() => localStorage.getItem(DATASET_CACHE_STORAGE_KEY));

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [minTrades, setMinTrades] = useState("1");
  const [simMarginPerTrade, setSimMarginPerTrade] = useState(() => localStorage.getItem(SIM_MARGIN_STORAGE_KEY) ?? "10");
  const [simLeverage, setSimLeverage] = useState(() => localStorage.getItem(SIM_LEVERAGE_STORAGE_KEY) ?? "5");
  const [simFeeBps, setSimFeeBps] = useState(() => localStorage.getItem(SIM_FEE_BPS_STORAGE_KEY) ?? "0");
  const [simFundingBpsPer8h, setSimFundingBpsPer8h] = useState(() => localStorage.getItem(SIM_FUNDING_BPS_STORAGE_KEY) ?? "0");
  const [simSlippageBps, setSimSlippageBps] = useState(() => localStorage.getItem(SIM_SLIPPAGE_BPS_STORAGE_KEY) ?? "0");
  const [directionMode, setDirectionMode] = useState<"both" | "long" | "short">("both");
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

  const [results, setResults] = useState<OptimizationResult[]>(() => safeJsonParse<OptimizationResult[]>(localStorage.getItem(TOP_RESULTS_SINGLE_STORAGE_KEY)) ?? []);
  const [loopAggRows, setLoopAggRows] = useState<OptimizerResultRow[]>(() => safeJsonParse<OptimizerResultRow[]>(localStorage.getItem(LOOP_RESULTS_DRAFT_STORAGE_KEY)) ?? []);

useEffect(() => {
  saveJson(TOP_RESULTS_SINGLE_STORAGE_KEY, results);
}, [results]);

  useEffect(() => {
    const syncDatasetCache = () => setDatasetCache(localStorage.getItem(DATASET_CACHE_STORAGE_KEY));
    syncDatasetCache();
    const timer = window.setInterval(syncDatasetCache, 500);
    const onStorage = (event: StorageEvent) => {
      if (event.key === DATASET_CACHE_STORAGE_KEY) syncDatasetCache();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, []);


useEffect(() => {
  saveJson(LOOP_RESULTS_DRAFT_STORAGE_KEY, loopAggRows);
}, [loopAggRows]);

  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [sortKey, setSortKey] = useState<OptimizerSortKeyExtended>("netPnl");
  const [sortDir, setSortDir] = useState<OptimizerSortDir>("desc");
  const [jobPrecisionById] = useState<Record<string, OptimizerPrecision>>({});

  const [ranges, setRanges] = useState<RangeState>(RANGE_DEFAULTS);
  const [loopRunsCount, setLoopRunsCount] = useState("3");
  const [loopInfinite, setLoopInfinite] = useState(false);
  const [loopStatus, setLoopStatus] = useState<OptimizerLoopStatus | null>(null);
  const [loopBusy, setLoopBusy] = useState(false);
  const [jobHistory, setJobHistory] = useState<OptimizerJobHistoryRecord[]>([]);
  const [jobHistoryTotal, setJobHistoryTotal] = useState(0);
  const [jobHistoryLimit, setJobHistoryLimit] = useState<(typeof HISTORY_PAGE_SIZES)[number]>(25);
  const [jobHistoryOffset, setJobHistoryOffset] = useState(0);
  const [jobHistorySortKey, setJobHistorySortKey] = useState<OptimizerHistorySortKey>("endedAtMs");
  const [jobHistorySortDir, setJobHistorySortDir] = useState<OptimizerSortDir>("desc");
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [historyResults, setHistoryResults] = useState<Record<string, OptimizationResult[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [historyCompactMode, setHistoryCompactMode] = useState(() => window.innerWidth < HISTORY_COMPACT_BREAKPOINT_PX);
  const [historyTransferMessage, setHistoryTransferMessage] = useState<string | null>(null);
  const rangesSaveTimerRef = useRef<number | null>(null);
  const lastStatusFetchRef = useRef<{ jobId: string | null; ts: number }>({ jobId: null, ts: 0 });
  const prevLoopJobIdRef = useRef<string | null>(null);
  const prevLoopActiveRef = useRef(false);
  const lastNonNullLoopJobIdRef = useRef<string | null>(null);
  const lastPctByJobIdRef = useRef<Record<string, number>>({});
  const pauseFreezeAtMsRef = useRef<number | null>(null);
  const startedAtByJobIdRef = useRef<Record<string, number>>({});
  const lastTableSourceRef = useRef<"loop" | "single">("single");
  const historyImportInputRef = useRef<HTMLInputElement | null>(null);
  const completedLoopRunIdsRef = useRef<Record<string, boolean>>({});
  const prevLoopRunningRef = useRef(false);

  useEffect(() => {
    let timer: number | null = null;
    const onResize = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = window.innerWidth < HISTORY_COMPACT_BREAKPOINT_PX;
        setHistoryCompactMode((prev) => (prev === next ? prev : next));
      }, 120);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const clearSingleJobState = useCallback(() => {
    setSingleJobId(null);
    setJobStatus("idle");
    setDone(0);
    setTotal(0);
    setResults([]);
    setPage(1);
    setTotalRows(0);
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
      setOptimizerStatusWarning(null);
      setOptimizerDataSource(statusRes.dataSource ?? null);
    } catch (e: any) {
      const message = String(e?.message ?? e ?? "");
      if (message.toLowerCase().includes("aborterror")) return;
      setOptimizerStatusWarning("Status unavailable");
    }
  }



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
          setSingleJobId(null);
          setJobStatus("idle");
          setOptimizerPaused(false);
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
          setSingleJobId(null);
          setJobStatus("idle");
          setOptimizerPaused(false);
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
    localStorage.setItem(SIM_MARGIN_STORAGE_KEY, simMarginPerTrade);
  }, [simMarginPerTrade]);

  useEffect(() => {
    localStorage.setItem(SIM_LEVERAGE_STORAGE_KEY, simLeverage);
  }, [simLeverage]);

  useEffect(() => {
    localStorage.setItem(SIM_FEE_BPS_STORAGE_KEY, simFeeBps);
  }, [simFeeBps]);

  useEffect(() => {
    localStorage.setItem(SIM_FUNDING_BPS_STORAGE_KEY, simFundingBpsPer8h);
  }, [simFundingBpsPer8h]);

  useEffect(() => {
    localStorage.setItem(SIM_SLIPPAGE_BPS_STORAGE_KEY, simSlippageBps);
  }, [simSlippageBps]);

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
  const loopPaused = Boolean(loopStatus?.loop?.isPaused);
  const loopRunning = Boolean(loopStatus?.loop?.isRunning) && !loopPaused;
  const loopActive = loopRunning || loopPaused;
  const loopStopped = !loopRunning;
  const jobActive = jobStatus === "running" || jobStatus === "paused";
  const activeLoopJobId = loopJobId ?? lastNonNullLoopJobIdRef.current;
  const activeJobId = loopActive ? activeLoopJobId : singleJobId;

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
    if (rangeError) return;
    if (!datasetCache) {
      setError(DATASET_CACHE_ERROR);
      return;
    }
    setError(null);
    lastTableSourceRef.current = "loop";
    setLoopBusy(true);
    try {
      const marginPerTrade = Number(simMarginPerTrade);
      const leverage = Number(simLeverage);
      if (!Number.isFinite(marginPerTrade) || marginPerTrade <= 0) {
        setError("marginPerTrade must be > 0");
        return;
      }
      if (!Number.isFinite(leverage) || leverage < 1) {
        setError("leverage must be >= 1");
        return;
      }
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
        tapeIds: [],
        candidates: Number(candidates),
        seed: Number(seed),
        minTrades: Math.max(0, Math.floor(Number(minTrades) || 0)),
        directionMode,
        optTfMin: Number(optTfMin),
        excludeNegative,
        rememberNegatives,
        sim: {
          marginPerTrade,
          leverage,
          feeBps: Number(simFeeBps) || 0,
          fundingBpsPer8h: Number(simFundingBpsPer8h) || 0,
          slippageBps: Number(simSlippageBps) || 0,
        },
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
        precision,
        runsCount: Math.max(1, Math.floor(Number(loopRunsCount) || 1)),
        infinite: loopInfinite,
        datasetCache,
      });
      setLoopAggRows([]);
      completedLoopRunIdsRef.current = {};
      localStorage.removeItem(LOOP_RESULTS_DRAFT_STORAGE_KEY);
      setDone(0);
      setTotal(100);
      const next = await getOptimizerLoopStatus();
      setLoopStatus(next);
        const isPausedNow = Boolean(next.loop?.isPaused);
        if (isPausedNow) {
          if (pauseFreezeAtMsRef.current == null) pauseFreezeAtMsRef.current = Date.now();
        } else {
          pauseFreezeAtMsRef.current = null;
        }
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
        const isPausedNow = Boolean(next.loop?.isPaused);
        if (isPausedNow) {
          if (pauseFreezeAtMsRef.current == null) pauseFreezeAtMsRef.current = Date.now();
        } else {
          pauseFreezeAtMsRef.current = null;
        }
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
        const isPausedNow = Boolean(next.loop?.isPaused);
        if (isPausedNow) {
          if (pauseFreezeAtMsRef.current == null) pauseFreezeAtMsRef.current = Date.now();
        } else {
          pauseFreezeAtMsRef.current = null;
        }
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
        const isPausedNow = Boolean(next.loop?.isPaused);
        if (isPausedNow) {
          if (pauseFreezeAtMsRef.current == null) pauseFreezeAtMsRef.current = Date.now();
        } else {
          pauseFreezeAtMsRef.current = null;
        }
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

  const appendCompletedRunResults = useCallback((rows: OptimizationResult[]) => {
    const minTradesLimit = Math.max(0, Math.floor(Number(minTrades) || 0));
    const filteredRows = rows.filter((row) => minTradesLimit <= 0 || row.trades >= minTradesLimit);
    if (!filteredRows.length) return;
    setLoopAggRows((prev) => {
      const next = prev.concat(filteredRows);
      setTotalRows(next.length);
      return next;
    });
  }, [minTrades]);

  const appendCompletedRunByJobId = useCallback(async (jobId: string) => {
    if (!jobId || completedLoopRunIdsRef.current[jobId]) return;
    completedLoopRunIdsRef.current[jobId] = true;
    try {
      const res = await getJobResults(jobId, { page: 1, sortKey, sortDir });
      appendCompletedRunResults(Array.isArray(res.results) ? res.results : []);
    } catch {
      delete completedLoopRunIdsRef.current[jobId];
    }
  }, [appendCompletedRunResults, sortDir, sortKey]);


  useEffect(() => {
    let mounted = true;
    let timer: number | null = null;

    const refresh = async () => {
      try {
        const next = await getOptimizerLoopStatus();
        if (!mounted) return;

        const isRunningNow = Boolean(next.loop?.isRunning);
        if (isRunningNow) lastTableSourceRef.current = "loop";

        const currentLoopJobId = next.loop?.lastJobId ?? null;
        const completedJobId = currentLoopJobId ?? lastNonNullLoopJobIdRef.current;
        let donePercent = Math.floor(Number(next.lastJobStatus?.donePercent ?? 0));
        let runStatus = next.lastJobStatus?.status;

        if (currentLoopJobId) {
          try {
            const statusRes = await getJobStatus(currentLoopJobId);
            if (!mounted) return;
            const progress = getStableProgressForJob(currentLoopJobId, statusRes as { donePct?: number; done?: number; startedAtMs?: number | null });
            donePercent = Math.floor(progress.pct);
            runStatus = statusRes.status;
            setJobStartedAtMs((prev) => (prev === progress.startedAtMs ? prev : progress.startedAtMs));
            setJobUpdatedAtMs((prev) => {
              const updatedAt = statusRes.updatedAtMs ?? null;
              return prev === updatedAt ? prev : updatedAt;
            });
            setJobFinishedAtMs((prev) => {
              const finishedAt = statusRes.finishedAtMs ?? null;
              return prev === finishedAt ? prev : finishedAt;
            });
            setJobStatus((prev) => (prev === statusRes.status ? prev : statusRes.status));
          } catch {
            // Keep using /loop/status fallback if per-job status is briefly unavailable.
          }
        }

        const didCompleteRun = prevLoopRunningRef.current && (donePercent === 100 || runStatus === "done");

        setLoopStatus(next);
        setNowMs(Date.now());
        setTotal(100);
        setDone((prev) => {
          if (donePercent === 100) return 100;
          if (!isRunningNow && !next.loop?.isPaused) return prev;
          if (currentLoopJobId == null && donePercent <= 0) return prev;
          return donePercent;
        });

        const isPausedNow = Boolean(next.loop?.isPaused);
        if (isPausedNow) {
          if (pauseFreezeAtMsRef.current == null) pauseFreezeAtMsRef.current = Date.now();
        } else {
          pauseFreezeAtMsRef.current = null;
        }
        setLoopJobId(next.loop?.lastJobId ?? null);

        if (didCompleteRun && completedJobId) {
          void appendCompletedRunByJobId(completedJobId);
        }

        prevLoopRunningRef.current = isRunningNow;
      } catch {
        return;
      }
    };

    void refresh();
    if (loopStatus?.loop) {
      timer = window.setInterval(() => {
        void refresh();
      }, LOOP_STATUS_POLL_MS);
    }

    return () => {
      mounted = false;
      if (timer != null) window.clearInterval(timer);
    };
  }, [appendCompletedRunByJobId, getStableProgressForJob, loopStatus?.loop]);



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
      return;
    }
    const keepPreviousIfEmpty = options?.keepPreviousIfEmpty ?? false;
    if (keepPreviousIfEmpty && nextResults.length === 0) return;
    setResults((prev) => (areTopResultsSimilar(prev, nextResults) ? prev : nextResults));
    setPage((prev) => (prev === res.page ? prev : res.page));
    setTotalRows((prev) => (prev === res.totalRows ? prev : res.totalRows));
  }

  useEffect(() => {
    if (!activeJobId) return;
    let alive = true;
    void (async () => {
      try {
        await fetchResults(1, sortKey, sortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
      } catch (e: any) {
        if (!alive) return;
        if (isNoCurrentJobError(e)) {
          setSingleJobId(null);
          setJobStatus("idle");
          setOptimizerPaused(false);
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeJobId, clearSingleJobState, isNoCurrentJobError, loopActive, sortDir, sortKey]);

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
          setSingleJobId(null);
          setJobStatus("idle");
          setOptimizerPaused(false);
          return;
        }
        setError(String(e?.message ?? e));
      }
    }, ACTIVE_RESULTS_POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [clearSingleJobState, getStableProgressForJob, isNoCurrentJobError, jobActive, loopActive, page, singleJobId, sortDir, sortKey]);

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
    }, ACTIVE_RESULTS_POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [loopActive, loopJobId, sortDir, sortKey]);
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
      tapeId: null,
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


  async function onExportHistory() {
    setHistoryTransferMessage(null);
    setError(null);
    try {
      const payload = await exportOptimizerHistory();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `optimizer-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setHistoryTransferMessage("History export downloaded.");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setHistoryTransferMessage("History export failed.");
    }
  }

  function onOpenImportHistoryPicker() {
    setHistoryTransferMessage(null);
    historyImportInputRef.current?.click();
  }

  async function onImportHistoryFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setHistoryTransferMessage(null);
    setError(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { runs?: unknown[] };
      const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
      const res = await importOptimizerHistory({ runs, mode: "merge" });
      await refreshJobHistory();
      setHistoryTransferMessage(`History imported (${res.imported} runs, total ${res.total}).`);
    } catch (err: any) {
      setError(String(err?.message ?? err));
      setHistoryTransferMessage("History import failed.");
    }
  }

  const isLoopDisplay = lastTableSourceRef.current === "loop";
  const displayedRows = isLoopDisplay ? (excludeNegative ? loopAggRows.filter((row) => row.netPnl >= 0) : loopAggRows) : results;
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
      const hours = Number(row.runPayload.datasetHours);
      map[row.jobId] = Number.isFinite(hours) ? String(Math.max(0, Math.floor(hours))) : "-";
    });
    return map;
  }, [jobHistory]);
  const historyColumnCount = historyCompactMode ? 12 : 19;
  const historyRunIdCellStyle = historyCompactMode ? { ...HISTORY_CELL_STYLE, width: 80 } : HISTORY_CELL_STYLE;
  const historyEndedAtCellStyle = historyCompactMode ? { ...HISTORY_CELL_STYLE, width: 120 } : HISTORY_CELL_STYLE;
  const historyStatusCellStyle = historyCompactMode ? { ...HISTORY_CELL_STYLE, width: 90 } : HISTORY_CELL_STYLE;
  const historyBestNetCellStyle = historyCompactMode ? { ...HISTORY_CELL_STYLE, width: 90 } : HISTORY_CELL_STYLE;
  const historyRowsTotalCellStyle = historyCompactMode ? { ...HISTORY_CELL_STYLE, width: 80 } : HISTORY_CELL_STYLE;
  const historyViewCellStyle = historyCompactMode ? { ...HISTORY_CELL_STYLE, width: 70 } : HISTORY_CELL_STYLE;

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const maxOffset = Math.max(0, (jobHistoryTotalPages - 1) * jobHistoryLimit);
    if (jobHistoryOffset > maxOffset) setJobHistoryOffset(maxOffset);
  }, [jobHistoryLimit, jobHistoryOffset, jobHistoryTotalPages]);
  const isRunningStatus = jobStatus === "running";
  const loopStartedAtMs = Number(loopStatus?.loop?.createdAtMs ?? 0) || null;
  const loopRunsCompleted = Math.max(0, Number(loopStatus?.runsCompleted ?? 0) || 0);
  const loopRunsTotalRaw = loopStatus?.runsTotal;
  const loopRunsTotal = loopRunsTotalRaw == null ? null : Math.max(0, Number(loopRunsTotalRaw) || 0);
  const startedAtForActiveJobId = loopActive
    ? loopStartedAtMs
    : (activeJobId ? (jobStartedAtMs ?? startedAtByJobIdRef.current[activeJobId] ?? null) : jobStartedAtMs);
  const endMs = !startedAtForActiveJobId
    ? null
    : (loopActive || isRunningStatus)
      ? nowMs
      : (jobFinishedAtMs ?? jobUpdatedAtMs ?? startedAtForActiveJobId);
  const elapsedSec = endMs == null || !startedAtForActiveJobId ? null : Math.max(0, (endMs - startedAtForActiveJobId) / 1000);
  const pctDoneRaw = clamp(done, 0, 100);
  const pctDone = loopStatus?.loop
    ? (() => {
      if (loopRunsTotal != null && loopRunsTotal > 0) {
        const currentRunWeight = clamp(pctDoneRaw, 0, 100) / 100;
        const overallPct = ((loopRunsCompleted + currentRunWeight) / loopRunsTotal) * 100;
        const isCompleted = !loopStatus.loop.isRunning && !loopStatus.loop.isPaused && loopRunsCompleted >= loopRunsTotal;
        return Math.floor(clamp(isCompleted ? 100 : overallPct, 0, 100));
      }
      return Math.floor(pctDoneRaw);
    })()
    : Math.floor(pctDoneRaw);
  const etaSec = elapsedSec != null && pctDone > 0 && pctDone < 100
    ? (loopStatus?.loop && loopRunsTotal == null ? null : elapsedSec * (100 / pctDone - 1))
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
      : loopPaused
        ? (pauseFreezeAtMsRef.current ?? (loopStatus?.loop?.updatedAtMs ?? loopStartMs))
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
            <span style={{ fontSize: 12, opacity: 0.8 }}>RECEIVE_DATA_CACHE</span>
          </Card.Header>
          <Card.Body>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <div style={{ fontSize: 12, marginBottom: 8 }}>Data source: <b>{String(optimizerDataSource ?? "-").toUpperCase()}</b></div>
            {optimizerStatusWarning ? <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{optimizerStatusWarning}</div> : null}

            <h6>Receive Data</h6>
            <DatasetTargetCard />
            {!datasetCache ? <Alert variant="warning" className="py-2">Run Receive Data first</Alert> : null}

            <fieldset disabled={!datasetCache}>
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
                <Form.Label style={{ fontSize: 12 }}>marginPerTrade</Form.Label>
                <Form.Control value={simMarginPerTrade} onChange={(e) => setSimMarginPerTrade(e.currentTarget.value)} type="number" min={0.0001} step={0.1} />
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>leverage</Form.Label>
                <Form.Control value={simLeverage} onChange={(e) => setSimLeverage(e.currentTarget.value)} type="number" min={1} step={0.1} />
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
              <Col xs={12}>
                <div className="d-flex flex-wrap gap-3">
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Hide negative netPnl" checked={excludeNegative} disabled={loopActive} onChange={(e) => setExcludeNegative(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Remember negatives" checked={rememberNegatives} disabled={loopActive} onChange={(e) => setRememberNegatives(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Loop until Stop" checked={loopInfinite} disabled={loopActive} onChange={(e) => setLoopInfinite(e.currentTarget.checked)} />
                  </Form.Group>
                </div>
              </Col>
              <Col xs={12}>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>Advanced sim params</summary>
                  <Row className="g-2 align-items-end mt-1">
                    <Col md={2} sm={4} xs={6}>
                      <Form.Group>
                        <Form.Label style={{ fontSize: 12 }}>feeBps</Form.Label>
                        <Form.Control value={simFeeBps} onChange={(e) => setSimFeeBps(e.currentTarget.value)} type="number" min={0} step={0.01} />
                      </Form.Group>
                    </Col>
                    <Col md={2} sm={4} xs={6}>
                      <Form.Group>
                        <Form.Label style={{ fontSize: 12 }}>fundingBpsPer8h</Form.Label>
                        <Form.Control value={simFundingBpsPer8h} onChange={(e) => setSimFundingBpsPer8h(e.currentTarget.value)} type="number" step={0.01} />
                      </Form.Group>
                    </Col>
                    <Col md={2} sm={4} xs={6}>
                      <Form.Group>
                        <Form.Label style={{ fontSize: 12 }}>slippageBps</Form.Label>
                        <Form.Control value={simSlippageBps} onChange={(e) => setSimSlippageBps(e.currentTarget.value)} type="number" min={0} step={0.01} />
                      </Form.Group>
                    </Col>
                  </Row>
                </details>
              </Col>
            </Row>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button variant="outline-primary" onClick={() => void onStartLoop()} disabled={!datasetCache || loopBusy || loopRunning || loopPaused || Boolean(rangeError)}>Start loop</Button>
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
            </fieldset>

            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Loop: <b>{loopActive ? (loopPaused ? "paused" : "running") : "stopped"}</b>
              {loopExists && loopStatus?.loop ? ` · Run ${loopStatus.runsCompleted ?? loopStatus.loop.runIndex}/${loopStatus.runsTotal == null ? "∞" : loopStatus.runsTotal}` : ""}
            </div>
            <div style={{ fontSize: 12, marginBottom: 8 }}>Loop elapsed: <b>{formatDuration(loopElapsedSec)}</b></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            </div>

            {showProgressBlock ? <>
              <CenteredProgressBar now={pct} showPercent title={`progress ${Math.floor(pct)} / ${Math.round(total)}`} className="mb-2" />
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                Elapsed: <b>{formatDuration(elapsedSec)}</b>
                {etaSec != null ? <> · ETA: <b>{formatEta(etaSec)}</b></> : null}
              </div>
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
              <Button size="sm" variant="outline-secondary" onClick={() => void onExportHistory()}>
                Export history
              </Button>
              <Button size="sm" variant="outline-secondary" onClick={onOpenImportHistoryPicker}>
                Import history
              </Button>
              <input ref={historyImportInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => void onImportHistoryFile(e)} />
            </div>
            {historyTransferMessage ? <div style={{ fontSize: 12, marginBottom: 8 }}>{historyTransferMessage}</div> : null}

            <Table striped bordered hover size="sm" style={{ tableLayout: "auto" }}>
              <thead>
                <tr>
                                    <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("netPnl")}>netPnl</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("trades")}>trades</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("winRatePct")}>winRate</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("expectancy")}>expectancy</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("profitFactor")}>profitFactor</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("maxDrawdownUsdt")}>maxDD</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("ordersPlaced")}>placed</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("ordersFilled")}>filled</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("ordersExpired")}>expired</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("priceTh")}>priceTh</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("oivTh")}>oivTh</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("tp")}>tp</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("sl")}>sl</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("offset")}>offset</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("timeoutSec")}>timeoutSec</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("rearmMs")}>rearmMs</th>
                  <th style={{ whiteSpace: "nowrap" }}>action</th>
                </tr>
              </thead>
              <tbody>
                {loopDisplayRows.map((r, i) => {
                  return (
                    <tr key={`${makeResultSignature(r)}-${r.netPnl}-${r.trades}-${i}`}>
                                            <td style={{ whiteSpace: "nowrap" }}>{r.netPnl.toFixed(4)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.trades}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.winRatePct.toFixed(2)}%</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.expectancy.toFixed(4)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.profitFactor.toFixed(3)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.maxDrawdownUsdt.toFixed(4)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.ordersPlaced}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.ordersFilled}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.ordersExpired}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.priceThresholdPct.toFixed(activePrecision.priceTh)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.oivThresholdPct.toFixed(activePrecision.oivTh)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.tpRoiPct.toFixed(activePrecision.tp)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.slRoiPct.toFixed(activePrecision.sl)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.entryOffsetPct.toFixed(activePrecision.offset)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.timeoutSec.toFixed(activePrecision.timeoutSec)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.params.rearmMs.toFixed(activePrecision.rearmMs)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" variant="outline-secondary" onClick={() => copyToSettings(r)}>Copy to settings</Button>
                      </td>
                    </tr>
                  );
                })}
                {!loopDisplayRows.length ? (
                  <tr>
                    <td colSpan={17} style={{ fontSize: 12, opacity: 0.75 }}>No results</td>
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
            <Table striped bordered hover size="sm" style={HISTORY_TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...historyRunIdCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("jobId")}>runId</th>
                  <th style={{ ...historyEndedAtCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("endedAtMs")}>endedAt</th>
                  <th style={{ ...historyStatusCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("status")}>status</th>
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("mode")}>mode</th> : null}
                  <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("tapes")}>dataset</th>
                  <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("tfMin")}>tfMin</th>
                  <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("candidates")}>candidates</th>
                  <th style={HISTORY_CELL_STYLE}>sim</th>
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("seed")}>seed</th> : null}
                  <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("direction")}>direction</th>
                  <th style={HISTORY_CELL_STYLE}>hours</th>
                  <th style={{ ...historyBestNetCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("bestNetPnl")}>bestNetPnl</th>
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("bestTrades")}>bestTrades</th> : null}
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("bestWinRate")}>bestWinRate</th> : null}
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("bestProfitFactor")}>bestProfitFactor</th> : null}
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("bestMaxDD")}>bestMaxDD</th> : null}
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("rowsPositive")}>rowsPositive</th> : null}
                  <th style={{ ...historyRowsTotalCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("rowsTotal")}>rowsTotal</th>
                  <th style={historyViewCellStyle}>View</th>
                </tr>
              </thead>
              <tbody>
                {jobHistory.map((row) => {
                  const isOpen = Boolean(expandedHistory[row.jobId]);
                  const detailsRows = historyResults[row.jobId] ?? [];
                  return (
                    <Fragment key={row.jobId}>
                      <tr>
                        <td style={historyRunIdCellStyle} title={row.jobId}>{row.jobId.slice(0, 7)}</td>
                        <td style={historyEndedAtCellStyle} title={new Date(row.endedAtMs).toISOString()}><span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatHistoryEndedAt(row.endedAtMs)}</span></td>
                        <td style={historyStatusCellStyle}>{row.status.toUpperCase()}</td>
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.mode ?? "-"}</td> : null}
                        <td style={HISTORY_CELL_STYLE} title={row.runPayload.tapeIds.join(",")}>{row.runPayload.tapeIds.length}</td>
                        <td style={HISTORY_CELL_STYLE}>{row.runPayload.optTfMin ?? "-"}</td>
                        <td style={HISTORY_CELL_STYLE}>{row.runPayload.candidates}</td>
                        <td style={HISTORY_CELL_STYLE}>{formatSimSummary((row.runPayload as any).sim)}</td>
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.runPayload.seed}</td> : null}
                        <td style={HISTORY_CELL_STYLE}>{row.runPayload.directionMode}</td>
                        <td style={HISTORY_CELL_STYLE}>{historyHoursByJobId[row.jobId] ?? "-"}</td>
                        <td style={historyBestNetCellStyle}>{row.summary.bestNetPnl == null ? "-" : row.summary.bestNetPnl.toFixed(4)}</td>
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.summary.bestTrades ?? "-"}</td> : null}
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.summary.bestWinRate == null ? "-" : `${row.summary.bestWinRate.toFixed(2)}%`}</td> : null}
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.summary.bestProfitFactor == null ? "-" : row.summary.bestProfitFactor.toFixed(4)}</td> : null}
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.summary.bestMaxDD == null ? "-" : row.summary.bestMaxDD.toFixed(4)}</td> : null}
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.summary.rowsPositive}</td> : null}
                        <td style={historyRowsTotalCellStyle}>{row.summary.rowsTotal}</td>
                        <td style={historyViewCellStyle}><Button size="sm" variant="outline-secondary" onClick={() => void toggleHistoryRow(row.jobId)}>{isOpen ? "Hide" : "View"}</Button></td>
                      </tr>
                      <tr>
                        <td colSpan={historyColumnCount} style={HISTORY_DETAILS_CELL_STYLE}>
                          <Collapse in={isOpen}>
                            <div style={{ padding: isOpen ? 10 : 0, background: "#f5f5f5", borderLeft: "3px solid #d0d0d0", marginTop: 2 }}>
                              <div style={{ fontSize: 12 }}>
                                sim: <b>{JSON.stringify((row.runPayload as any).sim ?? {})}</b>
                              </div>
                              {historyLoading[row.jobId] ? <div style={{ fontSize: 12 }}>Loading...</div> : null}
                              {!historyLoading[row.jobId] && row.summary.rowsPositive === 0 ? <div style={{ fontSize: 12 }}>No positive results</div> : null}
                              {!historyLoading[row.jobId] && row.summary.rowsPositive > 0 ? (
                                <Table striped bordered hover size="sm" className="mb-0" style={{ marginTop: 8, marginLeft: 8 }}>
                                  <thead>
                                    <tr>
                                      <th>netPnl</th><th>trades</th><th>winRate</th><th>expectancy</th><th>profitFactor</th><th>maxDD</th>
                                      <th>placed</th><th>filled</th><th>expired</th><th>priceTh</th><th>oivTh</th><th>tp</th><th>sl</th><th>offset</th><th>timeoutSec</th><th>rearmMs</th><th>action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailsRows.map((r, i) => (
                                      <tr key={`${row.jobId}-${r.netPnl}-${r.trades}-${r.params.priceThresholdPct}-${r.params.oivThresholdPct}-${i}`}>
                                        <td>{r.netPnl.toFixed(4)}</td><td>{r.trades}</td><td>{r.winRatePct.toFixed(2)}%</td><td>{r.expectancy.toFixed(4)}</td><td>{r.profitFactor.toFixed(3)}</td><td>{r.maxDrawdownUsdt.toFixed(4)}</td>
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
                    <td colSpan={historyColumnCount} style={{ ...HISTORY_CELL_STYLE, fontSize: 12, opacity: 0.75 }}>No completed runs</td>
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

    </>
  );
}
