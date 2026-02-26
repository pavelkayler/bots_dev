import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtime } from "../runtime/runtime.js";
import { CONFIG } from "../config.js";
import { configStore } from "../runtime/configStore.js";
import { deleteUniverse, listUniverses, readUniverse, writeUniverse, formatUniverseName } from "../universe/universeStore.js";
import { buildUniverseByTickersWs } from "../universe/universeBuilder.js";
import { seedLinearUsdtPerpSymbols } from "../universe/universeSeed.js";
import * as paperSummary from "../paper/summary.js";
type SessionSummaryResponse = any;
import { deletePreset, listPresets, putPreset, readPreset } from "../presets/presetStore.js";
import { getOptimizerSettings, listTapes, safeId, setOptimizerSettings } from "../optimizer/tapeStore.js";
import { tapeRecorder } from "../optimizer/tapeRecorder.js";
import {
  DEFAULT_OPTIMIZER_PRECISION,
  runOptimization,
  sortOptimizationResults,
  type OptimizerPrecision,
  type OptimizerRanges,
  type OptimizerResult,
  type OptimizerSortDir,
  type OptimizerSortKey,
} from "../optimizer/runner.js";

type OptimizerJob = {
  status: "running" | "done" | "error" | "cancelled";
  total: number;
  done: number;
  lastPct: number;
  cancelRequested: boolean;
  message?: string;
  results: OptimizerResult[];
};

const optimizerJobs = new Map<string, OptimizerJob>();
const optimizerJobStartedAt = new Map<string, number>();
let latestOptimizerJobId: string | null = null;

function rememberOptimizerJob(jobId: string) {
  optimizerJobStartedAt.set(jobId, Date.now());
  latestOptimizerJobId = jobId;
}

function resolveCurrentOptimizerJobId(): string | null {
  const entries = Array.from(optimizerJobStartedAt.entries()).filter(([jobId]) => optimizerJobs.has(jobId));
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const running = entries.find(([jobId]) => optimizerJobs.get(jobId)?.status === "running");
  if (running) return running[0];
  if (latestOptimizerJobId && optimizerJobs.has(latestOptimizerJobId)) return latestOptimizerJobId;
  return entries.at(0)?.[0] ?? null;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("invalid_numeric_range");
  return n;
}

function parseRanges(raw: any): OptimizerRanges | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const parsed: OptimizerRanges = {};
  const assignIfDefined = (key: keyof OptimizerRanges, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const min = toNumberOrUndefined((value as any).min);
    const max = toNumberOrUndefined((value as any).max);
    if (min === undefined && max === undefined) return;
    if (min === undefined || max === undefined) throw new Error(`invalid_range_${String(key)}`);
    if (min > max) throw new Error(`invalid_range_${String(key)}`);
    parsed[key] = { min, max };
  };

  assignIfDefined("priceTh", raw.priceTh);
  assignIfDefined("oivTh", raw.oivTh);
  assignIfDefined("tp", raw.tp);
  assignIfDefined("sl", raw.sl);
  assignIfDefined("offset", raw.offset);

  return parsed;
}

function parsePrecision(raw: any): Partial<OptimizerPrecision> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const keys: Array<keyof OptimizerPrecision> = ["priceTh", "oivTh", "tp", "sl", "offset"];
  const parsed: Partial<OptimizerPrecision> = {};
  for (const key of keys) {
    if ((raw as any)[key] === undefined) continue;
    const value = Number((raw as any)[key]);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error(`invalid_precision_${String(key)}`);
    }
    parsed[key] = value;
  }
  return Object.keys(parsed).length ? parsed : undefined;
}

function safeBody(reqBody: any) {
  if (reqBody == null) return {};
  if (typeof reqBody === "string") {
    try {
      return JSON.parse(reqBody);
    } catch {
      return {};
    }
  }
  return reqBody;
}

function arrayEq(a: any, b: any): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function universeWouldChange(cur: any, patch: any): boolean {
  if (!patch || typeof patch !== "object") return false;
  const u = (patch as any).universe;
  if (!u || typeof u !== "object") return false;

  const nextSelectedId = u.selectedId ?? cur.universe.selectedId;
  const nextSymbols = u.symbols ?? cur.universe.symbols;
  const nextTf = u.klineTfMin ?? cur.universe.klineTfMin;

  const idChanged = nextSelectedId !== cur.universe.selectedId;
  const symbolsChanged = !arrayEq(nextSymbols, cur.universe.symbols);
  const tfChanged = nextTf !== cur.universe.klineTfMin;

  return idChanged || symbolsChanged || tfChanged;
}

function getSessionDirFromEventsFile(eventsFile: string): string {
  return path.dirname(eventsFile);
}

function tryReadJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function getSummaryFilePath(eventsFile: string): string {
  return path.join(getSessionDirFromEventsFile(eventsFile), "summary.json");
}

async function computeSummary(eventsFile: string, sessionId: string | null): Promise<SessionSummaryResponse> {
  const anyMod = paperSummary as any;

  const fn =
    anyMod.buildPaperSummaryFromJsonl ??
    anyMod.buildSummaryFromJsonl ??
    anyMod.buildPaperSummary ??
    anyMod.buildSummary;

  if (typeof fn !== "function") {
    throw new Error("summary_builder_not_found");
  }

  return (await fn(eventsFile, sessionId)) as SessionSummaryResponse;
}

export function registerHttpRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/session/status", async () => runtime.getStatus());

  app.post("/api/session/start", async (_req, reply) => {
    const cfg = configStore.get();
    const id = String((cfg as any)?.universe?.selectedId ?? "");
    const symbols = Array.isArray((cfg as any)?.universe?.symbols) ? (cfg as any).universe.symbols : [];

    if (!id || symbols.length === 0) {
      reply.code(409);
      return { error: "universe_not_selected", message: "Select a Universe and click Apply before starting." };
    }

    return await runtime.start();
  });

  app.post("/api/session/stop", async () => runtime.stop());

  app.get("/api/config", async () => {
    return { config: configStore.get() };
  });

  app.post("/api/config", async (req, reply) => {
    const patch = safeBody((req as any).body);
    const cur = configStore.get();

    if (universeWouldChange(cur, patch) && runtime.isRunning()) {
      reply.code(409);
      return {
        error: "universe_change_requires_stopped_session",
        message: "Universe (symbols/klineTfMin) can be changed only when session is STOPPED."
      };
    }

    try {
      const config = configStore.update(patch);

      try {
        configStore.persist();
      } catch (e: any) {
        app.log.error({ err: e }, "failed to persist runtime config");
        reply.code(500);
        return { error: "config_persist_failed", message: String(e?.message ?? e) };
      }

      const uChanged = universeWouldChange(cur, patch);

      return {
        config,
        applied: {
          universe: uChanged ? "streams_reconnect" : "no_change",
          signals: true,
          fundingCooldown: true,
          paper: "next_session"
        }
      };
    } catch (err: any) {
      reply.code(400);
      return { error: "invalid_config", message: String(err?.message ?? err) };
    }
  });

  // universes
  app.get("/api/universes", async () => {
    return { universes: listUniverses() };
  });

  app.get("/api/universes/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      return readUniverse(id);
    } catch (e: any) {
      reply.code(404);
      return { error: "universe_not_found", message: String(e?.message ?? e) };
    }
  });

  app.post("/api/universes/create", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const minTurnoverUsd = Number(body?.minTurnoverUsd);
    const minVolatilityPct = Number(body?.minVolatilityPct);

    if (!Number.isFinite(minTurnoverUsd) || minTurnoverUsd < 0) {
      reply.code(400);
      return { error: "invalid_minTurnoverUsd" };
    }
    if (!Number.isFinite(minVolatilityPct) || minVolatilityPct < 0) {
      reply.code(400);
      return { error: "invalid_minVolatilityPct" };
    }

    const { id, name } = formatUniverseName(minTurnoverUsd, minVolatilityPct);

    try {
      const symbols = await seedLinearUsdtPerpSymbols({ restBaseUrl: "https://api.bybit.com" });

      const res = await buildUniverseByTickersWs({
        wsUrl: CONFIG.bybit.wsUrl,
        symbols,
        minTurnoverUsd,
        minVolatilityPct,
        collectMs: 5000
      });
const now = Date.now();
      const file = writeUniverse({
        meta: {
          id,
          name,
          minTurnoverUsd,
          minVolatilityPct,
          createdAt: now,
          updatedAt: now,
          count: res.symbols.length
        },
        symbols: res.symbols
      });

      return { universe: file, stats: res };
    } catch (e: any) {
      reply.code(400);
      return { error: "universe_create_failed", message: String(e?.message ?? e) };
    }
  });

  app.delete("/api/universes/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    const status = runtime.getStatus();
    const selectedId = String((configStore.get() as any)?.universe?.selectedId ?? "");

    if ((status.sessionState === "RUNNING" || status.sessionState === "STOPPING") && selectedId === id) {
      reply.code(409);
      return {
        error: "universe_in_use",
        message: "Cannot delete universe while it is used by a running session."
      };
    }

    try {
      deleteUniverse(id);
      return { ok: true as const };
    } catch {
      reply.code(404);
      return { error: "universe_not_found" };
    }
  });

  // presets
  app.get("/api/presets", async () => {
    return { presets: listPresets().map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) };
  });

  app.get("/api/presets/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      return readPreset(id);
    } catch (e: any) {
      reply.code(404);
      return { error: "preset_not_found", message: String(e?.message ?? e) };
    }
  });

  app.put("/api/presets/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    const body = safeBody((req as any).body) as any;
    const name = String(body?.name ?? "").trim();
    const config = body?.config;

    if (!name || !config || typeof config !== "object") {
      reply.code(400);
      return { error: "invalid_preset_payload" };
    }

    try {
      const preset = putPreset(id, name, config);
      return preset;
    } catch (e: any) {
      reply.code(400);
      return { error: "preset_save_failed", message: String(e?.message ?? e) };
    }
  });

  app.delete("/api/presets/:id", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    try {
      deletePreset(id);
      return { ok: true as const };
    } catch (e: any) {
      reply.code(404);
      return { error: "preset_not_found", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/optimizer/tapes", async () => {
    return { tapes: listTapes() };
  });

  app.get("/api/optimizer/settings", async () => {
    return getOptimizerSettings();
  });

  app.post("/api/optimizer/settings", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    try {
      return setOptimizerSettings({ tapesDir: String(body?.tapesDir ?? "") });
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_settings", message: String(e?.message ?? e) };
    }
  });

  app.post("/api/optimizer/tapes/start", async (_req, reply) => {
    try {
      const { tapeId } = tapeRecorder.startRecording();
      return { tapeId };
    } catch (e: any) {
      if (String(e?.message ?? e) === "session_not_running") {
        reply.code(409);
        return { error: "session_not_running", message: "Session must be RUNNING to start tape recording." };
      }
      reply.code(400);
      return { error: "tape_start_failed", message: String(e?.message ?? e) };
    }
  });

  app.post("/api/optimizer/tapes/stop", async () => {
    tapeRecorder.stopRecording();
    return { ok: true as const };
  });

  app.get("/api/optimizer/status", async () => {
    const state = tapeRecorder.getState();
    return { isRecording: state.isRecording, tapeId: state.currentTapeId };
  });

  app.post("/api/optimizer/run", async (req, reply) => {
    const body = safeBody((req as any).body) as any;
    const tapeIdsRaw = Array.isArray(body?.tapeIds) ? body.tapeIds : undefined;
    const tapeIds = (tapeIdsRaw ?? [body?.tapeId]).map((v: unknown) => String(v ?? "").trim()).filter(Boolean);
    const candidates = Number(body?.candidates);
    const seed = Number(body?.seed ?? 1);
    const directionMode = body?.directionMode == null ? "both" : String(body.directionMode);

    if (!Number.isFinite(candidates) || candidates < 1 || candidates > 2000) {
      reply.code(400);
      return { error: "invalid_candidates" };
    }

    if (!tapeIds.length) {
      reply.code(400);
      return { error: "invalid_tape_id", message: "No tape IDs provided" };
    }

    if (!["both", "long", "short"].includes(directionMode)) {
      reply.code(400);
      return { error: "invalid_direction_mode" };
    }

    try {
      tapeIds.forEach((id: string) => safeId(id));
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_tape_id", message: String(e?.message ?? e) };
    }

    let ranges: OptimizerRanges | undefined;
    let precision: Partial<OptimizerPrecision> | undefined;
    try {
      ranges = parseRanges(body?.ranges);
      precision = parsePrecision(body?.precision);
    } catch (e: any) {
      reply.code(400);
      return { error: "invalid_optimizer_run_payload", message: String(e?.message ?? e) };
    }

    const jobId = randomUUID();
    const total = Math.floor(candidates);
    const job: OptimizerJob = {
      status: "running",
      total: 100,
      done: 0,
      lastPct: 0,
      results: [],
      cancelRequested: false,
    };
    optimizerJobs.set(jobId, job);
    rememberOptimizerJob(jobId);

    setTimeout(() => {
      void (async () => {
        try {
          const output = await runOptimization({
            tapeIds,
            candidates: total,
            seed: Number.isFinite(seed) ? seed : 1,
            ...(ranges ? { ranges } : {}),
            ...(precision ? { precision } : { precision: DEFAULT_OPTIMIZER_PRECISION }),
            directionMode: directionMode as "both" | "long" | "short",
            onProgress: (done, totalDone, partialResults) => {
              const rawPct = totalDone > 0 ? (done / totalDone) * 100 : 0;
              const pct2 = Math.max(0, Math.min(100, Math.round(rawPct * 100) / 100));
              job.lastPct = pct2;
              job.done = pct2;
              job.total = 100;
              job.results = partialResults;
            },
            shouldStop: () => job.cancelRequested,
          });
          job.results = output.results ?? [];
          if (output.cancelled || job.cancelRequested) {
            job.status = "cancelled";
            job.message = "Optimization cancelled.";
          } else {
            job.lastPct = 100;
            job.done = 100;
            job.total = 100;
            job.status = "done";
            if (output.diagnostics && output.diagnostics.decisionsOk === 0 && output.diagnostics.decisionsNoRefs > 0) {
              job.message = `Replay diagnostics: decisionsOk=0, decisionsNoRefs=${output.diagnostics.decisionsNoRefs}.`;
            }
          }
        } catch (e: any) {
          job.status = "error";
          job.message = String(e?.message ?? e);
        }
      })();
    }, 0);

    return { jobId };
  });


  app.post("/api/optimizer/jobs/current/cancel", async (_req, reply) => {
    const jobId = resolveCurrentOptimizerJobId();
    if (!jobId) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }
    const job = optimizerJobs.get(jobId);
    if (!job || job.status !== "running") {
      reply.code(409);
      return { error: "optimizer_job_not_running" };
    }
    job.cancelRequested = true;
    return { ok: true };
  });

  app.get("/api/optimizer/jobs/current", async () => {
    const jobId = resolveCurrentOptimizerJobId();
    return { jobId };
  });

  app.get("/api/optimizer/jobs/:jobId/status", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const job = optimizerJobs.get(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    return {
      status: job.status,
      total: job.total,
      done: job.done,
      ...(job.message ? { message: job.message } : {}),
    };
  });

  app.get("/api/optimizer/jobs/:jobId/results", async (req, reply) => {
    const jobId = String((req.params as any).jobId ?? "");
    const query = (req.query ?? {}) as any;
    const job = optimizerJobs.get(jobId);
    if (!job) {
      reply.code(404);
      return { error: "optimizer_job_not_found" };
    }

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = 50;
    const sortKey = ["netPnl", "trades", "winRatePct", "priceTh", "oivTh", "tp", "sl", "offset"].includes(String(query.sortKey))
      ? (String(query.sortKey) as OptimizerSortKey)
      : "netPnl";
    const sortDir = String(query.sortDir) === "asc" ? "asc" : "desc";

    const sorted = sortOptimizationResults(job.results, sortKey, sortDir as OptimizerSortDir);
    const start = (page - 1) * pageSize;
    const pageRows = sorted.slice(start, start + pageSize).map((result, index) => ({
      rank: start + index + 1,
      ...result,
    }));

    return {
      status: job.status,
      page,
      pageSize,
      totalRows: sorted.length,
      sortKey,
      sortDir,
      results: pageRows,
    };
  });


  app.get("/api/stats/trade-by-symbol", async (req, reply) => {
    const query = (req.query ?? {}) as any;
    const mode = String(query.mode ?? "both");
    if (!["both", "long", "short"].includes(mode)) {
      reply.code(400);
      return { error: "invalid_mode" };
    }
    const symbols = configStore.get().universe.symbols ?? [];
    return {
      sessionId: runtime.getStatus().sessionId,
      mode,
      stats: runtime.getTradeStatsBySymbol(mode as "both" | "long" | "short", symbols),
    };
  });

  app.get("/api/stats/trade-excursions-by-symbol", async () => {
    const symbols = configStore.get().universe.symbols ?? [];
    return {
      sessionId: runtime.getStatus().sessionId,
      stats: runtime.getTradeExcursionsBySymbol(symbols),
    };
  });

  // paper summary
  app.get("/api/session/summary", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }

    const summaryPath = getSummaryFilePath(st.eventsFile);

    const fromFile = tryReadJsonFile<SessionSummaryResponse>(summaryPath);
    if (fromFile) return fromFile;

    try {
      const computed = await computeSummary(st.eventsFile, st.sessionId ?? null);
      return computed;
    } catch (e: any) {
      reply.code(404);
      return { error: "no_summary", message: String(e?.message ?? e) };
    }
  });

  app.get("/api/session/summary/download", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }

    const summaryPath = getSummaryFilePath(st.eventsFile);
    if (!fs.existsSync(summaryPath)) {
      try {
        const computed = await computeSummary(st.eventsFile, st.sessionId ?? null);
        fs.writeFileSync(summaryPath, JSON.stringify(computed, null, 2), "utf8");
      } catch (e: any) {
        reply.code(404);
        return { error: "no_summary", message: String(e?.message ?? e) };
      }
    }

    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="summary.json"');

    const stream = fs.createReadStream(summaryPath);
    return reply.send(stream);
  });

  // download current session jsonl
  app.get("/api/session/events/download", async (_req, reply) => {
    const st = runtime.getStatus();
    if (!st.eventsFile) {
      reply.code(404);
      return { error: "no_events_file" };
    }

    const filename = path.basename(st.eventsFile);
    reply.header("Content-Type", "application/jsonl; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(st.eventsFile);
    return reply.send(stream);
  });
}
