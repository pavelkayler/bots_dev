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

type SymbolRowBase = {
  symbol: string;
  markPrice: number;
  openInterestValue: number;
  fundingRate: number;
  nextFundingTime: number;
  fundingIntervalHour: number | null;
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
  | { type: "snapshot"; payload: { sessionState: string; sessionId: string | null; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number } & StreamsState }
  | { type: "tick"; payload: { serverTime: number; rows: SymbolRow[]; botStats: BotStats; universeSelectedId: string; universeSymbolsCount: number } }
  | { type: "streams_state"; payload: StreamsState }
  | { type: "events_tail"; payload: { limit: number; count: number; events: LogEvent[] } }
  | { type: "events_append"; payload: { event: LogEvent } }
  | { type: "error"; message: string };

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

function buildBybitTopics(cfg: RuntimeConfig): string[] {
  const topics: string[] = [];
  const tf = cfg.universe.klineTfMin;
  for (const s of cfg.universe.symbols) {
    topics.push(`tickers.${s}`);
    topics.push(`kline.${tf}.${s}`);
  }
  return topics;
}

function parseKlineSymbol(topic: string): string | null {
  const parts = topic.split(".");
  if (parts.length < 3) return null;
  return parts[2] ?? null;
}

function pctChange(now: number, ref: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(ref) || ref === 0) return null;
  return ((now - ref) / ref) * 100;
}

function finiteOr<T extends number | null>(value: T | undefined, fallback: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
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
  let signals = new SignalEngine({
    priceThresholdPct: CONFIG.signals.priceThresholdPct,
    oivThresholdPct: CONFIG.signals.oivThresholdPct,
    requireFundingSign: CONFIG.signals.requireFundingSign,
    directionMode: CONFIG.paper.directionMode,
  });

  function ensureEngines() {
    const cfg = configStore.get();
    const key = JSON.stringify({ f: cfg.fundingCooldown, s: cfg.signals, p: { directionMode: cfg.paper.directionMode } });

    if (key !== lastKey) {
      lastKey = key;
      fundingGate = new FundingCooldownGate(cfg.fundingCooldown.beforeMin, cfg.fundingCooldown.afterMin);
      signals = new SignalEngine({
        priceThresholdPct: cfg.signals.priceThresholdPct,
        oivThresholdPct: cfg.signals.oivThresholdPct,
        requireFundingSign: cfg.signals.requireFundingSign,
        directionMode: cfg.paper.directionMode,
      });
      app.log.info(
        { cfg: { fundingCooldown: cfg.fundingCooldown, signals: cfg.signals, paper: { directionMode: cfg.paper.directionMode } } },
        "runtime config applied (wsHub)"
      );
    }
  }

  runtime.attachMarkPriceProvider((symbol) => cache.getMarkPrice(symbol));

  let wss: WebSocketServer | null = null;
  let tickTimer: NodeJS.Timeout | null = null;

  // Bybit upstream
  let streamsEnabled = runtime.getStatus().sessionState === "RUNNING";
  let desiredStreams = streamsEnabled;
  let bybitConnected = false;

  let bybit: BybitWsClient | null = null;
  let connectInFlight = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  // Universe tracking (auto-apply via reconnect when changed)
  let lastUniverseKey = JSON.stringify(configStore.get().universe);
  let universeApplyTimer: NodeJS.Timeout | null = null;

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
    const symbols = Array.isArray(cfg.universe?.symbols) ? cfg.universe.symbols : [];

    const out: SymbolRowBase[] = [];

    for (const symbol of symbols) {
      const raw = cache.getRawRow(symbol);

      const markPrice = finiteOr(raw?.markPrice, 0) ?? 0;
      const openInterestValue = finiteOr(raw?.openInterestValue, 0) ?? 0;
      const fundingRate = finiteOr(raw?.fundingRate, 0) ?? 0;
      const nextFundingTime = finiteOr(raw?.nextFundingTime, 0) ?? 0;
      const fundingIntervalHour = finiteOr(raw?.fundingIntervalHour, null);
      const updatedAt = finiteOr(raw?.updatedAt, 0) ?? 0;

      const refs = candles.getRefs(symbol);

      const priceMovePct =
        refs.prevCandleClose == null || markPrice <= 0 ? null : pctChange(markPrice, refs.prevCandleClose);

      const oivMovePct =
        refs.prevCandleOivClose == null || openInterestValue <= 0
          ? null
          : pctChange(openInterestValue, refs.prevCandleOivClose);

      const cooldown = fundingGate.state(nextFundingTime || null, now);
      const cooldownActive = cooldown?.active ?? false;

      const decision = signals.decide({
        priceMovePct,
        oivMovePct,
        fundingRate,
        cooldownActive,
      });

      const signal = decision.signal;
      const signalReason = signal ? decision.reason : "";

      out.push({
        symbol,
        markPrice,
        openInterestValue,
        fundingRate,
        nextFundingTime,
        fundingIntervalHour,
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
        payload: { sessionState: st.sessionState, sessionId: st.sessionId, rows, botStats: computeBotStats(rows), streamsEnabled, bybitConnected, ...getUniverseInfo() },
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
      payload: { sessionState: st.sessionState, sessionId: st.sessionId, rows, botStats: computeBotStats(rows), streamsEnabled, bybitConnected, ...getUniverseInfo() },
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

  function startTickTimer() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      const now = nowMs();
      const rows = rowsAllowed() ? attachPaper(computeBaseRows(now), now) : [];
      const msg: ServerWsMessage = { type: "tick", payload: { serverTime: now, rows, botStats: computeBotStats(rows), ...getUniverseInfo() } };
      for (const c of clients) safeSend(c, msg);
    }, 1000);
  }

  function stopTickTimer() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function syncRuntimeStreamLifecycle() {
    const st = runtime.getStatus();
    if (st.sessionState === "RUNNING") {
      streamsEnabled = true;
      desiredStreams = true;
      void startUpstreamIfNeeded();
      startTickTimer();
      broadcastStreamsState();
      return;
    }

    streamsEnabled = false;
    desiredStreams = false;
    stopUpstreamHard();
    stopTickTimer();
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
    const topics = buildBybitTopics(cfg);
    const batches = chunkTopicsByCharLimit(topics);

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
        app.log.info("bybit ws: open");
        broadcastStreamsState();
        subscribeAll();
      },
      onClose: () => {
        connectInFlight = false;
        bybit = null;
        bybitConnected = false;
        app.log.warn("bybit ws: close");
        broadcastStreamsState();
        scheduleReconnect();
      },
      onError: (err) => {
        connectInFlight = false;
        app.log.error({ err }, "bybit ws: error");
        scheduleReconnect();
      },
      onTicker: (topic, _type, data) => {
        const symbol = topic.slice("tickers.".length);
        cache.upsertFromTicker(symbol, data);
      },
      onKline: (topic, _type, data) => {
        const symbol = parseKlineSymbol(topic);
        if (!symbol) return;
        candles.ingestKline(symbol, data);
      },
    });

    try {
      await bybit.connect();
    } catch (err) {
      connectInFlight = false;
      app.log.error({ err }, "bybit ws: connect failed");
      bybit = null;
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
    broadcastStreamsState();
  }

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
    const changed = key !== lastUniverseKey || Boolean(meta?.universeChanged);

    if (!changed) return;

    lastUniverseKey = key;

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
        payload: { sessionState: st.sessionState, sessionId: st.sessionId, rows, botStats: computeBotStats(rows), streamsEnabled, bybitConnected, ...getUniverseInfo() },
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
      });
      ws.on("error", () => {
        clients.delete(ws);
        clientEventsLimit.delete(ws);
      });
    });

    syncRuntimeStreamLifecycle();

    app.log.info("wsHub: /ws ready (dynamic universe via runtime config)");
  });

  app.addHook("onClose", async () => {
    runtime.off("state", onRuntimeState);
    runtime.off("event", onRuntimeEvent);

    configStore.off("change", onConfigChange);

    if (universeApplyTimer) clearTimeout(universeApplyTimer);
    universeApplyTimer = null;

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;

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
