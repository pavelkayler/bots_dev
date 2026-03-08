import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import { CONFIG } from "../config.js";
import { BybitWsClient } from "../bybit/BybitWsClient.js";
import { BybitMarketCache } from "../engine/BybitMarketCache.js";
import { CandleTracker } from "../engine/CandleTracker.js";
import { FundingCooldownGate } from "../engine/FundingCooldownGate.js";
import { SignalEngine, type SignalSide } from "../engine/SignalEngine.js";
import { runtime } from "../runtime/runtime.js";
import type { LogEvent } from "../logging/EventLogger.js";
import { configStore, type RuntimeConfig } from "../runtime/configStore.js";
import { LiveUpdateAggregator } from "./liveUpdateAggregator.js";
import { cvdRecorder, minuteOiRecorder } from "../recorder/recorderStore.js";
import { resolveRecorderSymbols } from "../recorder/recorderUniverseStore.js";
import { SIGNAL_BOT_ID } from "../bots/registry.js";

type AwaitAllStreamsConnectedArgs = {
  timeoutMs: number;
  signal?: AbortSignal;
};

type AwaitStreamsProvider = (args: AwaitAllStreamsConnectedArgs) => Promise<void>;

let awaitStreamsProvider: AwaitStreamsProvider | null = null;
let streamLifecycleSyncProvider: (() => void) | null = null;

export async function awaitAllStreamsConnected(args: AwaitAllStreamsConnectedArgs): Promise<void> {
  if (!awaitStreamsProvider) {
    throw new Error("ws_hub_not_ready");
  }
  return await awaitStreamsProvider(args);
}

export function requestStreamLifecycleSync() {
  streamLifecycleSyncProvider?.();
}

type SymbolRowBase = {
  symbol: string;
  markPrice: number;
  openInterestValue: number;
  fundingRate: number;
  nextFundingTime: number;
  fundingIntervalHour: number | null;
  turnover24hUsd: number | null;
  highPrice24h: number | null;
  lowPrice24h: number | null;
  updatedAt: number;

  prevCandleClose: number | null;
  prevCandleOivClose: number | null;
  candleConfirmedAt: number | null;
  priceMovePct: number | null;
  oivMovePct: number | null;

  cooldownActive: boolean;
  cooldownWindowStartMs: number | null;
  cooldownWindowEndMs: number | null;

  signal: SignalSide | null;
  signalReason: string;
};

type SymbolRow = SymbolRowBase & ReturnType<typeof runtime.getPaperView>;

type StreamsState = {
  streamsEnabled: boolean;
  bybitConnected: boolean;
};

type BotStats = ReturnType<typeof runtime.getBotStats> & {
  unrealizedPnl: number;
};

type ServerWsMessage =
  | { type: "hello"; serverTime: number }
  | { type: "snapshot"; payload: { sessionState: string; sessionId: string | null; runningSinceMs: number | null; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number; optimizer?: OptimizerSnapshot } & StreamsState }
  | { type: "tick"; payload: { serverTime: number; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number } }
  | { type: "streams_state"; payload: StreamsState }
  | { type: "events_tail"; payload: { limit: number; count: number; events: LogEvent[] } }
  | { type: "events_append"; payload: { event: LogEvent } }
  | { type: "optimizer_rows_append"; payload: { jobId: string; rows: any[] } }
  | { type: "error"; message: string };

type OptimizerSnapshot = {
  jobId: string | null;
  rows: any[];
};

let optimizerSnapshotProvider: (() => OptimizerSnapshot) | null = null;
const optimizerWsClients = new Set<WebSocket>();

export function setOptimizerSnapshotProvider(provider: (() => OptimizerSnapshot) | null) {
  optimizerSnapshotProvider = provider;
}

export function broadcastOptimizerRowsAppend(jobId: string, rows: any[]) {
  if (!jobId || !Array.isArray(rows) || rows.length === 0) return;
  const msg: ServerWsMessage = { type: "optimizer_rows_append", payload: { jobId, rows } };
  for (const client of optimizerWsClients) safeSend(client, msg);
}

type ClientWsMessage =
  | { type: "events_tail_request"; payload: { limit: number } }
  | { type: "rows_refresh_request"; payload?: { mode?: "tick" | "snapshot" } }
  | { type: "streams_toggle_request" }
  | { type: "streams_apply_subscriptions_request" };

function nowMs() {
  return Date.now();
}

function getUniverseInfo() {
  const cfg = configStore.get();
  const id = String((cfg as any)?.universe?.selectedId ?? "");
  const symbols = Array.isArray((cfg as any)?.universe?.symbols) ? (cfg as any).universe.symbols : [];
  return { universeSelectedId: id, universeSymbolsCount: symbols.length };
}

function getOptimizerSnapshot(): OptimizerSnapshot {
  try {
    const snapshot = optimizerSnapshotProvider?.();
    if (!snapshot) return { jobId: null, rows: [] };
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    return {
      jobId: snapshot.jobId ? String(snapshot.jobId) : null,
      rows,
    };
  } catch {
    return { jobId: null, rows: [] };
  }
}

function safeSend(ws: WebSocket, msg: ServerWsMessage) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

function safeParseClientMsg(raw: string): ClientWsMessage | null {
  try {
    const obj = JSON.parse(raw);

    if (obj?.type === "events_tail_request" && typeof obj?.payload?.limit !== "undefined") {
      const limit = Number(obj.payload.limit);
      if (Number.isFinite(limit)) return { type: "events_tail_request", payload: { limit } };
      return null;
    }

    if (obj?.type === "rows_refresh_request") {
      const modeRaw = obj?.payload?.mode;
      const mode = modeRaw === "snapshot" ? "snapshot" : "tick";
      return { type: "rows_refresh_request", payload: { mode } };
    }

    if (obj?.type === "streams_toggle_request") {
      return { type: "streams_toggle_request" };
    }

    if (obj?.type === "streams_apply_subscriptions_request") {
      return { type: "streams_apply_subscriptions_request" };
    }

    return null;
  } catch {
    return null;
  }
}

function chunkTopicsByCharLimit(topics: string[], maxChars = 18_000): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;

  for (const t of topics) {
    const addLen = (cur.length === 0 ? 0 : 1) + t.length;
    if (cur.length > 0 && curLen + addLen > maxChars) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(t);
    curLen += addLen;
  }

  if (cur.length) chunks.push(cur);
  return chunks;
}

function normalizeSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    const symbol = String(item ?? "").trim();
    if (symbol) unique.add(symbol);
  }
  return Array.from(unique);
}

function buildBybitTopics(cfg: RuntimeConfig, symbols: string[]): string[] {
  const topics: string[] = [];
  const tf = cfg.universe.klineTfMin;
  const includePublicTrade = cfg.selectedBotId === "signal-multi-factor-v1"
    || minuteOiRecorder.getStatus().mode !== "off"
    || cvdRecorder.getStatus().mode !== "off";
  for (const s of symbols) {
    topics.push(`tickers.${s}`);
    topics.push(`kline.${tf}.${s}`);
    if (includePublicTrade) topics.push(`publicTrade.${s}`);
  }
  return topics;
}

function parseKlineSymbol(topic: string): string | null {
  const parts = topic.split(".");
  if (parts.length < 3) return null;
  return parts[2] ?? null;
}


function toMskDayKey(ts: number): string {
  const shifted = ts + 3 * 60 * 60 * 1000;
  return new Date(shifted).toISOString().slice(0, 10);
}

type DailyGateState = {
  currentDayKey: string;
  dailyTriggerCount: number;
  lastTriggeredCandleId: number | null;
};

function pctChange(now: number, ref: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(ref) || ref === 0) return null;
  return ((now - ref) / ref) * 100;
}

function finiteOr<T extends number | null>(value: T | undefined, fallback: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function toSignalEngineConfig(cfg: RuntimeConfig) {
  const signalsAny = cfg.signals as Record<string, unknown>;
  const isSignalBot = cfg.selectedBotId === SIGNAL_BOT_ID;
  return {
    priceMovePct: Number(
      isSignalBot
        ? (signalsAny.priceMovePct ?? CONFIG.signals.priceThresholdPct)
        : (signalsAny.priceThresholdPct ?? CONFIG.signals.priceThresholdPct),
    ),
    oiMovePct: Number(
      isSignalBot
        ? (signalsAny.oiMovePct ?? CONFIG.signals.oivThresholdPct)
        : (signalsAny.oivThresholdPct ?? CONFIG.signals.oivThresholdPct),
    ),
    requireFundingSign: Boolean(
      isSignalBot
        ? (signalsAny.requireFundingExtreme ?? true)
        : (signalsAny.requireFundingSign ?? true),
    ),
    cvdMoveThreshold: Number(isSignalBot ? (signalsAny.cvdMoveThreshold ?? 0) : 0),
    requireCvdDivergence: Boolean(isSignalBot ? (signalsAny.requireCvdDivergence ?? false) : false),
    requireFundingExtreme: Boolean(isSignalBot ? (signalsAny.requireFundingExtreme ?? false) : false),
    fundingMinAbsPct: Number(isSignalBot ? (signalsAny.fundingMinAbsPct ?? 0) : 0),
    directionMode: cfg.paper.directionMode,
    model: isSignalBot ? "signal-multi-factor-v1" : "oi-momentum-v1",
  } as const;
}

function readTriggerBounds(cfg: RuntimeConfig): { min: number; max: number } {
  const s = cfg.signals as Record<string, unknown>;
  if (cfg.selectedBotId === SIGNAL_BOT_ID) {
    const min = Math.max(1, Math.floor(Number(s.minTriggersPerDay ?? 1)));
    const max = Math.max(min, Math.floor(Number(s.maxTriggersPerDay ?? min)));
    return { min, max };
  }
  const min = Math.max(1, Math.floor(Number(s.dailyTriggerMin ?? 1)));
  const max = Math.max(min, Math.floor(Number(s.dailyTriggerMax ?? min)));
  return { min, max };
}

function readMinBarsBetweenSignals(cfg: RuntimeConfig): number {
  if (cfg.selectedBotId !== SIGNAL_BOT_ID) return 0;
  const s = cfg.signals as Record<string, unknown>;
  return Math.max(0, Math.floor(Number(s.minBarsBetweenSignals ?? 0)));
}

function readJsonlTail(filePath: string, limit: number): LogEvent[] {
  const max = Math.max(1, Math.min(100, Math.floor(limit)));
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const tail = lines.slice(Math.max(0, lines.length - max));
  const out: LogEvent[] = [];

  for (const line of tail) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore
    }
  }
  return out;
}

export function createWsHub(app: FastifyInstance) {
  const clients = new Set<WebSocket>();
  const clientEventsLimit = new Map<WebSocket, number>();

  const cache = new BybitMarketCache();
  const candles = new CandleTracker(cache);

  // dynamic engines from configStore
  let lastKey = "";
  let fundingGate = new FundingCooldownGate(CONFIG.fundingCooldown.beforeMin, CONFIG.fundingCooldown.afterMin);
  let signals = new SignalEngine(toSignalEngineConfig(configStore.get()));

  function ensureEngines() {
    const cfg = configStore.get();
    const key = JSON.stringify({ f: cfg.fundingCooldown, s: cfg.signals, p: { directionMode: cfg.paper.directionMode } });

    if (key !== lastKey) {
      lastKey = key;
      fundingGate = new FundingCooldownGate(cfg.fundingCooldown.beforeMin, cfg.fundingCooldown.afterMin);
      signals = new SignalEngine(toSignalEngineConfig(cfg));
      app.log.info(
        { cfg: { fundingCooldown: cfg.fundingCooldown, signals: cfg.signals, paper: { directionMode: cfg.paper.directionMode } } },
        "runtime config applied (wsHub)"
      );
    }
  }

  runtime.attachMarkPriceProvider((symbol) => cache.getMarkPrice(symbol));

  let wss: WebSocketServer | null = null;
  const liveUpdateAggregator = new LiveUpdateAggregator({
    flushIntervalMs: 100,
    maxKeys: 5_000,
    onFlush: () => {
      if (!rowsAllowed()) return;
      const now = nowMs();
      const rows = attachPaper(computeBaseRows(now), now);
      const msg: ServerWsMessage = { type: "tick", payload: { serverTime: now, rows, botStats: computeBotStats(rows), ...getUniverseInfo() } };
      for (const c of clients) safeSend(c, msg);
    },
    onDropKey: (key, size) => {
      app.log.warn({ key, size }, "live update aggregator capacity reached; dropping new keys");
    },
  });

  // Bybit upstream
  let streamsEnabled = runtime.getStatus().sessionState === "RUNNING";
  let desiredStreams = streamsEnabled;
  let bybitConnected = false;

  let bybit: BybitWsClient | null = null;
  let connectInFlight = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const streamWaiters = new Set<{ resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();

  function resolveStreamWaitersIfReady() {
    if (!(streamsEnabled && bybitConnected)) return;
    for (const waiter of streamWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    streamWaiters.clear();
  }

  function rejectStreamWaiters(message: string) {
    for (const waiter of streamWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    streamWaiters.clear();
  }

  // Universe tracking (auto-apply via reconnect when changed)
  let lastUniverseKey = JSON.stringify(configStore.get().universe);
  let lastSubscriptionKey = "";
  let universeApplyTimer: NodeJS.Timeout | null = null;
  const dailyGateBySymbol = new Map<string, DailyGateState>();
  let lastGateSessionId: string | null = runtime.getStatus().sessionId;

  function resolveSubscribedSymbols(runtimeActive: boolean, recorderMode: "off" | "record_only" | "record_while_running"): string[] {
    const cfg = configStore.get();
    const tradingSymbols = normalizeSymbols(cfg.universe?.symbols ?? []);
    if (recorderMode === "off") return tradingSymbols;
    const recorderSymbols = normalizeSymbols(resolveRecorderSymbols());
    if (recorderMode === "record_only") return recorderSymbols;
    if (!runtimeActive) return recorderSymbols;
    return normalizeSymbols([...tradingSymbols, ...recorderSymbols]);
  }

  function computeSubscriptionKey(runtimeActive: boolean, recorderMode: "off" | "record_only" | "record_while_running"): string {
    const cfg = configStore.get();
    const tf = Math.max(1, Math.floor(Number(cfg.universe?.klineTfMin) || 1));
    const symbols = resolveSubscribedSymbols(runtimeActive, recorderMode);
    return JSON.stringify({
      tf,
      symbols,
      botId: cfg.selectedBotId,
      minuteMode: recorderMode,
      cvdMode: cvdRecorder.getStatus().mode,
    });
  }

  function broadcastStreamsState() {
    const msg: ServerWsMessage = { type: "streams_state", payload: { streamsEnabled, bybitConnected } };
    for (const c of clients) safeSend(c, msg);
  }

  function rowsAllowed() {
    const st = runtime.getStatus();
    return st.sessionState === "RUNNING";
  }

  function computeBaseRows(now: number): SymbolRowBase[] {
    ensureEngines();

    const cfg = configStore.get();
    const triggerBounds = readTriggerBounds(cfg);
    const symbols = Array.isArray(cfg.universe?.symbols) ? cfg.universe.symbols : [];
    const sessionId = runtime.getStatus().sessionId;
    if (sessionId !== lastGateSessionId) {
      dailyGateBySymbol.clear();
      lastGateSessionId = sessionId;
    }

    const out: SymbolRowBase[] = [];

    for (const symbol of symbols) {
      const raw = cache.getRawRow(symbol);

      const markPrice = finiteOr(raw?.markPrice, 0) ?? 0;
      const openInterestValue = finiteOr(raw?.openInterestValue, 0) ?? 0;
      const fundingRate = finiteOr(raw?.fundingRate, 0) ?? 0;
      const nextFundingTime = finiteOr(raw?.nextFundingTime, 0) ?? 0;
      const fundingIntervalHour = finiteOr(raw?.fundingIntervalHour, null);
      const turnover24hUsd = finiteOr(raw?.turnover24hUsd, null);
      const highPrice24h = finiteOr(raw?.highPrice24h, null);
      const lowPrice24h = finiteOr(raw?.lowPrice24h, null);
      const updatedAt = finiteOr(raw?.updatedAt, 0) ?? 0;

      const refs = candles.getRefs(symbol);

      const priceMovePct =
        refs.prevCandleClose == null || markPrice <= 0 ? null : pctChange(markPrice, refs.prevCandleClose);

      const oivMovePct =
        refs.prevCandleOivClose == null || openInterestValue <= 0
          ? null
          : pctChange(openInterestValue, refs.prevCandleOivClose);
      const cvdFeatures = cvdRecorder.getSignalFeatures(symbol);

      const cooldown = fundingGate.state(nextFundingTime || null, now);
      const cooldownActive = cooldown?.active ?? false;

      const decision = signals.decide({
        priceMovePct,
        oiMovePct: oivMovePct,
        fundingRate,
        cooldownActive,
        cvdDelta: cvdFeatures.cvdDelta,
        cvdImbalanceRatio: cvdFeatures.cvdImbalanceRatio,
        divergencePriceUpCvdDown: cvdFeatures.divergencePriceUpCvdDown,
        divergencePriceDownCvdUp: cvdFeatures.divergencePriceDownCvdUp,
      });

      const tfMs = Math.max(1, Number(cfg.universe.klineTfMin || 1)) * 60_000;
      const candleId = Math.floor(now / tfMs);
      const minBarsBetweenSignals = readMinBarsBetweenSignals(cfg);
      const dayKey = toMskDayKey(now);
      const gateState = dailyGateBySymbol.get(symbol) ?? { currentDayKey: dayKey, dailyTriggerCount: 0, lastTriggeredCandleId: null };
      if (gateState.currentDayKey !== dayKey) {
        gateState.currentDayKey = dayKey;
        gateState.dailyTriggerCount = 0;
        gateState.lastTriggeredCandleId = null;
      }

      let signal = decision.signal;
      let signalReason = signal ? decision.reason : "";
      if (signal) {
        if (minBarsBetweenSignals > 0 && gateState.lastTriggeredCandleId != null) {
          const barsSinceLast = candleId - gateState.lastTriggeredCandleId;
          if (barsSinceLast < minBarsBetweenSignals) {
            signal = null;
            signalReason = "threshold_not_met";
          }
        }
      }
      if (signal) {
        if (gateState.dailyTriggerCount < triggerBounds.min) {
          signal = null;
          signalReason = "daily_gate_before_min";
        } else if (gateState.dailyTriggerCount > triggerBounds.max) {
          signal = null;
          signalReason = "daily_gate_over_max";
        }
      }
      if (signal && gateState.lastTriggeredCandleId !== candleId) {
        gateState.dailyTriggerCount += 1;
        gateState.lastTriggeredCandleId = candleId;
      }
      dailyGateBySymbol.set(symbol, gateState);

      out.push({
        symbol,
        markPrice,
        openInterestValue,
        fundingRate,
        nextFundingTime,
        fundingIntervalHour,
        turnover24hUsd,
        highPrice24h,
        lowPrice24h,
        updatedAt,

        prevCandleClose: refs.prevCandleClose,
        prevCandleOivClose: refs.prevCandleOivClose,
        candleConfirmedAt: refs.confirmedAt,
        priceMovePct,
        oivMovePct,

        cooldownActive,
        cooldownWindowStartMs: cooldown ? cooldown.windowStartMs : null,
        cooldownWindowEndMs: cooldown ? cooldown.windowEndMs : null,

        signal,
        signalReason,
      });
    }

    return out;
  }

  function attachPaper(baseRows: SymbolRowBase[], now: number): SymbolRow[] {
    for (const r of baseRows) {
      if (r.markPrice > 0) {
        runtime.tickPaper({
          symbol: r.symbol,
          nowMs: now,
          markPrice: r.markPrice,
          fundingRate: r.fundingRate,
          nextFundingTime: r.nextFundingTime,
          signal: r.signal,
          signalReason: r.signalReason,
          cooldownActive: r.cooldownActive,
      });
      }
    }

    return baseRows.map((r) => ({
      ...r,
      ...runtime.getPaperView(r.symbol, r.markPrice > 0 ? r.markPrice : null),
    }));
  }

  function computeBotStats(rows: SymbolRow[]): BotStats {
    const base = runtime.getBotStats();
    const unrealizedPnl = rows.reduce((sum, row) => {
      const value = row.paperUnrealizedPnl;
      return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);

    return {
      ...base,
      unrealizedPnl,
    };
  }

  function sendEventsTail(ws: WebSocket, limit: number) {
    const st = runtime.getStatus();
    const file = st.eventsFile;

    let events: LogEvent[] = [];
    if (file) {
      try {
        events = readJsonlTail(file, limit);
      } catch {
        events = [];
      }
    }

    safeSend(ws, {
      type: "events_tail",
      payload: { limit, count: events.length, events },
    });
  }

  function sendRowsToClient(ws: WebSocket, mode: "tick" | "snapshot") {
    const now = nowMs();
    const rows = rowsAllowed() ? attachPaper(computeBaseRows(now), now) : [];

    if (mode === "snapshot") {
      const st = runtime.getStatus();
      safeSend(ws, {
        type: "snapshot",
        payload: { sessionState: st.sessionState, sessionId: st.sessionId, runningSinceMs: st.runningSinceMs, rows, botStats: computeBotStats(rows), streamsEnabled, bybitConnected, ...getUniverseInfo(), optimizer: getOptimizerSnapshot() },
      });
      return;
    }

    safeSend(ws, { type: "tick", payload: { serverTime: now, rows, botStats: computeBotStats(rows), ...getUniverseInfo() } });
  }

  function broadcastSnapshot() {
    const now = nowMs();
    const rows = rowsAllowed() ? attachPaper(computeBaseRows(now), now) : [];
    const st = runtime.getStatus();

    const msg: ServerWsMessage = {
      type: "snapshot",
      payload: { sessionState: st.sessionState, sessionId: st.sessionId, runningSinceMs: st.runningSinceMs, rows, botStats: computeBotStats(rows), streamsEnabled, bybitConnected, ...getUniverseInfo(), optimizer: getOptimizerSnapshot() },
    };

    for (const c of clients) safeSend(c, msg);

    for (const c of clients) {
      const lim = clientEventsLimit.get(c) ?? 5;
      sendEventsTail(c, lim);
    }
  }

  function broadcastEventAppend(ev: LogEvent) {
    const msg: ServerWsMessage = { type: "events_append", payload: { event: ev } };
    for (const c of clients) safeSend(c, msg);
  }

  function startLiveUpdateAggregator() {
    liveUpdateAggregator.start();
  }

  function stopLiveUpdateAggregator() {
    liveUpdateAggregator.stop();
  }

  function syncRuntimeStreamLifecycle() {
    const st = runtime.getStatus();
    const runtimeActive = st.sessionState === "RUNNING" || st.sessionState === "RESUMING";
    const recorderMode = minuteOiRecorder.getStatus().mode;
    const cvdMode = cvdRecorder.getStatus().mode;
    const nextSubscriptionKey = computeSubscriptionKey(runtimeActive, recorderMode);
    const shouldEnableStreams = runtimeActive || recorderMode === "record_only" || cvdMode === "record_only";

    if (shouldEnableStreams) {
      streamsEnabled = true;
      desiredStreams = true;
      if (recorderMode === "record_only") {
        minuteOiRecorder.activate(resolveRecorderSymbols());
      } else if (runtimeActive && recorderMode === "record_while_running") {
        minuteOiRecorder.activate(resolveRecorderSymbols());
      } else {
        minuteOiRecorder.deactivate();
      }
      if (cvdMode === "record_only") {
        cvdRecorder.activate(resolveRecorderSymbols());
      } else if (runtimeActive && cvdMode === "record_while_running") {
        cvdRecorder.activate(resolveRecorderSymbols());
      } else {
        cvdRecorder.deactivate();
      }
      if (bybit && bybitConnected && nextSubscriptionKey !== lastSubscriptionKey) {
        lastSubscriptionKey = nextSubscriptionKey;
        applySubscriptions("stream_target_change");
      } else {
        lastSubscriptionKey = nextSubscriptionKey;
        void startUpstreamIfNeeded();
      }
      if (runtimeActive && st.sessionState === "RUNNING") startLiveUpdateAggregator();
      else stopLiveUpdateAggregator();
      broadcastStreamsState();
      return;
    }

    streamsEnabled = false;
    desiredStreams = false;
    lastSubscriptionKey = "";
    minuteOiRecorder.deactivate();
    cvdRecorder.deactivate();
    stopUpstreamHard();
    stopLiveUpdateAggregator();
    broadcastStreamsState();
  }

  const onRuntimeState = () => {
    syncRuntimeStreamLifecycle();
    broadcastSnapshot();
  };
  const onRuntimeEvent = (ev: LogEvent) => broadcastEventAppend(ev);

  runtime.on("state", onRuntimeState);
  runtime.on("event", onRuntimeEvent);

  function subscribeAll() {
    if (!bybit) return;

    const cfg = configStore.get();
    const st = runtime.getStatus();
    const runtimeActive = st.sessionState === "RUNNING" || st.sessionState === "RESUMING";
    const recorderMode = minuteOiRecorder.getStatus().mode;
    const symbols = resolveSubscribedSymbols(runtimeActive, recorderMode);
    const topics = buildBybitTopics(cfg, symbols);
    const batches = chunkTopicsByCharLimit(topics);
    const cvdStatus = cvdRecorder.getStatus();
    if (cvdStatus.mode !== "off" && symbols.length > 0) {
      void cvdRecorder.bootstrapFromRest(symbols).catch(() => undefined);
    }

    let delay = 0;
    for (const batch of batches) {
      setTimeout(() => {
        app.log.info({ n: batch.length }, "bybit subscribe batch");
        bybit?.subscribe(batch);
      }, delay);
      delay += 250;
    }
  }

  async function startUpstreamIfNeeded() {
    if (!desiredStreams) return;
    if (connectInFlight) return;
    if (bybit) return;

    connectInFlight = true;

    bybit = new BybitWsClient(CONFIG.bybit.wsUrl, {
      onOpen: () => {
        connectInFlight = false;
        bybitConnected = true;
        const st = runtime.getStatus();
        const runtimeActive = st.sessionState === "RUNNING" || st.sessionState === "RESUMING";
        const recorderMode = minuteOiRecorder.getStatus().mode;
        lastSubscriptionKey = computeSubscriptionKey(runtimeActive, recorderMode);
        app.log.info("bybit ws: open");
        broadcastStreamsState();
        resolveStreamWaitersIfReady();
        subscribeAll();
      },
      onClose: () => {
        connectInFlight = false;
        bybit = null;
        bybitConnected = false;
        app.log.warn("bybit ws: close");
        broadcastStreamsState();
        rejectStreamWaiters("streams_disconnected");
        scheduleReconnect();
      },
      onError: (err) => {
        connectInFlight = false;
        app.log.error({ err }, "bybit ws: error");
        rejectStreamWaiters("streams_connection_error");
        scheduleReconnect();
      },
      onTicker: (topic, _type, data) => {
        const symbol = topic.slice("tickers.".length);
        cache.upsertFromTicker(symbol, data);
        liveUpdateAggregator.upsert(`ticker:${symbol}`);
        const row = cache.getRawRow(symbol);
        const openInterestValue = Number(row?.openInterestValue);
        const tickerTsMs = Number((data as any)?.ts);
        minuteOiRecorder.ingestTicker({
          symbol,
          openInterestValue,
          tsMs: Number.isFinite(tickerTsMs) && tickerTsMs > 0 ? tickerTsMs : Date.now(),
        });
      },
      onKline: (topic, _type, data) => {
        const symbol = parseKlineSymbol(topic);
        if (!symbol) return;
        const klineRow = Array.isArray(data) ? data[0] : data;
        if (!klineRow || typeof klineRow !== "object") return;
        const confirmRaw = (klineRow as any)?.confirm;
        const isConfirm = confirmRaw === true || confirmRaw === "true" || confirmRaw === 1 || confirmRaw === "1";
        candles.ingestKline(symbol, klineRow);
        if (isConfirm) {
          liveUpdateAggregator.upsert(`kline:${symbol}`);
        }
      },
      onPublicTrade: (topic, data) => {
        const symbol = topic.slice("publicTrade.".length);
        const side = String((data as any)?.S ?? (data as any)?.side ?? "");
        const price = Number((data as any)?.p ?? (data as any)?.price);
        const size = Number((data as any)?.v ?? (data as any)?.size);
        const tsRaw = Number((data as any)?.T ?? (data as any)?.time);
        if (side !== "Buy" && side !== "Sell") return;
        cvdRecorder.ingestTrade({
          symbol,
          side,
          price,
          size,
          ts: Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : Date.now(),
        });
      },
    });

    try {
      await bybit.connect();
    } catch (err) {
      connectInFlight = false;
      app.log.error({ err }, "bybit ws: connect failed");
      bybit = null;
      rejectStreamWaiters("streams_connect_failed");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!desiredStreams) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;

      if (!desiredStreams) return;

      try {
        bybit?.close();
      } catch {
        // ignore
      }
      bybit = null;

      await startUpstreamIfNeeded();
    }, 2000);
  }

  function stopUpstreamHard() {
    desiredStreams = false;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    connectInFlight = false;

    try {
      bybit?.close();
    } catch {
      // ignore
    }
    bybit = null;

    bybitConnected = false;
    rejectStreamWaiters("streams_stopped");
    broadcastStreamsState();
  }

  awaitStreamsProvider = ({ timeoutMs, signal }: AwaitAllStreamsConnectedArgs) => {
    streamsEnabled = true;
    desiredStreams = true;
    broadcastStreamsState();
    void startUpstreamIfNeeded();

    if (streamsEnabled && bybitConnected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = Math.max(1_000, Math.floor(timeoutMs || 0));
      const waiter = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject: (err: Error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
        timer: setTimeout(() => {
          streamWaiters.delete(waiter);
          waiter.reject(new Error("streams_connect_timeout"));
        }, timeout),
      };
      const onAbort = () => {
        streamWaiters.delete(waiter);
        waiter.reject(new Error("start_cancelled"));
      };
      if (signal?.aborted) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("start_cancelled"));
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      streamWaiters.add(waiter);
      resolveStreamWaitersIfReady();
    });
  };

  streamLifecycleSyncProvider = () => {
    syncRuntimeStreamLifecycle();
    broadcastSnapshot();
  };

  function applySubscriptions(reason: string) {
    if (!streamsEnabled) return;

    app.log.info({ reason, universe: configStore.get().universe }, "apply subscriptions (reconnect bybit)");
    stopUpstreamHard();
    desiredStreams = true;
    void startUpstreamIfNeeded();
  }

  function toggleStreams() {
    streamsEnabled = !streamsEnabled;

    app.log.info({ streamsEnabled }, "streams toggle");

    if (!streamsEnabled) {
      stopUpstreamHard();
      return;
    }

    desiredStreams = true;
    broadcastStreamsState();
    void startUpstreamIfNeeded();
  }

  function onConfigChange(cfg: RuntimeConfig, meta: any) {
    // meta.universeChanged is emitted by ConfigStore.update()
    const key = JSON.stringify(cfg.universe);
    const recorderMode = minuteOiRecorder.getStatus().mode;
    const runtimeState = runtime.getStatus().sessionState;
    const runtimeActive = runtimeState === "RUNNING" || runtimeState === "RESUMING";
    const subscriptionKey = computeSubscriptionKey(runtimeActive, recorderMode);
    const changed = key !== lastUniverseKey || Boolean(meta?.universeChanged) || subscriptionKey !== lastSubscriptionKey;

    if (!changed) return;

    lastUniverseKey = key;
    lastSubscriptionKey = subscriptionKey;

    if (universeApplyTimer) clearTimeout(universeApplyTimer);
    universeApplyTimer = setTimeout(() => {
      universeApplyTimer = null;
      // Reconnect bybit to apply new topic set
      applySubscriptions("config_change");
    }, 250);
  }

  configStore.on("change", onConfigChange);

  app.addHook("onReady", async () => {
    wss = new WebSocketServer({ server: app.server, path: "/ws" });

    wss.on("connection", (ws) => {
      clients.add(ws);
      clientEventsLimit.set(ws, 5);

      const now = nowMs();
      const st = runtime.getStatus();
      const rows = rowsAllowed() ? attachPaper(computeBaseRows(now), now) : [];

      safeSend(ws, { type: "hello", serverTime: now });
      safeSend(ws, {
        type: "snapshot",
        payload: { sessionState: st.sessionState, sessionId: st.sessionId, runningSinceMs: st.runningSinceMs, rows, botStats: computeBotStats(rows), streamsEnabled, bybitConnected, ...getUniverseInfo(), optimizer: getOptimizerSnapshot() },
      });
      safeSend(ws, { type: "streams_state", payload: { streamsEnabled, bybitConnected } });

      sendEventsTail(ws, 5);

      ws.on("message", (buf) => {
        const raw = typeof buf === "string" ? buf : buf.toString("utf8");
        const msg = safeParseClientMsg(raw);
        if (!msg) return;

        if (msg.type === "events_tail_request") {
          const lim = Math.max(1, Math.min(100, Math.floor(msg.payload.limit)));
          clientEventsLimit.set(ws, lim);
          sendEventsTail(ws, lim);
          return;
        }

        if (msg.type === "rows_refresh_request") {
          const mode = msg.payload?.mode === "snapshot" ? "snapshot" : "tick";
          sendRowsToClient(ws, mode);
          return;
        }

        if (msg.type === "streams_toggle_request") {
          toggleStreams();
          return;
        }

        if (msg.type === "streams_apply_subscriptions_request") {
          applySubscriptions("ws_request");
          return;
        }
      });

      ws.on("close", () => {
        clients.delete(ws);
        clientEventsLimit.delete(ws);
        optimizerWsClients.delete(ws);
      });
      ws.on("error", () => {
        clients.delete(ws);
        clientEventsLimit.delete(ws);
        optimizerWsClients.delete(ws);
      });

      optimizerWsClients.add(ws);
    });

    syncRuntimeStreamLifecycle();

    app.log.info("wsHub: /ws ready (dynamic universe via runtime config)");
  });

  app.addHook("onClose", async () => {
    awaitStreamsProvider = null;
    streamLifecycleSyncProvider = null;
    runtime.off("state", onRuntimeState);
    runtime.off("event", onRuntimeEvent);

    configStore.off("change", onConfigChange);

    if (universeApplyTimer) clearTimeout(universeApplyTimer);
    universeApplyTimer = null;

    stopLiveUpdateAggregator();

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;

    connectInFlight = false;

    try {
      bybit?.close();
    } catch {
      // ignore
    }
    bybit = null;

    bybitConnected = false;

    if (wss) {
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
      wss = null;
    }
  });
}
