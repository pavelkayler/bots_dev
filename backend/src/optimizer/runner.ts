import fs from "node:fs";
import { BybitMarketCache } from "../engine/BybitMarketCache.js";
import { CandleTracker } from "../engine/CandleTracker.js";
import { FundingCooldownGate } from "../engine/FundingCooldownGate.js";
import { SignalEngine } from "../engine/SignalEngine.js";
import { PaperBroker } from "../paper/PaperBroker.js";
import { configStore } from "../runtime/configStore.js";
import { getTapePath, safeId } from "./tapeStore.js";

type TapeMeta = {
  tapeId?: string;
  createdAt?: number;
  sessionId?: string | null;
  universeSelectedId?: string;
  klineTfMin?: number;
  symbols?: string[];
};

type TapeEvent =
  | { type: "ticker"; ts: number; symbol: string; payload: any }
  | { type: "kline_confirm"; ts: number; symbol: string; payload: any };

type RandomizedParams = {
  priceThresholdPct: number;
  oivThresholdPct: number;
  entryOffsetPct: number;
  tpRoiPct: number;
  slRoiPct: number;
};

export type OptimizerResult = {
  netPnl: number;
  trades: number;
  winRatePct: number;
  params: RandomizedParams;
};

export type OptimizerSortKey = "netPnl" | "trades" | "winRatePct";
export type OptimizerSortDir = "asc" | "desc";

export type OptimizerRanges = Partial<{
  priceThresholdPctMin: number;
  priceThresholdPctMax: number;
  oivThresholdPctMin: number;
  oivThresholdPctMax: number;
  entryOffsetPctMin: number;
  entryOffsetPctMax: number;
  tpRoiPctMin: number;
  tpRoiPctMax: number;
  slRoiPctMin: number;
  slRoiPctMax: number;
}>;

function pctChange(now: number, ref: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(ref) || ref === 0) return null;
  return ((now - ref) / ref) * 100;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildRng(seed: number) {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pickRange(rnd: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + rnd() * (max - min);
}

function quantize(value: number, step = 0.001): number {
  return Math.round(value / step) * step;
}

function quantizeAndClamp(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, quantize(value, 0.001)));
  return Number(clamped.toFixed(3));
}

function readRange(ranges: OptimizerRanges | undefined, keyMin: keyof OptimizerRanges, keyMax: keyof OptimizerRanges, fallbackMin: number, fallbackMax: number) {
  const min = toFiniteNumber(ranges?.[keyMin], fallbackMin);
  const max = toFiniteNumber(ranges?.[keyMax], fallbackMax);
  if (max < min) return { min: max, max: min };
  return { min, max };
}

export function readTapeLines(tapePath: string): { meta: TapeMeta | null; events: TapeEvent[] } {
  const raw = fs.readFileSync(tapePath, "utf8");
  const lines = raw.split(/\r?\n/);

  let meta: TapeMeta | null = null;
  const events: TapeEvent[] = [];

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;

    try {
      const row = JSON.parse(text) as any;
      if (row?.type === "meta" && meta == null && row.payload && typeof row.payload === "object") {
        meta = row.payload as TapeMeta;
        continue;
      }
      if (row?.type === "ticker" && typeof row?.symbol === "string") {
        events.push({
          type: "ticker",
          ts: Number(row.ts) || 0,
          symbol: row.symbol,
          payload: row.payload ?? {},
        });
        continue;
      }
      if (row?.type === "kline_confirm" && typeof row?.symbol === "string") {
        events.push({
          type: "kline_confirm",
          ts: Number(row.ts) || 0,
          symbol: row.symbol,
          payload: row.payload ?? {},
        });
      }
    } catch {
      // ignore
    }
  }

  return { meta, events };
}

export function sortOptimizationResults(results: OptimizerResult[], key: OptimizerSortKey, dir: OptimizerSortDir): OptimizerResult[] {
  const direction = dir === "asc" ? 1 : -1;
  const toComparable = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return [...results].sort((a, b) => (toComparable(a[key]) - toComparable(b[key])) * direction);
}

function generateCandidate(rnd: () => number, ranges: OptimizerRanges | undefined, base: ReturnType<typeof configStore.get>): RandomizedParams {
  const price = readRange(ranges, "priceThresholdPctMin", "priceThresholdPctMax", 0.1, Math.max(0.1, base.signals.priceThresholdPct * 3 || 1));
  const oiv = readRange(ranges, "oivThresholdPctMin", "oivThresholdPctMax", 0.1, Math.max(0.1, base.signals.oivThresholdPct * 3 || 1));
  const offset = readRange(ranges, "entryOffsetPctMin", "entryOffsetPctMax", 0, Math.max(0.01, base.paper.entryOffsetPct * 3 || 0.5));
  const tp = readRange(ranges, "tpRoiPctMin", "tpRoiPctMax", 1.5, Math.max(1.5, base.paper.tpRoiPct * 3 || 6));
  const sl = readRange(ranges, "slRoiPctMin", "slRoiPctMax", 1.5, Math.max(1.5, base.paper.slRoiPct * 3 || 6));

  return {
    priceThresholdPct: quantizeAndClamp(pickRange(rnd, price.min, price.max), price.min, price.max),
    oivThresholdPct: quantizeAndClamp(pickRange(rnd, oiv.min, oiv.max), oiv.min, oiv.max),
    entryOffsetPct: quantizeAndClamp(pickRange(rnd, offset.min, offset.max), offset.min, offset.max),
    tpRoiPct: Math.max(1.5, quantizeAndClamp(pickRange(rnd, tp.min, tp.max), tp.min, tp.max)),
    slRoiPct: Math.max(1.5, quantizeAndClamp(pickRange(rnd, sl.min, sl.max), sl.min, sl.max)),
  };
}

export function runOptimization(args: {
  tapeId: string;
  candidates: number;
  seed: number;
  ranges?: OptimizerRanges;
  onProgress?: (done: number, total: number) => void;
}) {
  const tapeId = safeId(args.tapeId);
  const tapePath = getTapePath(tapeId);
  const { meta, events } = readTapeLines(tapePath);

  const baseConfig = configStore.get();
  const rnd = buildRng(args.seed);
  const results: OptimizerResult[] = [];

  for (let i = 0; i < args.candidates; i += 1) {
    const params = generateCandidate(rnd, args.ranges, baseConfig);
    const candidateConfig = {
      signals: {
        priceThresholdPct: params.priceThresholdPct,
        oivThresholdPct: params.oivThresholdPct,
        requireFundingSign: baseConfig.signals.requireFundingSign,
      },
      paper: {
        enabled: baseConfig.paper.enabled,
        directionMode: baseConfig.paper.directionMode,
        marginUSDT: baseConfig.paper.marginUSDT,
        leverage: baseConfig.paper.leverage,
        entryOffsetPct: params.entryOffsetPct,
        entryTimeoutSec: baseConfig.paper.entryTimeoutSec,
        tpRoiPct: params.tpRoiPct,
        slRoiPct: params.slRoiPct,
        makerFeeRate: baseConfig.paper.makerFeeRate,
        applyFunding: baseConfig.paper.applyFunding,
        rearmDelayMs: baseConfig.paper.rearmDelayMs,
      },
      fundingCooldown: baseConfig.fundingCooldown,
    };

    const cache = new BybitMarketCache();
    const candles = new CandleTracker(cache);
    const fundingGate = new FundingCooldownGate(candidateConfig.fundingCooldown.beforeMin, candidateConfig.fundingCooldown.afterMin);
    const signalEngine = new SignalEngine({
      priceThresholdPct: candidateConfig.signals.priceThresholdPct,
      oivThresholdPct: candidateConfig.signals.oivThresholdPct,
      requireFundingSign: candidateConfig.signals.requireFundingSign,
      directionMode: candidateConfig.paper.directionMode,
    });

    const logger = {
      sessionId: `optimizer-${tapeId}`,
      filePath: "",
      log(_ev: any) {
        return;
      },
    };

    const paper = new PaperBroker(candidateConfig.paper, logger as any);

    let lastEventTs = 0;

    for (const event of events) {
      const ts = Number(event.ts) || 0;
      if (ts > lastEventTs) lastEventTs = ts;

      if (event.type === "ticker") {
        cache.upsertFromTicker(event.symbol, event.payload ?? {});

        const row = cache.getRawRow(event.symbol);
        const markPrice = Number(row?.markPrice ?? 0);
        const openInterestValue = Number(row?.openInterestValue ?? 0);
        const fundingRate = Number(row?.fundingRate ?? 0);
        const nextFundingTime = Number(row?.nextFundingTime ?? 0);

        const refs = candles.getRefs(event.symbol);
        const priceMovePct = refs.prevCandleClose == null || markPrice <= 0 ? null : pctChange(markPrice, refs.prevCandleClose);
        const oivMovePct = refs.prevCandleOivClose == null || openInterestValue <= 0 ? null : pctChange(openInterestValue, refs.prevCandleOivClose);

        const cooldownState = fundingGate.state(nextFundingTime || null, ts);
        const decision = signalEngine.decide({
          priceMovePct,
          oivMovePct,
          fundingRate,
          cooldownActive: cooldownState?.active ?? false,
        });

        paper.tick({
          symbol: event.symbol,
          nowMs: ts,
          markPrice,
          fundingRate,
          nextFundingTime,
          signal: decision.signal,
          signalReason: decision.reason,
          cooldownActive: cooldownState?.active ?? false,
        });
      }

      if (event.type === "kline_confirm") {
        candles.ingestKline(event.symbol, { confirm: true, close: event.payload?.close });
      }
    }

    const symbols = Array.isArray(meta?.symbols) ? meta.symbols : [];
    paper.stopAll({
      nowMs: lastEventTs || Date.now(),
      symbols,
      getMarkPrice: (symbol: string) => cache.getMarkPrice(symbol),
    });

    const stats = paper.getStats();
    const trades = stats.closedTrades;
    const winRatePct = trades > 0 ? (stats.wins / trades) * 100 : 0;

    results.push({
      netPnl: stats.netRealized,
      trades,
      winRatePct,
      params,
    });

    if (args.onProgress) {
      args.onProgress(i + 1, args.candidates);
    }
  }

  return {
    tapeId,
    meta,
    results,
  };
}
