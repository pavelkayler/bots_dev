import fs, { type WriteStream } from "node:fs";
import { configStore } from "../runtime/configStore.js";
import { runtime } from "../runtime/runtime.js";
import { ensureDir, getTapePath } from "./tapeStore.js";

const MAX_TAPE_SEGMENT_BYTES = 90 * 1024 * 1024;

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
  private baseTapeId: string | null = null;
  private segmentIndex = 1;
  private bytesWritten = 0;
  private stream: WriteStream | null = null;
  private meta: RecorderMeta | null = null;
  private lastTickerTsBySymbol = new Map<string, number>();

  constructor() {
    runtime.on("state", () => {
      this.syncWithRuntime();
    });
  }

  getState() {
    return {
      isRecording: this.recording,
      currentTapeId: this.currentTape,
      meta: this.meta,
    };
  }

  startRecording(opts?: { forceNew?: boolean }) {
    const st = runtime.getStatus();
    if (st.sessionState !== "RUNNING") {
      throw new Error("session_not_running");
    }

    if (this.recording && this.meta?.sessionId === st.sessionId && !opts?.forceNew) {
      return { tapeId: this.currentTape as string };
    }

    if (this.recording) {
      this.stopRecording();
    }

    ensureDir();

    const createdAt = Date.now();
    const baseId = `tape-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}`;
    const cfg = configStore.get();

    const meta: RecorderMeta = {
      tapeId: baseId,
      createdAt,
      sessionId: st.sessionId,
      universeSelectedId: cfg.universe.selectedId,
      klineTfMin: cfg.universe.klineTfMin,
      symbols: Array.isArray(cfg.universe.symbols) ? [...cfg.universe.symbols] : [],
    };

    this.lastTickerTsBySymbol.clear();
    this.recording = true;
    this.baseTapeId = baseId;
    this.segmentIndex = 1;
    this.meta = meta;
    this.openSegment(1, createdAt);

    return { tapeId: this.currentTape as string };
  }

  stopRecording() {
    if (this.stream) {
      this.stream.end();
    }
    this.lastTickerTsBySymbol.clear();
    this.recording = false;
    this.currentTape = null;
    this.baseTapeId = null;
    this.segmentIndex = 1;
    this.bytesWritten = 0;
    this.stream = null;
    this.meta = null;
  }

  syncWithRuntime() {
    const st = runtime.getStatus();
    if (st.sessionState === "RUNNING") {
      this.startRecording({ forceNew: false });
      return;
    }
    this.stopRecording();
  }

  recordTicker(ts: number, symbol: string, payload: { markPrice: number; openInterestValue: number; fundingRate: number; nextFundingTime: number }) {
    if (!this.recording || !this.stream) return;
    if (!Number.isFinite(payload.markPrice) || !Number.isFinite(payload.openInterestValue) || !Number.isFinite(payload.fundingRate) || !Number.isFinite(payload.nextFundingTime)) {
      return;
    }
    const last = this.lastTickerTsBySymbol.get(symbol) ?? 0;
    if (ts - last < 5000) {
      return;
    }
    this.writeLine({ type: "ticker", ts, symbol, payload });
    this.lastTickerTsBySymbol.set(symbol, ts);
  }

  recordKlineConfirm(ts: number, symbol: string, payload: { close: unknown }) {
    if (!this.recording || !this.stream) return;
    this.writeLine({ type: "kline_confirm", ts, symbol, payload });
  }

  private tapeIdForSegment(index: number): string {
    if (!this.baseTapeId) throw new Error("tape_not_started");
    return index <= 1 ? this.baseTapeId : `${this.baseTapeId}-seg${index}`;
  }

  private openSegment(index: number, ts: number) {
    if (!this.meta) return;
    const tapeId = this.tapeIdForSegment(index);
    const filePath = getTapePath(tapeId);
    const stream = fs.createWriteStream(filePath, { encoding: "utf8", flags: "a" });
    const existingSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    this.segmentIndex = index;
    this.currentTape = tapeId;
    this.stream = stream;
    this.bytesWritten = existingSize;
    const nextMeta: RecorderMeta = { ...this.meta, tapeId };
    this.meta = nextMeta;
    const metaLine = `${JSON.stringify({ type: "meta", ts, payload: nextMeta })}\n`;
    stream.write(metaLine);
    this.bytesWritten += Buffer.byteLength(metaLine);
  }

  private rotateSegment(ts: number) {
    if (this.stream) {
      this.stream.end();
    }
    this.openSegment(this.segmentIndex + 1, ts);
  }

  private writeLine(payload: unknown) {
    if (!this.stream) return;
    const line = `${JSON.stringify(payload)}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (this.bytesWritten + lineBytes > MAX_TAPE_SEGMENT_BYTES) {
      this.rotateSegment(Date.now());
    }
    if (!this.stream) return;
    this.stream.write(line);
    this.bytesWritten += lineBytes;
  }
}

export const tapeRecorder = new TapeRecorder();
