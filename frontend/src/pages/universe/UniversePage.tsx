import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Container, Form, Spinner, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeedLite } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import { createUniverse, deleteUniverse, listAvailableUniverseSymbols, listUniverses, readUniverse, readUniverseSymbolSummary } from "../../features/universe/api";
import type { UniverseAvailableSymbolRow, UniverseFile, UniverseMeta, UniverseMetricsRange, UniverseSymbolSummaryRow } from "../../features/universe/types";
import { fmtNum, fmtTime } from "../../shared/utils/format";
import { CenteredProgressBar } from "../../shared/ui/CenteredProgressBar";
import { TablePaginationControls, useStoredPageSize } from "../../shared/ui/TablePaginationControls";
import { usePersistentState } from "../../shared/hooks/usePersistentState";

const CREATE_JOB_STORAGE_KEY = "universeCreateJob";
const RANGE_OPTIONS: Array<{ value: UniverseMetricsRange; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "48h", label: "48 hours" },
  { value: "1w", label: "1 week" },
  { value: "2w", label: "2 weeks" },
  { value: "1mo", label: "1 month" },
];

type UniverseCreateJobState = {
  status: "running";
  minTurnoverUsd: number;
  minVolatilityPct: number;
  pendingSinceMs: number;
};

type SymbolSummarySortKey = "index" | "symbol" | "high" | "low" | "openInterestValue" | "priceChangePct" | "openInterestChangePct";
type SymbolSummarySortDir = "asc" | "desc";
type AvailableSortKey = "symbol" | "turnover" | "volatility";
type AvailableSortDir = "asc" | "desc";

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined): number {
  const an = typeof a === "number" && Number.isFinite(a);
  const bn = typeof b === "number" && Number.isFinite(b);
  if (!an && !bn) return 0;
  if (!an) return 1;
  if (!bn) return -1;
  return (a as number) - (b as number);
}

export function UniversePage() {
  const { conn, lastServerTime, wsUrl, streams } = useWsFeedLite();
  const { status, busy, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();

  const [minTurnoverUsd, setMinTurnoverUsd] = usePersistentState<string>("universe.minTurnoverUsd", "10000000");
  const [minVolPct, setMinVolPct] = usePersistentState<string>("universe.minVolPct", "10");
  const [metricsRange, setMetricsRange] = usePersistentState<UniverseMetricsRange>("universe.metricsRange", "24h");

  const [items, setItems] = useState<UniverseMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createJob, setCreateJob] = useState<UniverseCreateJobState | null>(null);
  const [createProgressNowMs, setCreateProgressNowMs] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<UniverseMeta | null>(null);
  const [stats, setStats] = useState<any | null>(null);

  const [expandedUniverseId, setExpandedUniverseId] = useState<string | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [expandedById, setExpandedById] = useState<Record<string, UniverseFile>>({});
  const [summaryById, setSummaryById] = useState<Record<string, UniverseSymbolSummaryRow[]>>({});
  const [summarySortById, setSummarySortById] = useState<Record<string, { key: SymbolSummarySortKey; dir: SymbolSummarySortDir }>>({});
  const [availableRows, setAvailableRows] = useState<UniverseAvailableSymbolRow[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [availableUpdatedAtMs, setAvailableUpdatedAtMs] = useState<number | null>(null);
  const [rangeSwitchInProgress, setRangeSwitchInProgress] = useState(false);
  const [rangeLoadProgress, setRangeLoadProgress] = useState(0);
  const [availableSort, setAvailableSort] = usePersistentState<{ key: AvailableSortKey; dir: AvailableSortDir }>("universe.availableSort", { key: "turnover", dir: "desc" });
  const [availablePage, setAvailablePage] = usePersistentState<number>("universe.availablePage", 1);
  const [availablePageSize, setAvailablePageSize] = useStoredPageSize("universe-available", 25);

  const [savedPage, setSavedPage] = usePersistentState<number>("universe.savedPage", 1);
  const [savedPageSize, setSavedPageSize] = useStoredPageSize("universe-saved", 25);
  const createAbortRef = useRef<AbortController | null>(null);
  const rangeLoadIntervalRef = useRef<number | null>(null);

  const persistCreateJob = useCallback((job: UniverseCreateJobState | null) => {
    if (!job) {
      window.localStorage.removeItem(CREATE_JOB_STORAGE_KEY);
      return;
    }
    try {
      window.localStorage.setItem(CREATE_JOB_STORAGE_KEY, JSON.stringify(job));
    } catch {
      // Ignore quota errors to avoid UI crash.
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listUniverses();
      setItems(res.universes ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshAvailable = useCallback(async (reason: "poll" | "range" = "poll") => {
    if (reason === "range") {
      setRangeSwitchInProgress(true);
      setRangeLoadProgress(8);
      if (rangeLoadIntervalRef.current != null) {
        window.clearInterval(rangeLoadIntervalRef.current);
        rangeLoadIntervalRef.current = null;
      }
      rangeLoadIntervalRef.current = window.setInterval(() => {
        setRangeLoadProgress((prev) => Math.min(92, prev + 6));
      }, 200);
    }
    setAvailableLoading(true);
    setAvailableError(null);
    try {
      const res = await listAvailableUniverseSymbols(metricsRange);
      setAvailableRows(Array.isArray(res.rows) ? res.rows : []);
      setAvailableUpdatedAtMs(Date.now());
    } catch (e: any) {
      setAvailableError(String(e?.message ?? e));
    } finally {
      setAvailableLoading(false);
      if (reason === "range") {
        if (rangeLoadIntervalRef.current != null) {
          window.clearInterval(rangeLoadIntervalRef.current);
          rangeLoadIntervalRef.current = null;
        }
        setRangeLoadProgress(100);
        window.setTimeout(() => {
          setRangeSwitchInProgress(false);
          setRangeLoadProgress(0);
        }, 250);
      }
    }
  }, [metricsRange]);

  useEffect(() => {
    void refreshAvailable("range");
  }, [refreshAvailable]);

  useEffect(() => {
    return () => {
      if (rangeLoadIntervalRef.current != null) {
        window.clearInterval(rangeLoadIntervalRef.current);
        rangeLoadIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(CREATE_JOB_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as UniverseCreateJobState;
      if (parsed?.status !== "running" || !Number.isFinite(parsed.pendingSinceMs)) {
        window.localStorage.removeItem(CREATE_JOB_STORAGE_KEY);
        return;
      }
      setCreateJob(parsed);
      setCreating(true);
      setMinTurnoverUsd(String(parsed.minTurnoverUsd));
      setMinVolPct(String(parsed.minVolatilityPct));
    } catch {
      window.localStorage.removeItem(CREATE_JOB_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!createJob) return;
    let active = true;
    const checkDone = () => {
      void (async () => {
        try {
          const res = await listUniverses();
          if (!active) return;
          setItems(res.universes ?? []);
          const matched = (res.universes ?? []).find(
            (u) => u.minTurnoverUsd === createJob.minTurnoverUsd
              && u.minVolatilityPct === createJob.minVolatilityPct
              && Number(u.updatedAt) >= createJob.pendingSinceMs,
          );
          if (matched) {
            setLastCreated(matched);
            setCreateJob(null);
            setCreating(false);
            persistCreateJob(null);
          }
        } catch {
        }
      })();
    };
    checkDone();
    const timer = window.setInterval(checkDone, 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [createJob, persistCreateJob]);

  useEffect(() => {
    if (!createJob) return;
    const timer = window.setInterval(() => {
      setCreateProgressNowMs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [createJob]);

  const canCreate = useMemo(() => !creating, [creating]);
  const savedIdsKey = useMemo(() => items.map((item) => item.id).join("|"), [items]);
  const savedTotalPages = Math.max(1, Math.ceil(items.length / savedPageSize));
  const savedPageClamped = Math.max(1, Math.min(savedPage, savedTotalPages));
  const savedStart = (savedPageClamped - 1) * savedPageSize;
  const pagedItems = items.slice(savedStart, savedStart + savedPageSize);

  useEffect(() => {
    setSavedPage(1);
  }, [savedIdsKey, savedPageSize]);

  useEffect(() => {
    if (savedPage !== savedPageClamped) setSavedPage(savedPageClamped);
  }, [savedPage, savedPageClamped]);

  useEffect(() => {
    setAvailablePage(1);
  }, [availablePageSize, metricsRange]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(availableRows.length / availablePageSize));
    const clamped = Math.max(1, Math.min(availablePage, totalPages));
    if (availablePage !== clamped) setAvailablePage(clamped);
  }, [availablePage, availablePageSize, availableRows.length]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    setLastCreated(null);
    setStats(null);
    try {
      const parsedTurnover = Number(minTurnoverUsd);
      const parsedVol = Number(minVolPct);
      if (minTurnoverUsd.trim() === "" || minVolPct.trim() === "" || !Number.isFinite(parsedTurnover) || !Number.isFinite(parsedVol)) {
        setError("Both numeric fields are required.");
        return;
      }
      if (parsedTurnover < 0 || parsedVol < 0) {
        setError("Numeric fields must be non-negative.");
        return;
      }
      const nextJob: UniverseCreateJobState = {
        status: "running",
        minTurnoverUsd: parsedTurnover,
        minVolatilityPct: parsedVol,
        pendingSinceMs: Date.now(),
      };
      setCreateJob(nextJob);
      persistCreateJob(nextJob);
      createAbortRef.current?.abort();
      createAbortRef.current = new AbortController();
      const filteredSymbols = availableRows
        .filter((row) => row.avgTurnoverUsd24h >= parsedTurnover && row.avgVolatilityPct >= parsedVol)
        .map((row) => row.symbol);
      const res = await createUniverse(parsedTurnover, parsedVol, metricsRange, filteredSymbols, createAbortRef.current.signal);
      setLastCreated(res.universe.meta);
      setStats(res.stats);
      await refresh();
      setCreateJob(null);
      persistCreateJob(null);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return;
      }
      setError(String(e?.message ?? e));
      setCreateJob(null);
      persistCreateJob(null);
    } finally {
      setCreating(false);
      createAbortRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      createAbortRef.current?.abort();
    };
  }, []);

  const createProgress = useMemo(() => {
    if (!createJob) return 0;
    const elapsed = Math.max(0, createProgressNowMs - createJob.pendingSinceMs);
    const pct = Math.min(95, (elapsed / 1000) * 8);
    return pct;
  }, [createJob, createProgressNowMs]);

  async function onToggleSymbols(id: string) {
    if (expandedUniverseId === id) {
      setExpandedUniverseId(null);
      setExpandedError(null);
      return;
    }
    setExpandedUniverseId(id);
    setExpandedError(null);
    if (expandedById[id] && summaryById[id]) return;
    setExpandedLoading(true);
    try {
      const uni = await readUniverse(id);
      setExpandedById((prev) => ({ ...prev, [id]: uni }));
      const effectiveRange = (uni.meta.metricsRange ?? "24h") as UniverseMetricsRange;
      const summary = await readUniverseSymbolSummary(id, effectiveRange);
      setSummaryById((prev) => ({ ...prev, [id]: summary.rows ?? [] }));
    } catch (e: any) {
      setExpandedError(String(e?.message ?? e));
    } finally {
      setExpandedLoading(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await deleteUniverse(id);
      await refresh();
      if (expandedUniverseId === id) {
        setExpandedUniverseId(null);
        setExpandedError(null);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  function toggleSummarySort(universeId: string, key: SymbolSummarySortKey) {
    setSummarySortById((prev) => {
      const current = prev[universeId];
      const nextDir: SymbolSummarySortDir = current?.key === key && current.dir === "asc" ? "desc" : "asc";
      return { ...prev, [universeId]: { key, dir: nextDir } };
    });
  }

  function sortSummaryRows(universeId: string, rows: UniverseSymbolSummaryRow[]): UniverseSymbolSummaryRow[] {
    const sort = summarySortById[universeId] ?? { key: "index" as SymbolSummarySortKey, dir: "asc" as SymbolSummarySortDir };
    const sign = sort.dir === "asc" ? 1 : -1;
    return rows
      .map((row, idx) => ({ row, idx }))
      .sort((a, b) => {
        if (sort.key === "index") return sign * (a.idx - b.idx);
        if (sort.key === "symbol") return sign * a.row.symbol.localeCompare(b.row.symbol);
        if (sort.key === "high") return sign * compareNullableNumber(a.row.high, b.row.high);
        if (sort.key === "low") return sign * compareNullableNumber(a.row.low, b.row.low);
        if (sort.key === "openInterestValue") return sign * compareNullableNumber(a.row.openInterestValue, b.row.openInterestValue);
        if (sort.key === "priceChangePct") return sign * compareNullableNumber(a.row.priceChangePct, b.row.priceChangePct);
        return sign * compareNullableNumber(a.row.openInterestChangePct, b.row.openInterestChangePct);
      })
      .map((x) => x.row);
  }

  function sortMarker(universeId: string, key: SymbolSummarySortKey): string {
    const sort = summarySortById[universeId];
    if (!sort || sort.key !== key) return "";
    return sort.dir === "asc" ? " ▲" : " ▼";
  }

  const availableRowsSorted = useMemo(() => {
    const sign = availableSort.dir === "asc" ? 1 : -1;
    return [...availableRows].sort((a, b) => {
      if (availableSort.key === "symbol") return sign * a.symbol.localeCompare(b.symbol);
      if (availableSort.key === "volatility") return sign * ((a.avgVolatilityPct ?? 0) - (b.avgVolatilityPct ?? 0));
      return sign * ((a.avgTurnoverUsd24h ?? 0) - (b.avgTurnoverUsd24h ?? 0));
    });
  }, [availableRows, availableSort]);

  const availableTotalPages = Math.max(1, Math.ceil(availableRowsSorted.length / availablePageSize));
  const availablePageClamped = Math.max(1, Math.min(availablePage, availableTotalPages));
  const availableStart = (availablePageClamped - 1) * availablePageSize;
  const availablePageRows = availableRowsSorted.slice(availableStart, availableStart + availablePageSize);

  function toggleAvailableSort(key: AvailableSortKey) {
    setAvailableSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  }

  function availableSortMarker(key: AvailableSortKey): string {
    if (availableSort.key !== key) return "";
    return availableSort.dir === "asc" ? " ▲" : " ▼";
  }

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
        <Card className="mb-3">
          <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
            <b>Universe Builder</b>
            <span style={{ opacity: 0.75, fontSize: 12 }}>
              Builds a one-off universe from Bybit tickers and saves it.
            </span>
          </Card.Header>

          <Card.Body>
            {error ? <div style={{ color: "#b00020", marginBottom: 8 }}>{error}</div> : null}

            <Form className="mb-3">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr)) auto",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <Form.Group style={{ minWidth: 0 }}>
                  <Form.Label>Min average turnover (USD)</Form.Label>
                  <Form.Control
                    type="number"
                    value={minTurnoverUsd}
                    onChange={(e) => setMinTurnoverUsd(e.currentTarget.value)}
                    min={0}
                  />
                  <Form.Text muted>Threshold for average turnover across the selected period.</Form.Text>
                </Form.Group>

                <Form.Group style={{ minWidth: 0 }}>
                  <Form.Label>Min average volatility (%)</Form.Label>
                  <Form.Control
                    type="number"
                    value={minVolPct}
                    onChange={(e) => setMinVolPct(e.currentTarget.value)}
                    min={0}
                  />
                  <Form.Text muted>Threshold for average volatility across the selected period.</Form.Text>
                </Form.Group>

                <Form.Group style={{ minWidth: 0 }}>
                  <Form.Label>Range</Form.Label>
                  <Form.Select
                    value={metricsRange}
                    onChange={(e) => setMetricsRange(e.currentTarget.value as UniverseMetricsRange)}
                    disabled={rangeSwitchInProgress || availableLoading}
                  >
                    {RANGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Form.Select>
                  <Form.Text muted>Window used to calculate the average metrics.</Form.Text>
                </Form.Group>

                <Form.Group style={{ minWidth: 0, paddingTop: 31 }}>
                  <Button variant="primary" onClick={() => void onCreate()} disabled={!canCreate || creating}>
                    {creating ? <Spinner animation="border" size="sm" /> : "Create"}
                  </Button>
                </Form.Group>
              </div>
            </Form>

            <div style={{ marginBottom: 10, minHeight: 44 }}>
              <CenteredProgressBar
                now={createJob ? createProgress : creating ? 99 : 0}
                showPercent={Boolean(createJob || creating)}
                label={createJob || creating ? undefined : "0%"}
              />
            </div>

            {lastCreated ? (
              <div className="d-flex align-items-center gap-2 flex-wrap mb-2" style={{ fontSize: 12 }}>
                <Badge bg="success">Saved</Badge>
                <span><b>{lastCreated.name}</b></span>
                <span>count: {lastCreated.count}</span>
                {stats ? (
                  <span style={{ opacity: 0.75 }}>
                    seeded for check: {stats.seededSymbols} | subscribed: {stats.subscribedSymbols} | received: {stats.receivedSymbols} | collect time, ms: {stats.collectMs}
                  </span>
                ) : null}
              </div>
            ) : null}

            <h6 className="mb-2">Saved universes</h6>
            {loading ? (
              <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
                <Spinner animation="border" size="sm" /> loading...
              </div>
            ) : !items.length ? (
              <div style={{ opacity: 0.75 }}>No universes yet. Click Create.</div>
            ) : (
              <>
                <Table striped bordered hover size="sm" style={{ tableLayout: "fixed", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "32%", fontSize: 12 }}>Name</th>
                      <th style={{ width: "8%", fontSize: 12 }}>Count</th>
                      <th style={{ width: "14%", fontSize: 12 }}>Min turnover</th>
                      <th style={{ width: "10%", fontSize: 12 }}>Min vol</th>
                      <th style={{ width: "8%", fontSize: 12 }}>Range</th>
                      <th style={{ width: "14%", fontSize: 12 }}>Updated</th>
                      <th style={{ width: "14%", fontSize: 12 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((u) => {
                      const summaryRows = summaryById[u.id] ?? [];
                      const sortedSummaryRows = sortSummaryRows(u.id, summaryRows);
                      return (
                        <Fragment key={u.id}>
                          <tr key={u.id}>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</td>
                            <td style={{ fontSize: 12 }}>{u.count}</td>
                            <td style={{ fontSize: 12 }}>{fmtNum(u.minTurnoverUsd)}</td>
                            <td style={{ fontSize: 12 }}>{fmtNum(u.minVolatilityPct)}%</td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{u.metricsRange ?? "24h"}</td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtTime(u.updatedAt)}</td>
                            <td style={{ fontSize: 12 }}>
                              <div className="d-flex align-items-center gap-2">
                                <Button size="sm" variant="outline-secondary" onClick={() => void onToggleSymbols(u.id)}>
                                  {expandedUniverseId === u.id ? "Hide symbols" : "View symbols"}
                                </Button>
                                <Button size="sm" variant="outline-danger" onClick={() => void onDelete(u.id)}>
                                  Delete
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {expandedUniverseId === u.id ? (
                            <tr key={`${u.id}-expanded`}>
                              <td colSpan={7} style={{ background: "#262b33" }}>
                                {expandedLoading && !summaryById[u.id] ? (
                                  <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
                                    <Spinner animation="border" size="sm" /> Loading symbols...
                                  </div>
                                ) : expandedError ? (
                                  <div style={{ color: "#b00020", fontSize: 12 }}>{expandedError}</div>
                                ) : (
                                  <>
                                    <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8 }}>
                                      Symbols summary: {summaryRows.length}
                                    </div>
                                    <Table bordered size="sm" className="mb-0">
                                      <thead>
                                        <tr>
                                          <th style={{ width: 60, cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "index")}>#{sortMarker(u.id, "index")}</th>
                                          <th style={{ cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "symbol")}>Symbol{sortMarker(u.id, "symbol")}</th>
                                          <th style={{ cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "high")}>High{sortMarker(u.id, "high")}</th>
                                          <th style={{ cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "low")}>Low{sortMarker(u.id, "low")}</th>
                                          <th style={{ cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "openInterestValue")}>OI value{sortMarker(u.id, "openInterestValue")}</th>
                                          <th style={{ cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "priceChangePct")}>Price change{sortMarker(u.id, "priceChangePct")}</th>
                                          <th style={{ cursor: "pointer" }} onClick={() => toggleSummarySort(u.id, "openInterestChangePct")}>OI change{sortMarker(u.id, "openInterestChangePct")}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sortedSummaryRows.map((row, idx) => (
                                          <tr key={`${u.id}-${row.symbol}-${idx}`}>
                                            <td>{idx + 1}</td>
                                            <td>{row.symbol}</td>
                                            <td>{row.high == null ? "-" : fmtNum(row.high)}</td>
                                            <td>{row.low == null ? "-" : fmtNum(row.low)}</td>
                                            <td>{row.openInterestValue == null ? "-" : fmtNum(row.openInterestValue)}</td>
                                            <td style={row.priceChangePct == null ? undefined : { color: row.priceChangePct > 0 ? "#1f7a1f" : row.priceChangePct < 0 ? "#b00020" : "#6c757d" }}>
                                              {row.priceChangePct == null ? "-" : `${row.priceChangePct.toFixed(2)}%`}
                                            </td>
                                            <td style={row.openInterestChangePct == null ? undefined : { color: row.openInterestChangePct > 0 ? "#1f7a1f" : row.openInterestChangePct < 0 ? "#b00020" : "#6c757d" }}>
                                              {row.openInterestChangePct == null ? "-" : `${row.openInterestChangePct.toFixed(2)}%`}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </Table>
                                  </>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>

                <TablePaginationControls
                  tableId="universe-saved"
                  page={savedPageClamped}
                  totalRows={items.length}
                  pageSize={savedPageSize}
                  onPageChange={setSavedPage}
                  onPageSizeChange={(size) => {
                    setSavedPageSize(size);
                    setSavedPage(1);
                  }}
                />
              </>
            )}

            <h6 className="mt-4 mb-2">Available symbols</h6>
            <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: 12, opacity: 0.85 }}>
              <span>Range: {RANGE_OPTIONS.find((x) => x.value === metricsRange)?.label ?? metricsRange}</span>
              <span>updated: {availableUpdatedAtMs ? fmtTime(availableUpdatedAtMs) : "-"}</span>
            </div>
            {(rangeSwitchInProgress || availableLoading) ? (
              <div style={{ marginBottom: 10 }}>
                <CenteredProgressBar
                  now={rangeSwitchInProgress ? rangeLoadProgress : 60}
                  showPercent
                />
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  Loading symbols for selected range...
                </div>
              </div>
            ) : null}
            {availableError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{availableError}</div> : null}
            {availableLoading && availableRows.length === 0 ? (
              <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
                <Spinner animation="border" size="sm" /> loading symbols...
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <Table striped bordered hover size="sm" className="mb-0" style={{ tableLayout: "fixed", minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{ width: "64px" }}>#</th>
                        <th style={{ width: "42%", cursor: "pointer" }} onClick={() => toggleAvailableSort("symbol")}>
                          Symbol{availableSortMarker("symbol")}
                        </th>
                        <th style={{ width: "29%", cursor: "pointer" }} onClick={() => toggleAvailableSort("turnover")}>
                          Turnover ({RANGE_OPTIONS.find((x) => x.value === metricsRange)?.label ?? metricsRange}){availableSortMarker("turnover")}
                        </th>
                        <th style={{ width: "29%", cursor: "pointer" }} onClick={() => toggleAvailableSort("volatility")}>
                          Volatility ({RANGE_OPTIONS.find((x) => x.value === metricsRange)?.label ?? metricsRange}){availableSortMarker("volatility")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {availablePageRows.map((row, index) => (
                        <tr key={row.symbol}>
                          <td>{availableStart + index + 1}</td>
                          <td>{row.symbol}</td>
                          <td>{fmtNum(row.avgTurnoverUsd24h)}</td>
                          <td>{(row.avgVolatilityPct ?? 0).toFixed(2)}%</td>
                        </tr>
                      ))}
                      {!availablePageRows.length ? (
                        <tr>
                          <td colSpan={4} style={{ opacity: 0.8 }}>No symbols available.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </Table>
                </div>
                <TablePaginationControls
                  tableId="universe-available"
                  page={availablePageClamped}
                  totalRows={availableRowsSorted.length}
                  pageSize={availablePageSize}
                  onPageChange={setAvailablePage}
                  onPageSizeChange={(size) => {
                    setAvailablePageSize(size);
                    setAvailablePage(1);
                  }}
                />
              </>
            )}
          </Card.Body>
        </Card>
      </Container>
    </>
  );
}

