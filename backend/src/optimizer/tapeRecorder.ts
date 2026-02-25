import fs, { type WriteStream } from "node:fs";
import { configStore } from "../runtime/configStore.js";
import { runtime } from "../runtime/runtime.js";
import { ensureDir, getTapePath } from "./tapeStore.js";

type RecorderMeta = {
  tapeId: string;
  createdAt: number;
  sessionId: string | null;
  universeSelectedId: string;
  klineTfMin: number;
  symbols: string[];
};

class TapeRecorder {
  private recording = false;
  private currentTape: string | null = null;
  private stream: WriteStream | null = null;
  private meta: RecorderMeta | null = null;
  private lastTickerTsBySymbol = new Map<string, number>();

  getState() {
    return {
      isRecording: this.recording,
      currentTapeId: this.currentTape,
      meta: this.meta,
    };
  }

  startRecording() {
    const st = runtime.getStatus();
    if (st.sessionState !== "RUNNING") {
      throw new Error("session_not_running");
    }

    if (this.recording) {
      this.stopRecording();
    }

    ensureDir();

    const createdAt = Date.now();
    const tapeId = `tape-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}`;
    const cfg = configStore.get();

    const meta: RecorderMeta = {
      tapeId,
      createdAt,
      sessionId: st.sessionId,
      universeSelectedId: cfg.universe.selectedId,
      klineTfMin: cfg.universe.klineTfMin,
      symbols: Array.isArray(cfg.universe.symbols) ? [...cfg.universe.symbols] : [],
    };

    const filePath = getTapePath(tapeId);
    const stream = fs.createWriteStream(filePath, { encoding: "utf8", flags: "w" });

    stream.write(
      `${JSON.stringify({ type: "meta", ts: createdAt, payload: meta })}\n`
    );

    this.lastTickerTsBySymbol.clear();
    this.recording = true;
    this.currentTape = tapeId;
    this.stream = stream;
    this.meta = meta;

    return { tapeId };
  }

  stopRecording() {
    if (this.stream) {
      this.stream.end();
    }
    this.lastTickerTsBySymbol.clear();
    this.recording = false;
    this.currentTape = null;
    this.stream = null;
    this.meta = null;
  }

  recordTicker(
    ts: number,
    symbol: string,
    payload: { markPrice: number; openInterestValue: number; fundingRate: number; nextFundingTime: number }
  ) {
    if (!this.recording || !this.stream) return;
    if (
      !Number.isFinite(payload.markPrice) ||
      !Number.isFinite(payload.openInterestValue) ||
      !Number.isFinite(payload.fundingRate) ||
      !Number.isFinite(payload.nextFundingTime)
    ) {
      return;
    }
    const last = this.lastTickerTsBySymbol.get(symbol) ?? 0;
    if (ts - last < 5000) {
      return;
    }
    this.stream.write(
      `${JSON.stringify({ type: "ticker", ts, symbol, payload })}\n`
    );
    this.lastTickerTsBySymbol.set(symbol, ts);
  }

  recordKlineConfirm(ts: number, symbol: string, payload: { close: unknown }) {
    if (!this.recording || !this.stream) return;
    this.stream.write(
      `${JSON.stringify({ type: "kline_confirm", ts, symbol, payload })}\n`
    );
  }
}

export const tapeRecorder = new TapeRecorder();
