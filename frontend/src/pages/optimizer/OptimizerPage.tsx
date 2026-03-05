import { Fragment, memo, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ButtonGroup, Card, Col, Collapse, Container, Form, Row, Table } from "react-bootstrap";
import { TablePaginationControls, useStoredPageSize } from "../../shared/ui/TablePaginationControls";
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
  getJobTradesExportUrl,
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
  type OptimizerExecutionModel,
} from "../../features/optimizer/api/optimizerApi";
import { CenteredProgressBar } from "../../shared/ui/CenteredProgressBar";
import DatasetTargetCard from "../../features/datasetTarget/ui/DatasetTargetCard";
import { deleteDatasetHistory, listDatasetHistories, type DatasetHistoryRecord } from "../../features/datasetHistory/api/datasetHistoryApi";
import { DATASET_CACHE_STORAGE_KEY } from "../../features/dataReceive/api/dataReceiveApi";
import { useInterval } from "../../shared/hooks/useInterval";
import { getDatasetHistoryIds, getHistoryRunPayloadValue } from "../../features/optimizer/utils/historyPayload";

type OptimizerResultRow = OptimizationResult;
type LoopOptimizerResultRow = OptimizerResultRow & { __runJobId: string };
type OptimizerSingleResultsState = { rowsById: Map<string, OptimizationResult>; order: string[]; version: number };
type LoopRunStore = { rowsById: Map<string, LoopOptimizerResultRow>; order: string[]; version: number };
type LoopAggState = { runOrder: string[]; byRunId: Record<string, LoopRunStore>; version: number };

type RangeKey = "priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmSec";
type RangeState = Record<RangeKey, { min: string; max: string }>;

const RANGE_DEFAULTS: RangeState = {
  priceTh: { min: "0.5", max: "6" },
  oivTh: { min: "0.5", max: "15" },
  tp: { min: "2", max: "12" },
  sl: { min: "2", max: "12" },
  offset: { min: "0", max: "1" },
  timeoutSec: { min: "61", max: "120" },
  rearmSec: { min: "900", max: "3600" },
};

const RANGES_STORAGE_KEY = "bots_dev.optimizer.ranges";
const CANDIDATES_STORAGE_KEY = "bots_dev.optimizer.candidates";
const SEED_STORAGE_KEY = "bots_dev.optimizer.seed";
const DIRECTION_STORAGE_KEY = "bots_dev.optimizer.directionMode";
const OPT_TF_STORAGE_KEY = "bots_dev.optimizer.optTfMin";
const MIN_TRADES_STORAGE_KEY = "bots_dev.optimizer.minTrades";
const SIM_MARGIN_STORAGE_KEY = "bots_dev.optimizer.sim.marginPerTrade";
const SIM_LEVERAGE_STORAGE_KEY = "bots_dev.optimizer.sim.leverage";
const SIM_FEE_BPS_STORAGE_KEY = "bots_dev.optimizer.sim.feeBps";
const SIM_SLIPPAGE_BPS_STORAGE_KEY = "bots_dev.optimizer.sim.slippageBps";
const EXECUTION_MODEL_STORAGE_KEY = "bots_dev.optimizer.executionModel";
const EXCLUDE_NEGATIVE_STORAGE_KEY = "bots_dev.optimizer.excludeNegative";
const REMEMBER_NEGATIVES_STORAGE_KEY = "bots_dev.optimizer.rememberNegatives";
const FILTER_VAL_PNL_PER_TRADE_POS_STORAGE_KEY = "bots_dev.optimizer.filterValPnlPerTradePos";
const FILTER_VAL_NET_PNL_POS_STORAGE_KEY = "bots_dev.optimizer.filterValNetPnlPos";
const LOOP_RUNS_COUNT_STORAGE_KEY = "bots_dev.optimizer.loopRunsCount";
const LOOP_INFINITE_STORAGE_KEY = "bots_dev.optimizer.loopInfinite";
const TOP_RESULTS_SINGLE_STORAGE_KEY = "bots_dev.optimizer.topResults.single";
const LOOP_RESULTS_DRAFT_STORAGE_KEY = "optimizerLoopResultsDraft";
const RANGES_SAVE_DEBOUNCE_MS = 400;
const DEFAULT_PRECISION: OptimizerPrecision = { priceTh: 3, oivTh: 3, tp: 3, sl: 3, offset: 3, timeoutSec: 0, rearmMs: 0 };
const HISTORY_COMPACT_BREAKPOINT_PX = 1400;
const POLL_MS = 1000;
const DATASET_HISTORY_POLL_MS = 2000;
const DEBUG_PROGRESS_LOG_MIN_INTERVAL_MS = 500;
const LIVE_ROWS_SORT_THROTTLE_MS = 200;
const LOOP_EMPTY_RESULTS_WARNING_DELAY_MS = 5000;

const DATASET_INTERVAL_ORDER: Record<string, number> = {
  "1": 1,
  "3": 2,
  "5": 3,
  "15": 4,
  "30": 5,
  "60": 6,
  "120": 7,
  "240": 8,
  "360": 9,
  "720": 10,
  D: 11,
  W: 12,
  M: 13,
};

function chooseMaxDatasetInterval(intervals: string[]): string {
  if (!intervals.length) return "1";
  const uniq = [...new Set(intervals.map((it) => String(it || "1")))];
  return uniq.sort((a, b) => (DATASET_INTERVAL_ORDER[b] ?? 0) - (DATASET_INTERVAL_ORDER[a] ?? 0))[0] ?? "1";
}

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
  const keys: Array<Exclude<RangeKey, "rearmSec">> = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec"];
  for (const key of keys) {
    const row = (value as Record<string, any>)[key];
    if (!row || typeof row !== "object") return false;
    if (typeof row.min !== "string" || typeof row.max !== "string") return false;
  }
  const rearmRow = (value as Record<string, any>).rearmSec ?? (value as Record<string, any>).rearmMs;
  if (!rearmRow || typeof rearmRow !== "object") return false;
  if (typeof rearmRow.min !== "string" || typeof rearmRow.max !== "string") return false;
  return true;
}

function loadSavedRanges(): RangeState {
  try {
    const raw = localStorage.getItem(RANGES_STORAGE_KEY);
    if (!raw) return RANGE_DEFAULTS;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidRangeState(parsed)) return RANGE_DEFAULTS;
    const parsedAny = parsed as any;
    const timeoutMax = Number(parsedAny?.timeoutSec?.max ?? RANGE_DEFAULTS.timeoutSec.max);
    const rearmLegacy = parsedAny?.rearmSec ?? parsedAny?.rearmMs;
    const rearmMax = Number(rearmLegacy?.max ?? RANGE_DEFAULTS.rearmSec.max);
    return {
      ...RANGE_DEFAULTS,
      ...parsedAny,
      timeoutSec: {
        min: RANGE_DEFAULTS.timeoutSec.min,
        max: String(Math.max(Number.isFinite(timeoutMax) ? timeoutMax : Number(RANGE_DEFAULTS.timeoutSec.max), Number(RANGE_DEFAULTS.timeoutSec.min))),
      },
      rearmSec: {
        min: RANGE_DEFAULTS.rearmSec.min,
        max: String(Math.max(Number.isFinite(rearmMax) ? rearmMax : Number(RANGE_DEFAULTS.rearmSec.max), Number(RANGE_DEFAULTS.rearmSec.min))),
      },
    };
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
    `rearmSec=${toSigValue(row.params.rearmMs / 1000)}`,
  ].join("|");
}

function resolveRowId(row: OptimizerResultRow): string {
  const rowId = typeof (row as any)?.rowId === "string" ? (row as any).rowId.trim() : "";
  return rowId || makeResultSignature(row);
}

function readOptimizerSortValue(row: OptimizerResultRow, key: OptimizerSortKeyExtended): number | string {
  switch (key) {
    case "pnlPerTrade": {
      const trades = Number(row.trades) || 0;
      return trades > 0 ? (Number(row.netPnl) || 0) / trades : 0;
    }
    case "trainNetPnl":
      return Number(row.trainNetPnl) || 0;
    case "trainTrades":
      return Number(row.trainTrades) || 0;
    case "valNetPnl":
      return Number(row.valNetPnl) || 0;
    case "valTrades":
      return Number(row.valTrades) || 0;
    case "valPnlPerTrade":
      return readValPnlPerTrade(row);
    case "priceTh":
      return Number(row.params.priceThresholdPct) || 0;
    case "oivTh":
      return Number(row.params.oivThresholdPct) || 0;
    case "tp":
      return Number(row.params.tpRoiPct) || 0;
    case "sl":
      return Number(row.params.slRoiPct) || 0;
    case "offset":
      return Number(row.params.entryOffsetPct) || 0;
    case "timeoutSec":
      return Number(row.params.timeoutSec) || 0;
    case "rearmMs":
      return Number(row.params.rearmMs) || 0;
    case "direction":
      return String(row.directionMode ?? "both").toLowerCase();
    default:
      return Number(row[key]) || 0;
  }
}

function sortOptimizerRows(rows: OptimizerResultRow[], key: OptimizerSortKeyExtended, dir: OptimizerSortDir): OptimizerResultRow[] {
  const direction = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = readOptimizerSortValue(a, key);
    const bv = readOptimizerSortValue(b, key);
    if (typeof av === "string" || typeof bv === "string") {
      const textDelta = String(av).localeCompare(String(bv)) * direction;
      if (textDelta !== 0) return textDelta;
    } else {
      const delta = (av - bv) * direction;
      if (delta !== 0) return delta;
    }
    return (Number(a.rank) - Number(b.rank)) * direction;
  });
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

const OPTIMIZER_SORT_KEYS: OptimizerSortKeyExtended[] = [
  "pnlPerTrade", "trainNetPnl", "trainTrades", "valNetPnl", "valTrades", "valPnlPerTrade", "netPnl", "trades", "winRatePct", "priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs",
  "expectancy", "profitFactor", "maxDrawdownUsdt", "ordersPlaced", "ordersFilled", "ordersExpired",
  "longsCount", "longsPnl", "longsWinRatePct", "shortsCount", "shortsPnl", "shortsWinRatePct", "direction",
];

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const readValPnlPerTrade = (row: Pick<OptimizationResult, "valPnlPerTrade" | "valTrades" | "valNetPnl">): number => {
  const direct = Number(row.valPnlPerTrade);
  if (Number.isFinite(direct)) return direct;
  const valTrades = Number(row.valTrades) || 0;
  if (valTrades <= 0) return 0;
  return (Number(row.valNetPnl) || 0) / valTrades;
};
const fmt = (v: unknown, digits: number): string => {
  const x = n(v);
  return x === undefined ? `0.${"0".repeat(digits)}` : x.toFixed(digits);
};
const fmtInt = (v: unknown): string => {
  const x = n(v);
  return x === undefined ? "0" : String(Math.trunc(x));
};

function isOptimizerSortKeyExtended(value: unknown): value is OptimizerSortKeyExtended {
  return typeof value === "string" && OPTIMIZER_SORT_KEYS.includes(value as OptimizerSortKeyExtended);
}

function normalizeOptimizerRow<T extends OptimizationResult>(row: T): T {
  const rowAny = row as any;
  const params = (rowAny?.params && typeof rowAny.params === "object") ? rowAny.params : {};
  const normalizedRearmMs = n(params?.rearmMs) ?? ((n(params?.rearmSec) ?? 0) * 1000);
  return {
    ...row,
    rowId: typeof rowAny?.rowId === "string" ? rowAny.rowId : "",
    candidateKey: typeof rowAny?.candidateKey === "string" ? rowAny.candidateKey : undefined,
    netPnl: n(rowAny?.netPnl) ?? 0,
    expectancy: n(rowAny?.expectancy) ?? 0,
    profitFactor: n(rowAny?.profitFactor) ?? 0,
    winRatePct: n(rowAny?.winRatePct) ?? 0,
    longsCount: n(rowAny?.longsCount) ?? 0,
    shortsCount: n(rowAny?.shortsCount) ?? 0,
    longsPnl: n(rowAny?.longsPnl) ?? 0,
    shortsPnl: n(rowAny?.shortsPnl) ?? 0,
    longsWinRatePct: n(rowAny?.longsWinRatePct) ?? 0,
    shortsWinRatePct: n(rowAny?.shortsWinRatePct) ?? 0,
    params: {
      ...params,
      rearmMs: normalizedRearmMs,
    },
  };
}

function aggregateLoopRowsByCandidate(rows: LoopOptimizerResultRow[]): LoopOptimizerResultRow[] {
  const byCandidate = new Map<string, LoopOptimizerResultRow & { __wins: number; __trainWins: number; __valWins: number; __longWins: number; __shortWins: number }>();
  for (const row of rows) {
    const normalized = normalizeOptimizerRow(row);
    const candidateKey = typeof normalized.candidateKey === "string" && normalized.candidateKey.trim()
      ? normalized.candidateKey.trim()
      : makeResultSignature(normalized);
    const wins = Math.max(0, Math.round((Number(normalized.winRatePct) || 0) * (Number(normalized.trades) || 0) / 100));
    const trainWins = Math.max(0, Math.round((Number(normalized.trainWinRatePct) || 0) * (Number(normalized.trainTrades) || 0) / 100));
    const valWins = Math.max(0, Math.round((Number(normalized.valWinRatePct) || 0) * (Number(normalized.valTrades) || 0) / 100));
    const longWins = Math.max(0, Math.round((Number(normalized.longsWinRatePct) || 0) * (Number(normalized.longsCount) || 0) / 100));
    const shortWins = Math.max(0, Math.round((Number(normalized.shortsWinRatePct) || 0) * (Number(normalized.shortsCount) || 0) / 100));
    const existing = byCandidate.get(candidateKey);
    if (!existing) {
      byCandidate.set(candidateKey, {
        ...normalized,
        rowId: `loop:${candidateKey}`,
        candidateKey,
        __wins: wins,
        __trainWins: trainWins,
        __valWins: valWins,
        __longWins: longWins,
        __shortWins: shortWins,
      });
      continue;
    }
    existing.netPnl += Number(normalized.netPnl) || 0;
    existing.trades += Number(normalized.trades) || 0;
    existing.trainNetPnl = (Number(existing.trainNetPnl) || 0) + (Number(normalized.trainNetPnl) || 0);
    existing.trainTrades = (Number(existing.trainTrades) || 0) + (Number(normalized.trainTrades) || 0);
    existing.valNetPnl = (Number(existing.valNetPnl) || 0) + (Number(normalized.valNetPnl) || 0);
    existing.valTrades = (Number(existing.valTrades) || 0) + (Number(normalized.valTrades) || 0);
    existing.signalsOk += Number(normalized.signalsOk) || 0;
    existing.decisionsNoRefs += Number(normalized.decisionsNoRefs) || 0;
    existing.ordersPlaced += Number(normalized.ordersPlaced) || 0;
    existing.ordersFilled += Number(normalized.ordersFilled) || 0;
    existing.ordersExpired += Number(normalized.ordersExpired) || 0;
    existing.closesTp += Number(normalized.closesTp) || 0;
    existing.closesSl += Number(normalized.closesSl) || 0;
    existing.closesForce += Number(normalized.closesForce) || 0;
    existing.longsCount += Number(normalized.longsCount) || 0;
    existing.longsPnl += Number(normalized.longsPnl) || 0;
    existing.shortsCount += Number(normalized.shortsCount) || 0;
    existing.shortsPnl += Number(normalized.shortsPnl) || 0;
    existing.maxDrawdownUsdt = Math.max(Number(existing.maxDrawdownUsdt) || 0, Number(normalized.maxDrawdownUsdt) || 0);
    existing.__wins += wins;
    existing.__trainWins += trainWins;
    existing.__valWins += valWins;
    existing.__longWins += longWins;
    existing.__shortWins += shortWins;
    existing.__runJobId = normalized.__runJobId;
  }

  return Array.from(byCandidate.values()).map((row) => {
    const trades = Number(row.trades) || 0;
    const trainTrades = Number(row.trainTrades) || 0;
    const valTrades = Number(row.valTrades) || 0;
    const longsCount = Number(row.longsCount) || 0;
    const shortsCount = Number(row.shortsCount) || 0;
    const netPnl = Number(row.netPnl) || 0;
    const valNetPnl = Number(row.valNetPnl) || 0;
    return {
      ...row,
      winRatePct: trades > 0 ? (row.__wins / trades) * 100 : 0,
      trainWinRatePct: trainTrades > 0 ? (row.__trainWins / trainTrades) * 100 : 0,
      valWinRatePct: valTrades > 0 ? (row.__valWins / valTrades) * 100 : 0,
      valPnlPerTrade: valTrades > 0 ? valNetPnl / valTrades : 0,
      expectancy: trades > 0 ? netPnl / trades : 0,
      longsWinRatePct: longsCount > 0 ? (row.__longWins / longsCount) * 100 : 0,
      shortsWinRatePct: shortsCount > 0 ? (row.__shortWins / shortsCount) * 100 : 0,
    };
  });
}

type OptimizerResultRowProps = {
  row: OptimizationResult;
  activePrecision: OptimizerPrecision;
  rowIndex?: number;
  debugTrackMount: boolean;
  onCopyToSettings: (row: OptimizationResult) => void;
  onExportTrades: (row: OptimizationResult) => void;
};

const OptimizerResultRow = memo(function OptimizerResultRow({ row, activePrecision, rowIndex, debugTrackMount, onCopyToSettings, onExportTrades }: OptimizerResultRowProps) {
  const rowDebugIdRef = useRef(resolveRowId(row));
  const rowDebugIndexRef = useRef(typeof rowIndex === "number" ? rowIndex : -1);

  useEffect(() => {
    if (!import.meta.env.DEV || localStorage.getItem("debugRunAppendOnly") !== "1") return;
    const shouldLog = debugTrackMount;
    if (!shouldLog) return;
    console.log("[optimizer-row-mount]", { rowIndex: rowDebugIndexRef.current, id: rowDebugIdRef.current });
    return () => {
      console.log("[optimizer-row-unmount]", { rowIndex: rowDebugIndexRef.current, id: rowDebugIdRef.current });
    };
  }, [debugTrackMount]);

  if (import.meta.env.DEV && typeof rowIndex === "number" && rowIndex < 3 && localStorage.getItem("debugOptimizerRowRenders") === "1") {
    console.log("[optimizer-row-render]", { rowIndex, id: resolveRowId(row), netPnl: row.netPnl, trades: row.trades });
  }
  const trades = Number(row.trades) || 0;
  const pnlPerTrade = trades > 0 ? (Number(row.netPnl) || 0) / trades : 0;
  const trainNetPnl = Number(row.trainNetPnl) || 0;
  const trainTrades = Number(row.trainTrades) || 0;
  const valNetPnl = Number(row.valNetPnl) || 0;
  const valTrades = Number(row.valTrades) || 0;
  const valPnlPerTrade = readValPnlPerTrade(row);
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>{fmt(pnlPerTrade, 4)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{`${fmt(trainNetPnl, 4)} / ${fmtInt(trainTrades)}`}</td>
      <td style={{ whiteSpace: "nowrap" }}>{`${fmt(valNetPnl, 4)} / ${fmtInt(valTrades)}`}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt(valPnlPerTrade, 4)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt(row.netPnl, 4)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmtInt(row.trades)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{`${fmt(row.winRatePct, 2)}%`}</td>
      <td style={{ whiteSpace: "nowrap" }}>{String(row.directionMode ?? "both").toLowerCase()}</td>
      <td style={{ whiteSpace: "nowrap" }}>{`${fmtInt(row.longsCount)} / ${fmt(row.longsPnl, 4)} / ${fmt(row.longsWinRatePct, 1)}%`}</td>
      <td style={{ whiteSpace: "nowrap" }}>{`${fmtInt(row.shortsCount)} / ${fmt(row.shortsPnl, 4)} / ${fmt(row.shortsWinRatePct, 1)}%`}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmtInt(row.ordersPlaced)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmtInt(row.ordersFilled)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmtInt(row.ordersExpired)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt((row as any)?.params?.priceThresholdPct, activePrecision.priceTh)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt((row as any)?.params?.oivThresholdPct, activePrecision.oivTh)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt((row as any)?.params?.tpRoiPct, activePrecision.tp)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt((row as any)?.params?.slRoiPct, activePrecision.sl)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt((row as any)?.params?.entryOffsetPct, activePrecision.offset)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt((row as any)?.params?.timeoutSec, activePrecision.timeoutSec)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fmt(n((row as any)?.params?.rearmMs) === undefined ? undefined : (((row as any).params.rearmMs) / 1000), activePrecision.rearmMs)}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <div className="d-flex gap-1"><Button size="sm" variant="outline-secondary" onClick={() => onCopyToSettings(row)}>Copy</Button><Button size="sm" variant="outline-secondary" onClick={() => onExportTrades(row)}>Export</Button></div>
      </td>
    </tr>
  );
}, (prev, next) => (
  prev.row === next.row
  && prev.rowIndex === next.rowIndex
  && prev.onCopyToSettings === next.onCopyToSettings
  && prev.onExportTrades === next.onExportTrades
  && prev.debugTrackMount === next.debugTrackMount
  && prev.activePrecision.priceTh === next.activePrecision.priceTh
  && prev.activePrecision.oivTh === next.activePrecision.oivTh
  && prev.activePrecision.tp === next.activePrecision.tp
  && prev.activePrecision.sl === next.activePrecision.sl
  && prev.activePrecision.offset === next.activePrecision.offset
  && prev.activePrecision.timeoutSec === next.activePrecision.timeoutSec
  && prev.activePrecision.rearmMs === next.activePrecision.rearmMs
));

type OptimizerResultsBodyProps = {
  rows: OptimizationResult[];
  activePrecision: OptimizerPrecision;
  isLoopDisplay: boolean;
  debugTrackedRowIds: string[];
  onCopyToSettings: (row: OptimizationResult) => void;
  onExportTrades: (row: OptimizationResult) => void;
};

const OptimizerResultsBody = memo(function OptimizerResultsBody({ rows, activePrecision, isLoopDisplay, debugTrackedRowIds, onCopyToSettings, onExportTrades }: OptimizerResultsBodyProps) {
  useEffect(() => {
    if (!import.meta.env.DEV || localStorage.getItem("debugOptimizerRowRenders") !== "1") return;
    console.log("[optimizer-results-body-mount]");
    return () => {
      console.log("[optimizer-results-body-unmount]");
    };
  }, []);

  const debugTrackedSet = useMemo(() => new Set(debugTrackedRowIds), [debugTrackedRowIds]);

  return (
    <tbody>
      {rows.map((r, rowIndex) => {
        const rowKeyBase = resolveRowId(r);
        const rowJobId = (r as any)?.__runJobId ? String((r as any).__runJobId) : "";
        const rowKey = rowJobId ? `${rowJobId}:${rowKeyBase}` : rowKeyBase;
        const debugTrackMount = isLoopDisplay && (rowIndex < 2 || debugTrackedSet.has(rowKeyBase));
        return (
          <OptimizerResultRow
            key={rowKey}
            row={r}
            activePrecision={activePrecision}
            rowIndex={isLoopDisplay ? undefined : rowIndex}
            debugTrackMount={debugTrackMount}
            onCopyToSettings={onCopyToSettings}
            onExportTrades={onExportTrades}
          />
        );
      })}
      {!rows.length ? (
        <tr>
          <td colSpan={18} style={{ fontSize: 12, opacity: 0.75 }}>No results</td>
        </tr>
      ) : null}
    </tbody>
  );
});

export function OptimizerPage() {
  const { conn, lastMsg, lastServerTime, wsUrl, streams } = useWsFeedLite();
  const { status, busy, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();

  const [error, setError] = useState<string | null>(null);
  const [optimizerDataSource, setOptimizerDataSource] = useState<string | null>(null);
  const [optimizerStatusWarning, setOptimizerStatusWarning] = useState<string | null>(null);
  const [datasetCache, setDatasetCache] = useState<string | null>(() => localStorage.getItem(DATASET_CACHE_STORAGE_KEY));

  const [datasetHistories, setDatasetHistories] = useState<DatasetHistoryRecord[]>([]);
  const [, setHistoryBusy] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const loopStartDebugLogLastAtRef = useRef(0);
  const [historySortKey, setHistorySortKey] = useState<keyof DatasetHistoryRecord | "rangeMs" | "universeLabel">("receivedAtMs");
  const [historySortDir, setHistorySortDir] = useState<"asc" | "desc">("desc");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useStoredPageSize("optimizer-dataset-histories", 10);

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [minTrades, setMinTrades] = useState("1");
  const [simMarginPerTrade, setSimMarginPerTrade] = useState(() => localStorage.getItem(SIM_MARGIN_STORAGE_KEY) ?? "10");
  const [simLeverage, setSimLeverage] = useState(() => localStorage.getItem(SIM_LEVERAGE_STORAGE_KEY) ?? "5");
  const [simFeeBps, setSimFeeBps] = useState(() => localStorage.getItem(SIM_FEE_BPS_STORAGE_KEY) ?? "0");
  const [simSlippageBps, setSimSlippageBps] = useState(() => localStorage.getItem(SIM_SLIPPAGE_BPS_STORAGE_KEY) ?? "0");
  const [executionModel, setExecutionModel] = useState<OptimizerExecutionModel>(() => {
    const raw = localStorage.getItem(EXECUTION_MODEL_STORAGE_KEY);
    return raw === "conservativeOhlc" ? "conservativeOhlc" : "closeOnly";
  });
  const [directionMode, setDirectionMode] = useState<"both" | "long" | "short">("both");
  const [optTfMin, setOptTfMin] = useState("15");
  const [hideNegativeNetPnl, setHideNegativeNetPnl] = useState(false);
  const [filterValPnlPerTradePos, setFilterValPnlPerTradePos] = useState(false);
  const [filterValNetPnlPos, setFilterValNetPnlPos] = useState(false);
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

  const [singleResultsState, setSingleResultsState] = useState<OptimizerSingleResultsState>(() => {
    const storedRows = safeJsonParse<OptimizationResult[]>(localStorage.getItem(TOP_RESULTS_SINGLE_STORAGE_KEY)) ?? [];
    const normalizedRows = storedRows.map((row) => normalizeOptimizerRow(row));
    const rowsById = new Map<string, OptimizationResult>();
    const order: string[] = [];
    for (const row of normalizedRows) {
      const rowId = resolveRowId(row);
      if (!rowsById.has(rowId)) order.push(rowId);
      rowsById.set(rowId, row);
    }
    return { rowsById, order, version: 1 };
  });
  const [loopAggState, setLoopAggState] = useState<LoopAggState>(() => {
    const storedDraft = safeJsonParse<unknown>(localStorage.getItem(LOOP_RESULTS_DRAFT_STORAGE_KEY));
    const draftRows = Array.isArray(storedDraft)
      ? storedDraft
      : (Array.isArray((storedDraft as any)?.rows) ? (storedDraft as any).rows : []);
    const normalizedRows = draftRows.map((row: unknown) => normalizeOptimizerRow(row as LoopOptimizerResultRow));
    const hasSchemaVersion = typeof (storedDraft as any)?.schemaVersion === "number";
    const sortDirRaw = (storedDraft as any)?.sortDir;
    const sortKeyRaw = (storedDraft as any)?.sortKey;
    const sortDirNormalized: OptimizerSortDir = sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : "desc";
    const sortKeyNormalized: OptimizerSortKeyExtended = isOptimizerSortKeyExtended(sortKeyRaw) ? sortKeyRaw : "netPnl";
    if (!hasSchemaVersion || !Array.isArray(storedDraft) || sortDirRaw !== sortDirNormalized || sortKeyRaw !== sortKeyNormalized) {
      saveJson(LOOP_RESULTS_DRAFT_STORAGE_KEY, { schemaVersion: 1, rows: normalizedRows, sortKey: sortKeyNormalized, sortDir: sortDirNormalized });
    }
    const runOrder: string[] = [];
    const byRunId: Record<string, LoopRunStore> = {};
    for (const row of normalizedRows) {
      const runId = String(row.__runJobId ?? "");
      if (!runId) continue;
      if (!byRunId[runId]) {
        byRunId[runId] = { rowsById: new Map(), order: [], version: 1 };
        runOrder.push(runId);
      }
      const rowId = resolveRowId(row);
      const store = byRunId[runId];
      if (!store.rowsById.has(rowId)) store.order.push(rowId);
      store.rowsById.set(rowId, row);
    }
    return { runOrder, byRunId, version: 1 };
  });

  const singleRowsForRender = useMemo(() => (
    singleResultsState.order
      .map((rowId) => singleResultsState.rowsById.get(rowId))
      .filter((row): row is OptimizationResult => row != null)
  ), [singleResultsState.order, singleResultsState.version]);

  useEffect(() => {
    saveJson(TOP_RESULTS_SINGLE_STORAGE_KEY, singleRowsForRender);
  }, [singleRowsForRender]);

  const syncDatasetCache = useCallback(() => {
    setDatasetCache(localStorage.getItem(DATASET_CACHE_STORAGE_KEY));
  }, []);

  useEffect(() => {
    syncDatasetCache();
    const onStorage = (event: StorageEvent) => {
      if (event.key === DATASET_CACHE_STORAGE_KEY) syncDatasetCache();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [syncDatasetCache]);

  useInterval(syncDatasetCache, POLL_MS);


  const refreshDatasetHistories = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastDatasetHistoryFetchMsRef.current < DATASET_HISTORY_POLL_MS) return;
    if (datasetHistoryInFlightRef.current) return;
    datasetHistoryInFlightRef.current = true;
    lastDatasetHistoryFetchMsRef.current = now;
    try {
      setHistoryBusy(true);
      const res = await listDatasetHistories();
      const items = Array.isArray(res.histories) ? res.histories : [];
      setDatasetHistories(items);
      if (import.meta.env.DEV && localStorage.getItem("debugDatasetTf") === "1") {
        console.log("[optimizer-history-tf]", {
          intervals: [...new Set(items.map((h) => h.interval))],
        });
      }

      // drop selections that disappeared
      setSelectedHistoryIds((prev) => prev.filter((id) => items.some((h) => h.id === id)));
      // keep page in range
      setHistoryPage((p) => Math.max(1, p));
    } catch {
      // ignore
    } finally {
      datasetHistoryInFlightRef.current = false;
      setHistoryBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshDatasetHistories(true);
  }, [refreshDatasetHistories]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshDatasetHistories();
    }, DATASET_HISTORY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshDatasetHistories]);


  const loopAggRowsForRender = useMemo(() => {
    const rows = loopAggState.runOrder.flatMap((runId) => {
      const store = loopAggState.byRunId[runId];
      if (!store) return [];
      return store.order
        .map((id) => store.rowsById.get(id))
        .filter((row): row is LoopOptimizerResultRow => row != null);
    });
    return aggregateLoopRowsByCandidate(rows);
  }, [loopAggState.version]);

useEffect(() => {
  saveJson(LOOP_RESULTS_DRAFT_STORAGE_KEY, { schemaVersion: 1, rows: loopAggRowsForRender });
}, [loopAggRowsForRender]);

  const [page, setPage] = useState(1);
  const [resultsPageSize, setResultsPageSize] = useStoredPageSize("optimizer-results", 25);
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
  const [jobHistoryLimit, setJobHistoryLimit] = useStoredPageSize("optimizer-job-history", 25);
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
  const hydratedLoopRunIdsRef = useRef<Record<string, boolean>>({});
  const prevLoopRunningRef = useRef(false);
  const lastDebugProgressLogAtRef = useRef(0);
  const liveSingleRowsMapRef = useRef<Map<string, OptimizationResult>>(new Map());
  const liveRowsFlushTimerRef = useRef<number | null>(null);
  const liveRowsPendingByJobIdRef = useRef<Record<string, OptimizationResult[]>>({});
  const activeJobIdRef = useRef<string | null>(null);
  const loopActiveRef = useRef(false);
  const lastProcessedMsgRef = useRef<string | null>(null);
  const debugTrackedRowIdRef = useRef<string | null>(null);
  const [loopDebugTrackedRowIds, setLoopDebugTrackedRowIds] = useState<string[]>([]);
  const [showLoopNoRowsWarning, setShowLoopNoRowsWarning] = useState(false);
  const prevLoopAggVersionRef = useRef(0);
  const prevLoopAggTotalRef = useRef(0);
  const lastDatasetHistoryFetchMsRef = useRef(0);
  const datasetHistoryInFlightRef = useRef(false);

  const isAppendOnlyDebug = useCallback(() => import.meta.env.DEV && localStorage.getItem("debugRunAppendOnly") === "1", []);
  const logAppendOnlyDebug = useCallback((message: string, payload?: Record<string, unknown>) => {
    if (!isAppendOnlyDebug()) return;
    console.log("[optimizer-append-only]", message, payload ?? {});
  }, [isAppendOnlyDebug]);

  const flushLiveRowsForActiveJob = useCallback(() => {
    if (liveRowsFlushTimerRef.current != null) {
      window.clearTimeout(liveRowsFlushTimerRef.current);
      liveRowsFlushTimerRef.current = null;
    }
    const activeId = activeJobIdRef.current;
    if (!activeId) return;
    const pending = liveRowsPendingByJobIdRef.current[activeId] ?? [];
    if (!pending.length) return;
    liveRowsPendingByJobIdRef.current[activeId] = [];

    setSingleResultsState((prev) => {
      let changed = false;
      let appendedRowId: string | null = null;
      const nextRowsById = new Map(prev.rowsById);
      const nextOrder = prev.order.slice();
      for (const pendingRow of pending) {
        const row = normalizeOptimizerRow(pendingRow);
        const rowId = resolveRowId(row);
        const prevRow = nextRowsById.get(rowId);
        if (prevRow === row) continue;
        if (!nextRowsById.has(rowId)) {
          nextOrder.push(rowId);
          appendedRowId = rowId;
        }
        nextRowsById.set(rowId, row);
        changed = true;
      }
      if (!changed) return prev;
      const nextVersion = prev.version + 1;
      if (appendedRowId) {
        debugTrackedRowIdRef.current = appendedRowId;
        logAppendOnlyDebug("append", { jobId: activeId, rowId: appendedRowId, totalRows: nextOrder.length });
      }
      setTotalRows(nextOrder.length);
      return { rowsById: nextRowsById, order: nextOrder, version: nextVersion };
    });
  }, [logAppendOnlyDebug]);

  const queueLiveRowsAppend = useCallback((jobId: string, rows: OptimizationResult[]) => {
    if (!jobId || !rows.length) return;
    const current = liveRowsPendingByJobIdRef.current[jobId] ?? [];
    const normalizedRows = rows.map((row) => normalizeOptimizerRow(row));
    liveRowsPendingByJobIdRef.current[jobId] = current.concat(normalizedRows);
    if (jobId !== activeJobIdRef.current) return;
    if (liveRowsFlushTimerRef.current != null) return;
    liveRowsFlushTimerRef.current = window.setTimeout(flushLiveRowsForActiveJob, LIVE_ROWS_SORT_THROTTLE_MS);
  }, [flushLiveRowsForActiveJob]);

  const maybeLogProgress = useCallback((progress: OptimizerLoopStatus["progress"]) => {
    if (!import.meta.env.DEV) return;
    if (localStorage.getItem("debugOptimizerProgress") !== "1") return;
    if (!progress) return;
    const now = Date.now();
    if (now - lastDebugProgressLogAtRef.current < DEBUG_PROGRESS_LOG_MIN_INTERVAL_MS) return;
    lastDebugProgressLogAtRef.current = now;
    console.log("[optimizer-progress]", {
      jobId: progress.jobId,
      status: progress.status,
      run: `${progress.runIndex}/${progress.runTotal}`,
      runPct: progress.runPct,
      overallPct: progress.overallPct,
      timestamp: progress.updatedAt,
    });
  }, []);

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
    logAppendOnlyDebug("reset", { reason: "clearSingleJobState" });
    setSingleJobId(null);
    setJobStatus("idle");
    setDone(0);
    setTotal(0);
    setSingleResultsState({ rowsById: new Map(), order: [], version: 0 });
    setPage(1);
    setTotalRows(0);
  }, [logAppendOnlyDebug]);

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
    const savedOptTfRaw = localStorage.getItem(OPT_TF_STORAGE_KEY);
    if (savedOptTfRaw != null) {
      const normalized = Math.max(15, Math.floor(Number(savedOptTfRaw) || 15));
      const finalTf = [15, 30, 60, 120, 240].includes(normalized) ? normalized : 15;
      setOptTfMin(String(finalTf));
      localStorage.setItem(OPT_TF_STORAGE_KEY, String(finalTf));
    }
    const savedMinTrades = localStorage.getItem(MIN_TRADES_STORAGE_KEY);
    if (savedMinTrades != null) {
      const n = Math.floor(Number(savedMinTrades));
      if (Number.isFinite(n) && n >= 0) setMinTrades(String(n));
    }
    setHideNegativeNetPnl(localStorage.getItem(EXCLUDE_NEGATIVE_STORAGE_KEY) === "1");
    setFilterValPnlPerTradePos(localStorage.getItem(FILTER_VAL_PNL_PER_TRADE_POS_STORAGE_KEY) === "1");
    setFilterValNetPnlPos(localStorage.getItem(FILTER_VAL_NET_PNL_POS_STORAGE_KEY) === "1");
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
    void refreshJobHistory();
  }, [jobHistoryLimit, jobHistoryOffset, jobHistorySortDir, jobHistorySortKey]);

  useInterval(() => {
    void refreshJobHistory();
  }, POLL_MS);

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
    localStorage.setItem(OPT_TF_STORAGE_KEY, String(Math.max(15, Math.floor(Number(optTfMin) || 15))));
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
    localStorage.setItem(SIM_SLIPPAGE_BPS_STORAGE_KEY, simSlippageBps);
  }, [simSlippageBps]);

  useEffect(() => {
    localStorage.setItem(EXECUTION_MODEL_STORAGE_KEY, executionModel);
  }, [executionModel]);

  useEffect(() => {
    localStorage.setItem(EXCLUDE_NEGATIVE_STORAGE_KEY, hideNegativeNetPnl ? "1" : "0");
  }, [hideNegativeNetPnl]);

  useEffect(() => {
    localStorage.setItem(FILTER_VAL_PNL_PER_TRADE_POS_STORAGE_KEY, filterValPnlPerTradePos ? "1" : "0");
  }, [filterValPnlPerTradePos]);

  useEffect(() => {
    localStorage.setItem(FILTER_VAL_NET_PNL_POS_STORAGE_KEY, filterValNetPnlPos ? "1" : "0");
  }, [filterValNetPnlPos]);

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

  useInterval(() => {
    setNowMs(Date.now());
  }, POLL_MS, jobStatus === "running");

  const loopExists = Boolean(loopStatus?.loop);
  const loopPaused = Boolean(loopStatus?.loop?.isPaused);
  const loopRunning = Boolean(loopStatus?.loop?.isRunning) && !loopPaused;
  const loopActive = loopRunning || loopPaused;
  const loopStopped = !loopRunning;
  const jobActive = jobStatus === "running" || jobStatus === "paused";
  const activeLoopJobId = loopJobId ?? lastNonNullLoopJobIdRef.current;
  const activeJobId = loopActive ? activeLoopJobId : singleJobId;

  useEffect(() => {
    if (!isAppendOnlyDebug()) return;
    const prevVersion = prevLoopAggVersionRef.current;
    const prevTotal = prevLoopAggTotalRef.current;
    const nextTotal = loopAggRowsForRender.length;
    if (loopActive && nextTotal < prevTotal) {
      console.log("[optimizer-loop-store-replaced]", { prevVersion, nextVersion: loopAggState.version, prevTotal, nextTotal, loopJobId });
    }
    prevLoopAggVersionRef.current = loopAggState.version;
    prevLoopAggTotalRef.current = nextTotal;
  }, [isAppendOnlyDebug, loopActive, loopAggRowsForRender.length, loopAggState.version, loopJobId]);

  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  useEffect(() => {
    loopActiveRef.current = loopActive;
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
    if (loopJobId) lastNonNullLoopJobIdRef.current = loopJobId;
  }, [loopJobId]);


  useEffect(() => {
    const prevLoopActive = prevLoopActiveRef.current;
    if (prevLoopActive && !loopActive && loopAggRowsForRender.length > 0) {
      setSingleJobId(null);
      void refreshJobHistory();
    }
    prevLoopActiveRef.current = loopActive;
  }, [loopActive, loopAggRowsForRender.length]);


  const resetLoopResultsState = useCallback(() => {
    logAppendOnlyDebug("reset", { reason: "reset-loop-results" });
    liveRowsPendingByJobIdRef.current = {};
    setLoopAggState({ runOrder: [], byRunId: {}, version: 0 });
    setLoopDebugTrackedRowIds([]);
    completedLoopRunIdsRef.current = {};
    setDone(0);
    setTotal(0);
    setPage(1);
    localStorage.removeItem(LOOP_RESULTS_DRAFT_STORAGE_KEY);
  }, [logAppendOnlyDebug]);

  const debugLoopStart = useCallback((stage: "before_request" | "error", data: { payloadKeys?: string[]; errorMessage?: string }) => {
    if (!import.meta.env.DEV) return;
    if (localStorage.getItem("debugOptimizerLoop") !== "1") return;
    const now = Date.now();
    if (now - loopStartDebugLogLastAtRef.current < 500) return;
    loopStartDebugLogLastAtRef.current = now;
    if (stage === "before_request") {
      console.log("[optimizer-loop:start]", {
        selectedHistoryIds,
        requestPayloadKeys: data.payloadKeys ?? [],
      });
      return;
    }
    console.log("[optimizer-loop:error]", {
      selectedHistoryIds,
      errorMessage: data.errorMessage ?? "unknown_error",
    });
  }, [selectedHistoryIds]);

  async function onStartLoop() {
    if (rangeError) return;
    if (!selectedHistoryIds.length) {
      setError("Select at least one history row before starting loop.");
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
        rearmMs: Math.max(countDecimals(ranges.rearmSec.min), countDecimals(ranges.rearmSec.max)),
      };
      if (import.meta.env.DEV && localStorage.getItem("debugDatasetTf") === "1") {
        const selectedRows = datasetHistories.filter((h) => selectedHistoryIds.includes(h.id));
        const selectedIntervals = [...new Set(selectedRows.map((h) => String(h.interval || "1")))];
        console.log("[optimizer-dataset-tf:selected]", {
          selectedHistoryIdsCount: selectedHistoryIds.length,
          intervals: selectedIntervals,
          chosenMaxInterval: chooseMaxDatasetInterval(selectedIntervals),
        });
      }

      const loopPayload = {
        datasetHistoryIds: selectedHistoryIds,
        candidates: Number(candidates),
        seed: Number(seed),
        minTrades: Math.max(0, Math.floor(Number(minTrades) || 0)),
        directionMode,
        optTfMin: Math.max(15, Math.floor(Number(optTfMin) || 15)),
        excludeNegative: false,
        rememberNegatives,
        sim: {
          marginPerTrade,
          leverage,
          feeBps: Number(simFeeBps) || 0,
          slippageBps: Number(simSlippageBps) || 0,
        },
        executionModel,
        ranges: Object.keys(rangePayload).length ? rangePayload : undefined,
        precision,
        runsCount: Math.max(1, Math.floor(Number(loopRunsCount) || 1)),
        infinite: loopInfinite,
        ...(datasetCache ? { datasetCache } : {}),
      };
      debugLoopStart("before_request", { payloadKeys: Object.keys(loopPayload) });
      resetLoopResultsState();
      await startOptimizerLoop(loopPayload);
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
      const errorMessage = String(e?.message ?? e);
      debugLoopStart("error", { errorMessage });
      setError(errorMessage);
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
    const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmSec"];
    for (const key of keys) {
      const minText = ranges[key].min;
      const maxText = ranges[key].max;
      const min = parseMaybeNumber(minText);
      const max = parseMaybeNumber(maxText);
      if (minText.trim() && min === undefined) return `${key} min must be a valid number`;
      if (maxText.trim() && max === undefined) return `${key} max must be a valid number`;
      if (min !== undefined && max !== undefined && min > max) return `${key} min must be less than or equal to max`;
      if (key === "timeoutSec" && min !== undefined && min < 61) return "timeoutSec min must be >= 61";
      if (key === "rearmSec" && min !== undefined && min < 900) return "rearmSec min must be >= 900";
    }
    return null;
  }, [ranges]);

  const historyRowsSorted = useMemo(() => {
    const rows = Array.isArray(datasetHistories) ? datasetHistories : [];
    const mapped = rows.map((h) => ({
      ...h,
      rangeMs: Math.max(0, Number(h.endMs) - Number(h.startMs)),
      universeLabel: `${h.universeName} (${h.receivedSymbolsCount})`,
    })) as Array<DatasetHistoryRecord & { rangeMs: number; universeLabel: string }>;

    const dir = historySortDir === "asc" ? 1 : -1;
    const key = historySortKey;

    const readValue = (row: any): number | string => {
      if (key === "rangeMs") return row.rangeMs;
      if (key === "universeLabel") return row.universeLabel;
      return row[key];
    };

    return [...mapped].sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [datasetHistories, historySortDir, historySortKey]);

  const historyPages = Math.max(1, Math.ceil(historyRowsSorted.length / historyPageSize));
  const historyPageClamped = Math.max(1, Math.min(historyPage, historyPages));
  const historyRowsPaged = historyRowsSorted.slice((historyPageClamped - 1) * historyPageSize, historyPageClamped * historyPageSize);
  const historySourceKey = useMemo(() => historyRowsSorted.map((row) => row.id).join("|"), [historyRowsSorted]);

  useEffect(() => {
    if (historyPage !== historyPageClamped) setHistoryPage(historyPageClamped);
  }, [historyPage, historyPageClamped]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySourceKey, historyPageSize]);

  const toggleHistory = useCallback((id: string) => {
    setSelectedHistoryIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  }, []);

  const toggleHistorySort = useCallback((key: keyof DatasetHistoryRecord | "rangeMs" | "universeLabel") => {
    setHistoryPage(1);
    setHistorySortKey((prevKey) => {
      if (prevKey === key) {
        setHistorySortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setHistorySortDir("asc");
      return key;
    });
  }, []);

  const onDeleteHistory = useCallback(async (id: string) => {
    if (!window.confirm(`Delete history ${id}?`)) return;
    setHistoryBusy(true);
    try {
      await deleteDatasetHistory(id);
      const res = await listDatasetHistories();
      setDatasetHistories(res.histories ?? []);
      setSelectedHistoryIds((prev) => prev.filter((v) => v !== id));
    } finally {
      setHistoryBusy(false);
    }
  }, []);

  function buildRangesPayload() {
    const payload: Partial<Record<"priceTh" | "oivTh" | "tp" | "sl" | "offset" | "timeoutSec" | "rearmMs", { min: number; max: number }>> = {};
    const keys: RangeKey[] = ["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmSec"];
    for (const key of keys) {
      const min = parseMaybeNumber(ranges[key].min);
      const max = parseMaybeNumber(ranges[key].max);
      if (min === undefined || max === undefined) continue;
      if (key === "rearmSec") {
        payload.rearmMs = { min: min * 1000, max: max * 1000 };
      } else {
        payload[key] = { min, max };
      }
    }
    return payload;
  }

  const upsertLoopRunRowsAppend = useCallback((jobId: string, rows: OptimizationResult[], source: "ws" | "poll" | "completed") => {
    if (!jobId || rows.length === 0) return;
    setLoopAggState((prev) => {
      let changed = false;
      const byRunId = { ...prev.byRunId };
      const runOrder = prev.runOrder.slice();
      if (!byRunId[jobId]) {
        byRunId[jobId] = { rowsById: new Map(), order: [], version: 1 };
        runOrder.push(jobId);
        changed = true;
      }
      const existingStore = byRunId[jobId];
      const rowsById = new Map(existingStore.rowsById);
      const order = existingStore.order.slice();
      let appendedRowId: string | null = null;
      for (const incomingRow of rows) {
        const row = normalizeOptimizerRow(incomingRow);
        const rowId = resolveRowId(row);
        const nextRow = { ...row, __runJobId: jobId };
        const existing = rowsById.get(rowId);
        if (!existing) {
          order.push(rowId);
          appendedRowId = rowId;
        }
        if (existing !== nextRow) {
          rowsById.set(rowId, nextRow);
          changed = true;
        }
      }
      if (!changed) return prev;
      byRunId[jobId] = { rowsById, order, version: existingStore.version + 1 };
      const next = { runOrder, byRunId, version: prev.version + 1 };
      const nextTotalRows = runOrder.reduce((acc, runId) => acc + (byRunId[runId]?.order.length ?? 0), 0);
      setTotalRows(nextTotalRows);
      if (appendedRowId) {
        debugTrackedRowIdRef.current = appendedRowId;
        setLoopDebugTrackedRowIds((prevIds) => [appendedRowId!, ...prevIds].slice(0, 3));
        logAppendOnlyDebug("append", { jobId, rowId: appendedRowId, source, totalRows: nextTotalRows });
      }
      return next;
    });
  }, [logAppendOnlyDebug]);

  const fetchAllResultsForJob = useCallback(async (jobId: string) => {
    const fetchPageSize = 50 as const;
    const first = await getJobResults(jobId, { page: 1, sortKey, sortDir, pageSize: fetchPageSize });
    const allRows = Array.isArray(first.results) ? [...first.results] : [];
    const totalPages = Math.max(1, Math.ceil((first.totalRows ?? allRows.length) / Math.max(1, first.pageSize || fetchPageSize)));
    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      const next = await getJobResults(jobId, { page: pageIndex, sortKey, sortDir, pageSize: fetchPageSize });
      if (Array.isArray(next.results) && next.results.length > 0) {
        allRows.push(...next.results);
      }
    }
    return allRows;
  }, [sortDir, sortKey]);

  const appendCompletedRunByJobId = useCallback(async (jobId: string) => {
    if (!jobId || completedLoopRunIdsRef.current[jobId]) return;
    completedLoopRunIdsRef.current[jobId] = true;
    try {
      const rows = await fetchAllResultsForJob(jobId);
      upsertLoopRunRowsAppend(jobId, rows, "completed");
    } catch {
      delete completedLoopRunIdsRef.current[jobId];
    }
  }, [fetchAllResultsForJob, upsertLoopRunRowsAppend]);


  const refreshLoopStatus = useCallback(async () => {
    try {
      const next = await getOptimizerLoopStatus();

      const isRunningNow = Boolean(next.loop?.isRunning);
      if (isRunningNow) lastTableSourceRef.current = "loop";

      const currentLoopJobId = next.loop?.lastJobId ?? null;
      const completedJobId = currentLoopJobId ?? lastNonNullLoopJobIdRef.current;
      const progressSnapshot = next.progress ?? null;

      let donePercent = Math.floor(Number(progressSnapshot?.runPct ?? next.lastJobStatus?.donePercent ?? 0));
      let runStatus = progressSnapshot?.status === "canceled" ? "cancelled" : next.lastJobStatus?.status;

      if (currentLoopJobId) {
        try {
          const statusRes = await getJobStatus(currentLoopJobId);
          const progress = getStableProgressForJob(currentLoopJobId, statusRes as { donePct?: number; done?: number; startedAtMs?: number | null });
          const snapshotRunPct = typeof progressSnapshot?.runPct === "number" ? progressSnapshot.runPct : null;
          donePercent = Math.floor(Number.isFinite(snapshotRunPct) ? Math.max(snapshotRunPct as number, progress.pct) : progress.pct);
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
      } else {
        // Loop can be stopped while `jobStatus` is still "running" (because we stop polling per-job status once `lastJobId` becomes null).
        // Ensure UI transitions to a terminal job status based on the persisted loop progress snapshot.
        const isRunningNow2 = Boolean(next.loop?.isRunning);
        const isPausedNow2 = Boolean(next.loop?.isPaused);
        if (!isRunningNow2 && !isPausedNow2 && progressSnapshot) {
          const mappedStatus = progressSnapshot.status === "done"
            ? "done"
            : progressSnapshot.status === "canceled"
              ? "cancelled"
              : progressSnapshot.status === "error"
                ? "error"
                : "idle";
          setJobStatus((prev) => (prev === mappedStatus ? prev : mappedStatus));
          setJobFinishedAtMs((prev) => {
            if (prev != null) return prev;
            const fromLoop = next.loop?.finishedAtMs ?? null;
            const fromProgress = typeof progressSnapshot.updatedAt === "number" ? progressSnapshot.updatedAt : null;
            return fromLoop ?? fromProgress;
          });
          setJobUpdatedAtMs((prev) => {
            const updatedAt = next.loop?.updatedAtMs ?? null;
            return prev === updatedAt ? prev : updatedAt;
          });
          const lastId = lastNonNullLoopJobIdRef.current;
          if (lastId) {
            const startedAt = startedAtByJobIdRef.current[lastId] ?? null;
            if (startedAt != null) setJobStartedAtMs((prev) => (prev == null ? startedAt : prev));
          }
        }
      }

      const didCompleteRun = prevLoopRunningRef.current && (
        donePercent === 100 ||
        runStatus === "done" ||
        progressSnapshot?.status === "done"
      );

      setLoopStatus(next);
      maybeLogProgress(progressSnapshot);
      setNowMs(Date.now());
      setTotal(100);
      setDone((prev) => {
        if (progressSnapshot) return Math.floor(clamp(progressSnapshot.runPct, 0, 100));
        if (donePercent === 100) return 100;
        if (!isRunningNow && !next.loop?.isPaused) return prev;
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
  }, [appendCompletedRunByJobId, getStableProgressForJob, maybeLogProgress]);

  useEffect(() => {
    void refreshLoopStatus();
  }, [refreshLoopStatus]);

  useInterval(() => {
    void refreshLoopStatus();
  }, POLL_MS, loopExists);



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
    options?: { keepPreviousIfEmpty?: boolean; pageSize?: 10 | 25 | 50 }
  ) {
    const fetchSize = options?.pageSize ?? resultsPageSize;
    const res = await getJobResults(activeJobId, { page: nextPage, sortKey: nextSortKey, sortDir: nextSortDir, pageSize: fetchSize });
    const nextResults = res.results ?? [];
    if (loopActive) {
      return;
    }
    const keepPreviousIfEmpty = options?.keepPreviousIfEmpty ?? false;
    if (keepPreviousIfEmpty && nextResults.length === 0) return;
    const rowsById = new Map<string, OptimizationResult>();
    const order: string[] = [];
    for (const row of nextResults) {
      const rowId = resolveRowId(row);
      if (!rowsById.has(rowId)) order.push(rowId);
      rowsById.set(rowId, row);
    }
    liveSingleRowsMapRef.current = new Map(rowsById);
    setSingleResultsState((prev) => {
      if (prev.order.length === order.length && prev.order.every((rowId, idx) => rowId === order[idx] && prev.rowsById.get(rowId) === rowsById.get(rowId))) {
        return prev;
      }
      return { rowsById, order, version: prev.version + 1 };
    });
    setPage((prev) => (prev === res.page ? prev : res.page));
    setTotalRows((prev) => (prev === res.totalRows ? prev : res.totalRows));
  }

  useEffect(() => {
    if (activeJobIdRef.current && activeJobIdRef.current !== activeJobId) {
      logAppendOnlyDebug("reset", { reason: "activeJobIdChanged", prevJobId: activeJobIdRef.current, nextJobId: activeJobId });
    }
    liveSingleRowsMapRef.current = new Map();
    liveRowsPendingByJobIdRef.current = {};
    debugTrackedRowIdRef.current = null;
    setLoopDebugTrackedRowIds([]);
    if (liveRowsFlushTimerRef.current != null) {
      window.clearTimeout(liveRowsFlushTimerRef.current);
      liveRowsFlushTimerRef.current = null;
    }
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
  }, [activeJobId, clearSingleJobState, isNoCurrentJobError, logAppendOnlyDebug, loopActive, sortDir, sortKey]);

  const pollSingleJobStatus = useCallback(async () => {
    if (loopActive || !singleJobId || !jobActive) return;
    try {
      const reqJobId = singleJobId;
      const now = Date.now();
      if (lastStatusFetchRef.current.jobId === reqJobId && now - lastStatusFetchRef.current.ts < POLL_MS) return;
      lastStatusFetchRef.current = { jobId: reqJobId, ts: now };
      const res = await getJobStatus(reqJobId);
      if (loopActive || singleJobId !== reqJobId) return;
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
      if (res.status !== "running" && res.status !== "paused") {
        await fetchResults(page, sortKey, sortDir, reqJobId, { keepPreviousIfEmpty: false });
      }
      if (res.status === "error") {
        setError(res.message ?? "Optimization job failed.");
        await refreshJobHistory();
      }
      if (res.status === "done" || res.status === "cancelled") {
        if (res.status === "cancelled") setError(res.message ?? "Optimization cancelled.");
        await fetchResults(1, sortKey, sortDir, reqJobId, { keepPreviousIfEmpty: false });
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
  }, [fetchResults, getStableProgressForJob, isNoCurrentJobError, jobActive, loopActive, page, refreshJobHistory, singleJobId, sortDir, sortKey]);

  useInterval(() => {
    void pollSingleJobStatus();
  }, POLL_MS, !loopActive && Boolean(singleJobId) && jobActive);

  useEffect(() => {
    if (!lastMsg) return;
    if (lastProcessedMsgRef.current === lastMsg) return;
    lastProcessedMsgRef.current = lastMsg;
    let parsed: any = null;
    try {
      parsed = JSON.parse(lastMsg);
    } catch {
      return;
    }
    if (parsed?.type === "snapshot") {
      const snapshotJobId = typeof parsed?.payload?.optimizer?.jobId === "string" ? parsed.payload.optimizer.jobId : null;
      const snapshotRows = Array.isArray(parsed?.payload?.optimizer?.rows) ? parsed.payload.optimizer.rows as OptimizationResult[] : [];
      if (!snapshotJobId || snapshotJobId !== activeJobId || loopActive || snapshotRows.length === 0) return;
      setSingleResultsState((prev) => {
        const shouldReplace = prev.order.length === 0;
        if (shouldReplace) {
          const rowsById = new Map<string, OptimizationResult>();
          const order: string[] = [];
          for (const rawRow of snapshotRows) {
            const row = normalizeOptimizerRow(rawRow);
            const rowId = resolveRowId(row);
            if (!rowsById.has(rowId)) order.push(rowId);
            rowsById.set(rowId, row);
          }
          setTotalRows(order.length);
          logAppendOnlyDebug("snapshot-replace", { jobId: snapshotJobId, rows: snapshotRows.length });
          return { rowsById, order, version: prev.version + 1 };
        }
        let changed = false;
        let appendedRowId: string | null = null;
        const rowsById = new Map(prev.rowsById);
        const order = prev.order.slice();
        for (const rawRow of snapshotRows) {
          const row = normalizeOptimizerRow(rawRow);
          const rowId = resolveRowId(row);
          const existing = rowsById.get(rowId);
          if (!existing) {
            order.push(rowId);
            appendedRowId = rowId;
            rowsById.set(rowId, row);
            changed = true;
            continue;
          }
          if (existing !== row) {
            rowsById.set(rowId, row);
            changed = true;
          }
        }
        if (!changed) {
          logAppendOnlyDebug("snapshot-merge-noop", { jobId: snapshotJobId, rows: snapshotRows.length });
          return prev;
        }
        if (appendedRowId) {
          debugTrackedRowIdRef.current = appendedRowId;
          logAppendOnlyDebug("append", { jobId: snapshotJobId, rowId: appendedRowId, source: "snapshot", totalRows: order.length });
        }
        setTotalRows(order.length);
        logAppendOnlyDebug("snapshot-merge", { jobId: snapshotJobId, rows: snapshotRows.length, totalRows: order.length });
        return { rowsById, order, version: prev.version + 1 };
      });
      return;
    }
    if (parsed?.type !== "optimizer_rows_append") return;
    const jobId = String(parsed?.payload?.jobId ?? "");
    const rows = Array.isArray(parsed?.payload?.rows) ? parsed.payload.rows as OptimizationResult[] : [];
    if (!jobId || rows.length === 0) return;

    if (lastTableSourceRef.current === "loop") {
      upsertLoopRunRowsAppend(jobId, rows, "ws");
      return;
    }

    if (loopActive || jobId !== activeJobId) return;
    queueLiveRowsAppend(jobId, rows);
  }, [activeJobId, flushLiveRowsForActiveJob, lastMsg, logAppendOnlyDebug, loopActive, queueLiveRowsAppend, upsertLoopRunRowsAppend]);

  useEffect(() => {
    if (lastTableSourceRef.current !== "loop") return;
    const currentRunId = loopStatus?.loop?.lastJobId ?? null;
    if (!currentRunId) return;
    if (hydratedLoopRunIdsRef.current[currentRunId]) return;
    const existingCount = loopAggState.byRunId[currentRunId]?.order.length ?? 0;
    if (existingCount > 0) {
      hydratedLoopRunIdsRef.current[currentRunId] = true;
      return;
    }
    hydratedLoopRunIdsRef.current[currentRunId] = true;
    let alive = true;
    const hydrateRunResults = async () => {
      try {
        const rows = await fetchAllResultsForJob(currentRunId);
        if (!alive) return;
        logAppendOnlyDebug("hydrate", { jobId: currentRunId, source: "poll", rows: rows.length });
        upsertLoopRunRowsAppend(currentRunId, rows, "poll");
      } catch {
        delete hydratedLoopRunIdsRef.current[currentRunId];
      }
    };
    void hydrateRunResults();

    return () => {
      alive = false;
    };
  }, [fetchAllResultsForJob, logAppendOnlyDebug, loopAggState.byRunId, loopStatus?.loop?.lastJobId, upsertLoopRunRowsAppend]);
  async function onSort(nextSortKey: OptimizerSortKeyExtended) {
    const defaultDir: OptimizerSortDir = nextSortKey === "direction" ? "asc" : "desc";
    const nextSortDir: OptimizerSortDir = sortKey === nextSortKey ? (sortDir === "desc" ? "asc" : "desc") : defaultDir;
    setSortKey(nextSortKey);
    setSortDir(nextSortDir);
    if (isLoopDisplay) {
      setPage(1);
      return;
    }
    if (!activeJobId) return;
    if (["netPnl", "trades", "winRatePct", "trainNetPnl", "trainTrades", "valNetPnl", "valTrades", "valPnlPerTrade", "ordersPlaced", "ordersFilled", "ordersExpired", "priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmMs", "longsCount", "longsPnl", "longsWinRatePct", "shortsCount", "shortsPnl", "shortsWinRatePct"].includes(nextSortKey)) {
      await fetchResults(1, nextSortKey, nextSortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
    }
  }

  async function onPageChange(nextPage: number) {
    if (isLoopDisplay) {
      setPage(nextPage);
      return;
    }
    if (!activeJobId) return;
    await fetchResults(nextPage, sortKey, sortDir, activeJobId, { keepPreviousIfEmpty: loopActive });
  }

  async function onResultsPageSizeChange(nextSize: 10 | 25 | 50) {
    setResultsPageSize(nextSize);
    setPage(1);
    if (isLoopDisplay) {
      return;
    }
    if (!activeJobId) return;
    await fetchResults(1, sortKey, sortDir, activeJobId, { keepPreviousIfEmpty: loopActive, pageSize: nextSize });
  }

  const activePrecision = (activeJobId ? jobPrecisionById[activeJobId] : undefined) ?? DEFAULT_PRECISION;


  const copyToSettings = useCallback((row: OptimizationResult) => {
    const rowRearmSec = Number((row.params as { rearmSec?: unknown }).rearmSec);
    const rowRearmMs = Number((row.params as { rearmMs?: unknown }).rearmMs);
    const mappedRearmSec = Number.isFinite(rowRearmSec) && rowRearmSec >= 0
      ? rowRearmSec
      : (Number.isFinite(rowRearmMs) ? Math.round(rowRearmMs / 1000) : 0);
    const paperRearmSec = Math.max(0, Math.round(mappedRearmSec));

    const rowTimeoutSec = Number((row as { params?: { timeoutSec?: unknown }; timeoutSec?: unknown }).params?.timeoutSec ?? (row as { timeoutSec?: unknown }).timeoutSec);
    const paperPatch: Record<string, number> = {
      tpRoiPct: quantizeByPrecision(row.params.tpRoiPct, activePrecision.tp),
      slRoiPct: quantizeByPrecision(row.params.slRoiPct, activePrecision.sl),
      entryOffsetPct: quantizeByPrecision(row.params.entryOffsetPct, activePrecision.offset),
      rearmSec: paperRearmSec,
    };
    if (Number.isFinite(rowTimeoutSec)) {
      paperPatch.entryTimeoutSec = rowTimeoutSec;
    }

    const patch = {
      source: "optimizer",
      ts: Date.now(),
      datasetId: null,
      jobId: activeJobId,
      rank: row.rank,
      patch: {
        signals: {
          priceThresholdPct: quantizeByPrecision(row.params.priceThresholdPct, activePrecision.priceTh),
          oivThresholdPct: quantizeByPrecision(row.params.oivThresholdPct, activePrecision.oivTh),
        },
        paper: paperPatch,
      },
    };
    localStorage.setItem("bots_dev.pendingConfigPatch", JSON.stringify(patch));
  }, [activeJobId, activePrecision]);


  const onExportTrades = useCallback((row: OptimizationResult) => {
    const loopRowJobId = String((row as any)?.__runJobId ?? "");
    const rowJobId = loopRowJobId || String(activeJobId ?? "");
    if (!rowJobId) return;
    window.open(getJobTradesExportUrl(rowJobId, row.rank), "_blank", "noopener,noreferrer");
  }, [activeJobId]);



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
  const minTradesLimit = Math.max(0, Math.floor(Number(minTrades) || 0));
  const rawRows = isLoopDisplay ? loopAggRowsForRender : singleRowsForRender;
  const rowsForDisplay = rawRows.filter((row) => minTradesLimit <= 0 || row.trades >= minTradesLimit);
  const baseDisplayRows = isLoopDisplay
    ? (hideNegativeNetPnl ? rowsForDisplay.filter((row) => row.netPnl >= 0) : rowsForDisplay)
    : rowsForDisplay;
  const displayedRows = baseDisplayRows.filter((row) => {
    if (filterValPnlPerTradePos && readValPnlPerTrade(row) <= 0) return false;
    if (filterValNetPnlPos && (Number(row.valNetPnl) || 0) <= 0) return false;
    return true;
  });
  const sortedDisplayedRows = useMemo(() => sortOptimizerRows(displayedRows, sortKey, sortDir), [displayedRows, sortDir, sortKey]);
  const resultsSourceKey = `${isLoopDisplay ? "loop" : "single"}:${activeJobId ?? ""}`;
  const rawRowsCount = rawRows.length;
  const displayedRowsCount = sortedDisplayedRows.length;
  const loopDisplayRows = useMemo(() => {
    if (!isLoopDisplay) return sortedDisplayedRows;
    const start = (page - 1) * resultsPageSize;
    return sortedDisplayedRows.slice(start, start + resultsPageSize);
  }, [isLoopDisplay, page, resultsPageSize, sortedDisplayedRows]);
  const totalPages = Math.max(1, Math.ceil((isLoopDisplay ? sortedDisplayedRows.length : totalRows) / resultsPageSize));
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
    setPage(1);
  }, [resultsSourceKey, minTradesLimit, hideNegativeNetPnl, filterValPnlPerTradePos, filterValNetPnlPos]);

  useEffect(() => {
    const maxOffset = Math.max(0, (jobHistoryTotalPages - 1) * jobHistoryLimit);
    if (jobHistoryOffset > maxOffset) setJobHistoryOffset(maxOffset);
  }, [jobHistoryLimit, jobHistoryOffset, jobHistoryTotalPages]);
  const isRunningStatus = jobStatus === "running";
  const currentLoopJobId = loopStatus?.loop?.lastJobId ?? null;
  const currentLoopRunStartedAtMs = currentLoopJobId
    ? (startedAtByJobIdRef.current[currentLoopJobId] ?? jobStartedAtMs)
    : null;
  const startedAtForActiveJobId = loopActive
    ? currentLoopRunStartedAtMs
    : (activeJobId ? (jobStartedAtMs ?? startedAtByJobIdRef.current[activeJobId] ?? null) : jobStartedAtMs);
  const endMs = !startedAtForActiveJobId
    ? null
    : (loopActive || isRunningStatus)
      ? nowMs
      : (jobFinishedAtMs ?? jobUpdatedAtMs ?? startedAtForActiveJobId);
  const elapsedSec = endMs == null || !startedAtForActiveJobId ? null : Math.max(0, (endMs - startedAtForActiveJobId) / 1000);
  const pctDone = Math.floor(clamp(done, 0, 100));
  const etaSec = elapsedSec != null && pctDone > 0 && pctDone < 100
    ? elapsedSec * (100 / pctDone - 1)
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

  const loopOrJobRunning = jobStatus === "running" || jobStatus === "paused" || Boolean(loopStatus?.loop?.isRunning) || Boolean(loopStatus?.loop?.isPaused);
  useEffect(() => {
    if (!loopOrJobRunning || rawRowsCount > 0) {
      setShowLoopNoRowsWarning(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowLoopNoRowsWarning(true);
    }, LOOP_EMPTY_RESULTS_WARNING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loopOrJobRunning, rawRowsCount]);

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
            {datasetHistories.length === 0 ? <Alert variant="warning" className="py-2">No dataset history yet. Run Receive Data to create history rows.</Alert> : null}

            <Card className="mb-3">
              <Card.Header className="py-2">Dataset history</Card.Header>
              <Card.Body className="py-2">
                <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: 12 }}>
                  <div>Selected: <b>{selectedHistoryIds.length}</b></div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <Table size="sm" bordered hover className="mb-2" style={{ minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}></th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("startMs")}>from</th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("endMs")}>to</th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("rangeMs")}>range</th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("universeLabel")}>universe</th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("interval")}>tf</th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("receivedAtMs")}>received</th>
                        <th style={{ cursor: "pointer" }} onClick={() => toggleHistorySort("loopsCount")}>loop runs</th>
                        <th style={{ width: 200 }}>actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRowsPaged.length === 0 ? (
                        <tr><td colSpan={9} className="text-muted">No history</td></tr>
                      ) : historyRowsPaged.map((h: any) => {
                        const checked = selectedHistoryIds.includes(h.id);
                        const rangeSec = Math.floor((h.rangeMs ?? 0) / 1000);
                        return (
                          <tr key={h.id}>
                            <td className="text-center">
                              <Form.Check type="checkbox" checked={checked} onChange={() => toggleHistory(h.id)} />
                            </td>
                            <td>{formatHistoryEndedAt(Number(h.startMs))}</td>
                            <td>{formatHistoryEndedAt(Number(h.endMs))}</td>
                            <td>{formatDuration(rangeSec)}</td>
                            <td>{h.universeLabel}</td>
                            <td>{h.interval}</td>
                            <td>{formatHistoryEndedAt(Number(h.receivedAtMs))}</td>
                            <td>{Number(h.loopsCount) || 0}</td>
                            <td>
                              <div className="d-flex gap-2">
                                <Button size="sm" variant="outline-danger" onClick={() => void onDeleteHistory(h.id)}>Delete</Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>

                <TablePaginationControls
                  tableId="optimizer-dataset-histories"
                  page={historyPageClamped}
                  totalRows={historyRowsSorted.length}
                  pageSize={historyPageSize}
                  onPageChange={setHistoryPage}
                  onPageSizeChange={(size) => { setHistoryPage(1); setHistoryPageSize(size); }}
                />
              </Card.Body>
            </Card>

            <fieldset disabled={false}>
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
                <Form.Label style={{ fontSize: 12 }}>signal window (min)</Form.Label>
                <Form.Select value={optTfMin} onChange={(e) => setOptTfMin(String(Math.max(15, Math.floor(Number(e.currentTarget.value) || 15))))}>
                  <option value="15">15</option>
                  <option value="30">30</option>
                  <option value="60">60</option>
                  <option value="120">120</option>
                  <option value="240">240</option>
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
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Remember negatives" checked={rememberNegatives} onChange={(e) => setRememberNegatives(e.currentTarget.checked)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Loop until Stop" checked={loopInfinite} disabled={loopActive} onChange={(e) => setLoopInfinite(e.currentTarget.checked)} />
                  </Form.Group>
                </div>
              </Col>
            </Row>
            <Row className="g-2 align-items-end mb-2">
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
                  <Form.Label style={{ fontSize: 12 }}>feeBps</Form.Label>
                  <Form.Control value={simFeeBps} onChange={(e) => setSimFeeBps(e.currentTarget.value)} type="number" min={0} step={0.01} />
                </Form.Group>
              </Col>
              <Col md={2} sm={4} xs={6}>
                <Form.Group>
                  <Form.Label style={{ fontSize: 12 }}>slippageBps</Form.Label>
                  <Form.Control value={simSlippageBps} onChange={(e) => setSimSlippageBps(e.currentTarget.value)} type="number" min={0} step={0.01} />
                </Form.Group>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Form.Group>
                  <Form.Label style={{ fontSize: 12 }}>execution</Form.Label>
                  <Form.Select value={executionModel} onChange={(e) => setExecutionModel(e.currentTarget.value as OptimizerExecutionModel)}>
                    <option value="closeOnly">Close-only (safe)</option>
                    <option value="conservativeOhlc">Conservative OHLC</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button variant="outline-primary" onClick={() => void onStartLoop()} disabled={!selectedHistoryIds.length || loopBusy || loopRunning || loopPaused || Boolean(rangeError)}>Start loop</Button>
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
                {(["priceTh", "oivTh", "tp", "sl", "offset", "timeoutSec", "rearmSec"] as RangeKey[]).map((key) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>
                      <Form.Control
                        size="sm"
                        value={ranges[key].min}
                        onChange={onRangeChange(key, "min")}
                        disabled={key === "timeoutSec" || key === "rearmSec"}
                        min={key === "timeoutSec" ? 61 : key === "rearmSec" ? 900 : undefined}
                      />
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        value={ranges[key].max}
                        onChange={onRangeChange(key, "max")}
                        min={key === "timeoutSec" ? 61 : key === "rearmSec" ? 900 : undefined}
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
              <div style={{ fontSize: 12, marginBottom: 8 }}>Hide negative: <b>{hideNegativeNetPnl ? "ON" : "OFF"}</b></div>
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

            {showLoopNoRowsWarning ? <div style={{ fontSize: 12, marginBottom: 8, color: "#a86d00" }}>No result rows received yet. If this persists, enable debugOptimizerRows.</div> : null}
            {!showLoopNoRowsWarning && rawRowsCount > 0 && displayedRowsCount === 0 ? <div style={{ fontSize: 12, marginBottom: 8, color: "#6c757d" }}>Rows exist but are hidden by active display filters.</div> : null}
            <div className="d-flex align-items-center gap-2 mb-2 flex-wrap" style={{ fontSize: 12 }}>
              <span>minTrades</span>
              <Form.Control size="sm" value={minTrades} onChange={(e) => setMinTrades(e.currentTarget.value)} type="number" min={0} step={1} style={{ width: 90 }} />
              <Form.Check style={{ fontSize: 12 }} type="checkbox" label="Hide negative netPnl" checked={hideNegativeNetPnl} onChange={(e) => setHideNegativeNetPnl(e.currentTarget.checked)} />
              <Form.Check style={{ fontSize: 12 }} type="checkbox" label="val pnl/trade > 0" checked={filterValPnlPerTradePos} onChange={(e) => setFilterValPnlPerTradePos(e.currentTarget.checked)} />
              <Form.Check style={{ fontSize: 12 }} type="checkbox" label="val netPnl > 0" checked={filterValNetPnlPos} onChange={(e) => setFilterValNetPnlPos(e.currentTarget.checked)} />
            </div>
            <Table striped bordered hover size="sm" style={{ tableLayout: "auto" }}>
              <thead>
                <tr>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("pnlPerTrade")}>pnl/trades</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("trainNetPnl")}>train pnl/trades</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("valNetPnl")}>val pnl/trades</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("valPnlPerTrade")}>val pnl/trade</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("netPnl")}>netPnl</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("trades")}>trades</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("winRatePct")}>winRate</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("direction")}>direction</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("longsPnl")}>Longs</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("shortsPnl")}>Shorts</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("ordersPlaced")}>placed</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("ordersFilled")}>filled</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("ordersExpired")}>expired</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("priceTh")}>priceTh</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("oivTh")}>oivTh</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("tp")}>tp</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("sl")}>sl</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("offset")}>offset</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("timeoutSec")}>timeoutSec</th>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => void onSort("rearmMs")}>rearmSec</th>
                  <th style={{ whiteSpace: "nowrap" }}>action</th>
                </tr>
              </thead>
              <OptimizerResultsBody
                rows={loopDisplayRows}
                activePrecision={activePrecision}
                isLoopDisplay={isLoopDisplay}
                debugTrackedRowIds={loopDebugTrackedRowIds}
                onCopyToSettings={copyToSettings}
                onExportTrades={onExportTrades}
              />
            </Table>
            <TablePaginationControls
              tableId="optimizer-results"
              page={Math.min(page, totalPages)}
              totalRows={isLoopDisplay ? sortedDisplayedRows.length : totalRows}
              pageSize={resultsPageSize}
              onPageChange={(nextPage) => { void onPageChange(nextPage); }}
              onPageSizeChange={(size) => { void onResultsPageSizeChange(size); }}
            />
          </Card.Body>
        </Card>

        <Card>
          <Card.Header><b>Completed / Stopped runs</b></Card.Header>
          <Card.Body>
            <Table striped bordered hover size="sm" style={HISTORY_TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...historyRunIdCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("jobId")}>runId</th>
                  <th style={{ ...historyEndedAtCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("endedAtMs")}>endedAt</th>
                  <th style={{ ...historyStatusCellStyle, cursor: "pointer" }} onClick={() => onHistorySort("status")}>status</th>
                  {!historyCompactMode ? <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("mode")}>mode</th> : null}
                  <th style={{ ...HISTORY_CELL_STYLE, cursor: "pointer" }} onClick={() => onHistorySort("datasets")}>dataset</th>
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
                  const datasetHistoryIds = getDatasetHistoryIds((row as any).runPayload);
                  const optTfMin = getHistoryRunPayloadValue<number | string | null>((row as any).runPayload, "optTfMin", null);
                  const candidates = getHistoryRunPayloadValue<number | string>((row as any).runPayload, "candidates", "-");
                  const seed = getHistoryRunPayloadValue<number | string>((row as any).runPayload, "seed", "-");
                  const direction = getHistoryRunPayloadValue<string>((row as any).runPayload, "directionMode", "-");
                  return (
                    <Fragment key={row.jobId}>
                      <tr>
                        <td style={historyRunIdCellStyle} title={row.jobId}>{row.jobId.slice(0, 7)}</td>
                        <td style={historyEndedAtCellStyle} title={new Date(row.endedAtMs).toISOString()}><span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatHistoryEndedAt(row.endedAtMs)}</span></td>
                        <td style={historyStatusCellStyle}>{row.status.toUpperCase()}</td>
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{row.mode ?? "-"}</td> : null}
                        <td style={HISTORY_CELL_STYLE} title={datasetHistoryIds.join(",") || "-"}>{datasetHistoryIds.length || "-"}</td>
                        <td style={HISTORY_CELL_STYLE}>{optTfMin ?? "-"}</td>
                        <td style={HISTORY_CELL_STYLE}>{candidates}</td>
                        <td style={HISTORY_CELL_STYLE}>{formatSimSummary((row.runPayload as any).sim)}</td>
                        {!historyCompactMode ? <td style={HISTORY_CELL_STYLE}>{seed}</td> : null}
                        <td style={HISTORY_CELL_STYLE}>{direction}</td>
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
                                      <th>netPnl</th><th>trades</th><th>winRate</th><th>direction</th><th>expectancy</th><th>profitFactor</th><th>maxDD</th>
                                      <th>placed</th><th>filled</th><th>expired</th><th>priceTh</th><th>oivTh</th><th>tp</th><th>sl</th><th>offset</th><th>timeoutSec</th><th>rearmSec</th><th>action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailsRows.map((r, i) => (
                                      <tr key={`${row.jobId}-${r.netPnl}-${r.trades}-${r.params.priceThresholdPct}-${r.params.oivThresholdPct}-${i}`}>
                                        <td>{r.netPnl.toFixed(4)}</td><td>{r.trades}</td><td>{r.winRatePct.toFixed(2)}%</td><td>{String(r.directionMode ?? "both").toLowerCase()}</td><td>{r.expectancy.toFixed(4)}</td><td>{r.profitFactor.toFixed(3)}</td><td>{r.maxDrawdownUsdt.toFixed(4)}</td>
                                        <td>{r.ordersPlaced}</td><td>{r.ordersFilled}</td><td>{r.ordersExpired}</td><td>{r.params.priceThresholdPct.toFixed(activePrecision.priceTh)}</td><td>{r.params.oivThresholdPct.toFixed(activePrecision.oivTh)}</td><td>{r.params.tpRoiPct.toFixed(activePrecision.tp)}</td><td>{r.params.slRoiPct.toFixed(activePrecision.sl)}</td><td>{r.params.entryOffsetPct.toFixed(activePrecision.offset)}</td><td>{r.params.timeoutSec.toFixed(activePrecision.timeoutSec)}</td><td>{(r.params.rearmMs / 1000).toFixed(activePrecision.rearmMs)}</td>
                                        <td><Button size="sm" variant="outline-secondary" onClick={() => copyToSettings(r)}>Copy</Button></td>
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
            <TablePaginationControls
              tableId="optimizer-job-history"
              page={jobHistoryCurrentPage}
              totalRows={jobHistoryTotal}
              pageSize={jobHistoryLimit}
              onPageChange={(nextPage) => setJobHistoryOffset((Math.max(1, nextPage) - 1) * jobHistoryLimit)}
              onPageSizeChange={(size) => {
                setJobHistoryLimit(size);
                setJobHistoryOffset(0);
              }}
            />
          </Card.Body>
        </Card>
      </Container>

    </>
  );
}




