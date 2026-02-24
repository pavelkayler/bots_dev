import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG } from "../config.js";

const symbolSchema = z
  .string()
  .min(1)
  .max(32)
  .refine((s) => /^[A-Z0-9]{2,28}USDT$/.test(s) && !s.includes("-"), {
    message: "Symbol must match USDT perpetual format like BTCUSDT or 1000PEPEUSDT",
  });

const universeSchema = z
  .object({
    selectedId: z.string().max(120).default(""),
    symbols: z.array(symbolSchema).min(1).max(1000),
    klineTfMin: z.number().int().min(1).max(60),
  })
  .strict();

const signalsSchema = z
  .object({
    priceThresholdPct: z.number().finite().min(0),
    oivThresholdPct: z.number().finite().min(0),
    requireFundingSign: z.boolean(),
  })
  .strict();

const fundingCooldownSchema = z
  .object({
    beforeMin: z.number().finite().min(0).max(240),
    afterMin: z.number().finite().min(0).max(240),
  })
  .strict();

const paperSchema = z
  .object({
    enabled: z.boolean(),

    marginUSDT: z.number().finite().min(0),
    leverage: z.number().finite().min(1).max(1000),

    entryOffsetPct: z.number().finite().min(0).max(50),
    entryTimeoutSec: z.number().finite().min(1).max(3600),

    tpRoiPct: z.number().finite().min(0).max(1000),
    slRoiPct: z.number().finite().min(0).max(1000),

    makerFeeRate: z.number().finite().min(0).max(0.01),
    applyFunding: z.boolean(),

    rearmDelayMs: z.number().finite().min(0).max(60_000),
  })
  .strict();

const runtimeConfigSchema = z
  .object({
    universe: universeSchema,
    fundingCooldown: fundingCooldownSchema,
    signals: signalsSchema,
    paper: paperSchema,
  })
  .strict();

const patchSchema = z
  .object({
    universe: universeSchema.partial().optional(),
    fundingCooldown: fundingCooldownSchema.partial().optional(),
    signals: signalsSchema.partial().optional(),
    paper: paperSchema.partial().optional(),
  })
  .strict();

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type RuntimeConfigPatch = z.infer<typeof patchSchema>;

function deepClone<T>(x: T): T {
  return structuredClone(x);
}

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "data", "config.json");

function ensureDataDir() {
  const dir = path.dirname(CONFIG_FILE_PATH);
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileAtomic(filePath: string, content: string) {
  ensureDataDir();

  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");

  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }

  fs.renameSync(tmp, filePath);
}

function migrateLoaded(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  if (!raw.universe || typeof raw.universe !== "object") {
    raw.universe = {
      selectedId: "",
      symbols: Array.from(CONFIG.symbols),
      klineTfMin: CONFIG.klineTfMin,
    };
  } else {
    if (raw.universe.selectedId == null) raw.universe.selectedId = "";
    if (!Array.isArray(raw.universe.symbols)) raw.universe.symbols = Array.from(CONFIG.symbols);
    if (raw.universe.klineTfMin == null) raw.universe.klineTfMin = CONFIG.klineTfMin;
  }

  return raw;
}

function tryLoadFromDisk(): RuntimeConfig | null {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return null;

  const rawText = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
  const parsed = migrateLoaded(JSON.parse(rawText));
  return runtimeConfigSchema.parse(parsed);
}

function quarantineBadConfigFile() {
  try {
    const bad = path.resolve(path.dirname(CONFIG_FILE_PATH), `config.invalid.${Date.now()}.json`);
    fs.renameSync(CONFIG_FILE_PATH, bad);
  } catch {
    // ignore
  }
}

function sameUniverse(a: RuntimeConfig["universe"], b: RuntimeConfig["universe"]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

class ConfigStore extends EventEmitter {
  private cfg: RuntimeConfig;

  constructor(initial: RuntimeConfig) {
    super();
    this.cfg = initial;
  }

  get(): RuntimeConfig {
    return deepClone(this.cfg);
  }

  getFilePath(): string {
    return CONFIG_FILE_PATH;
  }

  persist(): void {
    const json = JSON.stringify(this.cfg, null, 2);
    writeFileAtomic(CONFIG_FILE_PATH, json);
  }

  update(patch: unknown): RuntimeConfig {
    const p = patchSchema.parse(patch);

    const nextCandidate: RuntimeConfig = {
      universe: {
        selectedId: p.universe?.selectedId ?? this.cfg.universe.selectedId,
        symbols: p.universe?.symbols ?? this.cfg.universe.symbols,
        klineTfMin: p.universe?.klineTfMin ?? this.cfg.universe.klineTfMin,
      },
      fundingCooldown: {
        beforeMin: p.fundingCooldown?.beforeMin ?? this.cfg.fundingCooldown.beforeMin,
        afterMin: p.fundingCooldown?.afterMin ?? this.cfg.fundingCooldown.afterMin,
      },
      signals: {
        priceThresholdPct: p.signals?.priceThresholdPct ?? this.cfg.signals.priceThresholdPct,
        oivThresholdPct: p.signals?.oivThresholdPct ?? this.cfg.signals.oivThresholdPct,
        requireFundingSign: p.signals?.requireFundingSign ?? this.cfg.signals.requireFundingSign,
      },
      paper: {
        enabled: p.paper?.enabled ?? this.cfg.paper.enabled,

        marginUSDT: p.paper?.marginUSDT ?? this.cfg.paper.marginUSDT,
        leverage: p.paper?.leverage ?? this.cfg.paper.leverage,

        entryOffsetPct: p.paper?.entryOffsetPct ?? this.cfg.paper.entryOffsetPct,
        entryTimeoutSec: p.paper?.entryTimeoutSec ?? this.cfg.paper.entryTimeoutSec,

        tpRoiPct: p.paper?.tpRoiPct ?? this.cfg.paper.tpRoiPct,
        slRoiPct: p.paper?.slRoiPct ?? this.cfg.paper.slRoiPct,

        makerFeeRate: p.paper?.makerFeeRate ?? this.cfg.paper.makerFeeRate,
        applyFunding: p.paper?.applyFunding ?? this.cfg.paper.applyFunding,

        rearmDelayMs: p.paper?.rearmDelayMs ?? this.cfg.paper.rearmDelayMs,
      },
    };

    const next = runtimeConfigSchema.parse(nextCandidate);
    const universeChanged = !sameUniverse(this.cfg.universe, next.universe);

    this.cfg = next;
    this.emit("change", this.get(), { universeChanged });

    return this.get();
  }
}

const defaults: RuntimeConfig = runtimeConfigSchema.parse({
  universe: { selectedId: "", symbols: Array.from(CONFIG.symbols), klineTfMin: CONFIG.klineTfMin },
  fundingCooldown: CONFIG.fundingCooldown,
  signals: CONFIG.signals,
  paper: CONFIG.paper,
});

let initial: RuntimeConfig = defaults;
try {
  const loaded = tryLoadFromDisk();
  if (loaded) initial = loaded;
} catch {
  quarantineBadConfigFile();
  initial = defaults;
}

export const configStore = new ConfigStore(initial);
export const RUNTIME_CONFIG_FILE = CONFIG_FILE_PATH;
