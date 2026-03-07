import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import type { RuntimeConfig, SessionState } from "../../../shared/types/domain";
import { useRuntimeConfig } from "../hooks/useRuntimeConfig";
import { fmtTime } from "../../../shared/utils/format";
import { listUniverses, readUniverse } from "../../universe/api";
import type { UniverseMeta } from "../../universe/types";
import { deletePreset, listPresets, readPreset, savePreset } from "../../presets/api";
import type { PresetMeta } from "../../presets/types";
import { getApiBase } from "../../../shared/config/env";

type Props = {
  sessionState?: SessionState;
  rebooting?: boolean;
  onDraftKlineTfMinChange?: (klineTfMin: number) => void;
};

const MAKER_FEE_RATE_FIXED = 0.0002;



type DoctorStatus = {
  demoKeysPresent?: boolean;
  demoAuthOk?: boolean;
};

type NumericDraft = {
  signalsPriceThresholdPct: string;
  signalsOivThresholdPct: string;
  signalsDailyTriggerMin: string;
  signalsDailyTriggerMax: string;
  fundingBeforeMin: string;
  fundingAfterMin: string;
  paperMarginUSDT: string;
  paperLeverage: string;
  paperEntryOffsetPct: string;
  paperEntryTimeoutSec: string;
  paperTpRoiPct: string;
  paperSlRoiPct: string;
  paperMakerFeeRate: string;
  paperRearmSec: string;
  paperMaxDailyLossUSDT: string;
};

function toNumericDraft(cfg: RuntimeConfig): NumericDraft {
  return {
    signalsPriceThresholdPct: String(cfg.signals.priceThresholdPct),
    signalsOivThresholdPct: String(cfg.signals.oivThresholdPct),
    signalsDailyTriggerMin: String(cfg.signals.dailyTriggerMin),
    signalsDailyTriggerMax: String(cfg.signals.dailyTriggerMax),
    fundingBeforeMin: String(cfg.fundingCooldown.beforeMin),
    fundingAfterMin: String(cfg.fundingCooldown.afterMin),
    paperMarginUSDT: String(cfg.paper.marginUSDT),
    paperLeverage: String(cfg.paper.leverage),
    paperEntryOffsetPct: String(cfg.paper.entryOffsetPct),
    paperEntryTimeoutSec: String(cfg.paper.entryTimeoutSec),
    paperTpRoiPct: String(cfg.paper.tpRoiPct),
    paperSlRoiPct: String(cfg.paper.slRoiPct),
    paperMakerFeeRate: String(cfg.paper.makerFeeRate),
    paperRearmSec: String(Math.round(cfg.paper.rearmDelayMs / 1000)),
    paperMaxDailyLossUSDT: String(cfg.paper.maxDailyLossUSDT),
  };
}


function preferredUniverseNameFromPreset(name: string): string | null {
  const match = name.match(/\[([^\]]+)\]/);
  const parsed = match?.[1]?.trim();
  return parsed ? parsed : null;
}

function parseNumber(v: string, label: string): number {
  if (v.trim() === "") throw new Error(`${label} is required.`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a valid number.`);
  return n;
}

function parseNumberMin(v: string, label: string, min: number): number {
  const n = parseNumber(v, label);
  if (n < min) throw new Error(`${label} must be >= ${min}.`);
  return n;
}

function toNonNegativeRoundedInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function timeoutSecToMin(timeoutSecText: string): number {
  const timeoutSec = Math.max(60, Math.round(Number(timeoutSecText) || 60));
  return Math.max(1, Math.round(timeoutSec / 60));
}

function timeoutMinToSec(timeoutMinText: string): string {
  const minutes = Math.max(1, Math.round(Number(timeoutMinText) || 1));
  return String(minutes * 60);
}

function validateDraft(draft: RuntimeConfig | null, numericDraft: NumericDraft | null): { ok: true; parsed: RuntimeConfig } | { ok: false } {
  if (!draft || !numericDraft) return { ok: false };
  try {
    const parsed: RuntimeConfig = {
      ...draft,
      signals: {
        ...draft.signals,
        priceThresholdPct: parseNumberMin(numericDraft.signalsPriceThresholdPct, "priceThresholdPct", 0),
        oivThresholdPct: parseNumberMin(numericDraft.signalsOivThresholdPct, "oivThresholdPct", 0),
        dailyTriggerMin: parseNumberMin(numericDraft.signalsDailyTriggerMin, "dailyTriggerMin", 1),
        dailyTriggerMax: parseNumberMin(numericDraft.signalsDailyTriggerMax, "dailyTriggerMax", 1),
        requireFundingSign: true,
      },
      fundingCooldown: {
        ...draft.fundingCooldown,
        beforeMin: parseNumberMin(numericDraft.fundingBeforeMin, "beforeMin", 0),
        afterMin: parseNumberMin(numericDraft.fundingAfterMin, "afterMin", 0),
      },
      paper: {
        ...draft.paper,
        marginUSDT: parseNumberMin(numericDraft.paperMarginUSDT, "marginUSDT", 0),
        leverage: parseNumberMin(numericDraft.paperLeverage, "leverage", 1),
        entryOffsetPct: parseNumberMin(numericDraft.paperEntryOffsetPct, "entryOffsetPct", 0),
        entryTimeoutSec: parseNumberMin(numericDraft.paperEntryTimeoutSec, "entryTimeoutSec", 1),
        tpRoiPct: parseNumberMin(numericDraft.paperTpRoiPct, "tpRoiPct", 0),
        slRoiPct: parseNumberMin(numericDraft.paperSlRoiPct, "slRoiPct", 0),
        makerFeeRate: MAKER_FEE_RATE_FIXED,
        rearmDelayMs: toNonNegativeRoundedInt(parseNumberMin(numericDraft.paperRearmSec, "rearmSec", 0)) * 1000,
        maxDailyLossUSDT: parseNumberMin(numericDraft.paperMaxDailyLossUSDT, "maxDailyLossUSDT", 0),
      },
    };
    const min = parsed.signals.dailyTriggerMin;
    const max = parsed.signals.dailyTriggerMax;
    if (!Number.isInteger(min) || min < 1) return { ok: false };
    if (!Number.isInteger(max) || max < min) return { ok: false };
    return { ok: true, parsed };
  } catch {
    return { ok: false };
  }
}

export function ConfigPanel({ sessionState, rebooting, onDraftKlineTfMinChange }: Props) {
  const { config, draft, setDraft, dirty, error, saving, lastApplied, lastSavedAt, save } = useRuntimeConfig();
  const [inputError, setInputError] = useState<string | null>(null);
  const [numericDraft, setNumericDraft] = useState<NumericDraft | null>(null);

  const [universeList, setUniverseList] = useState<UniverseMeta[]>([]);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [universeError, setUniverseError] = useState<string | null>(null);
  const [selectedUniverseId, setSelectedUniverseId] = useState<string>("");

  const [presets, setPresets] = useState<PresetMeta[]>([]);
  const [presetTfById, setPresetTfById] = useState<Record<string, number>>({});
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const [pendingPatchApplied, setPendingPatchApplied] = useState(false);
  const [defaultPresetEnsured, setDefaultPresetEnsured] = useState(false);

  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const isDemoMode = draft?.execution?.mode === "demo";

  const disabled = !draft || !numericDraft;
  const universeLocked = sessionState === "RUNNING" || sessionState === "STOPPING";
  const hasUniverse = !!selectedUniverseId;
  const validation = useMemo(() => validateDraft(draft, numericDraft), [draft, numericDraft]);
  const isDraftValid = validation.ok;

  const isDirty = useMemo(() => {
    if (!draft) return false;
    if (!validation.ok) return dirty;
    return dirty || JSON.stringify(validation.parsed) !== JSON.stringify(draft);
  }, [draft, validation, dirty]);

  const canApply = hasUniverse && isDraftValid && isDirty && !saving;
  const applyDisabled = disabled || !canApply;

  const badge = useMemo(() => {
    if (saving) return <Badge bg="warning">saving...</Badge>;
    if (error) return <Badge bg="danger">{error}</Badge>;
    if (!draft) return <Badge bg="secondary">loading...</Badge>;
    return dirty ? <Badge bg="primary">modified</Badge> : <Badge bg="secondary">clean</Badge>;
  }, [saving, error, draft, dirty]);

  const appliedHint = useMemo(() => {
    if (!lastApplied) return null;
    const s = lastApplied?.signals ? "signals=live" : "signals=?";
    const f = lastApplied?.fundingCooldown ? "fundingCooldown=live" : "fundingCooldown=?";
    const p = lastApplied?.paper ? `paper=${String(lastApplied.paper)}` : "paper=?";
    return `${s}, ${f}, ${p}`;
  }, [lastApplied]);

  const loadDoctor = useCallback(async () => {
    setDoctorLoading(true);
    try {
      const api = getApiBase();
      const res = await fetch(`${api}/api/doctor`);
      if (!res.ok) {
        setDoctorStatus(null);
        return;
      }
      const json = await res.json();
      setDoctorStatus(json as DoctorStatus);
    } catch {
      setDoctorStatus(null);
    } finally {
      setDoctorLoading(false);
    }
  }, []);

  async function refreshUniverses() {
    setUniverseLoading(true);
    setUniverseError(null);
    try {
      const res = await listUniverses();
      setUniverseList(res.universes ?? []);
    } catch (e: any) {
      setUniverseError(String(e?.message ?? e));
    } finally {
      setUniverseLoading(false);
    }
  }

  async function refreshPresets() {
    try {
      const res = await listPresets();
      const items = res.presets ?? [];
      setPresets(items);
      setSelectedPresetId((prev) => {
        if (prev && items.some((p) => p.id === prev)) return prev;
        const defaultId = items.find((p) => p.id === "default")?.id ?? items[0]?.id ?? "";
        return defaultId;
      });
      const tfEntries = await Promise.all(
        items.map(async (preset) => {
          try {
            const fullPreset = await readPreset(preset.id);
            return [preset.id, Number(fullPreset.config.universe.klineTfMin)] as const;
          } catch {
            return [preset.id, 1] as const;
          }
        })
      );
      setPresetTfById(Object.fromEntries(tfEntries));
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    void refreshUniverses();
    void refreshPresets();
  }, []);

  useEffect(() => {
    if (!isDemoMode) {
      setDoctorStatus(null);
      setDoctorLoading(false);
      return;
    }
    void loadDoctor();
  }, [isDemoMode, loadDoctor]);

  useEffect(() => {
    if (!config) return;
    const id = String((config as any).universe?.selectedId ?? "");
    setSelectedUniverseId(id);
    setNumericDraft(toNumericDraft(config));
  }, [config]);

  useEffect(() => {
    if (!draft) return;
    onDraftKlineTfMinChange?.(Number(draft.universe.klineTfMin));
  }, [draft?.universe.klineTfMin, onDraftKlineTfMinChange]);

  useEffect(() => {
    if (!draft || !numericDraft || pendingPatchApplied) return;
    const raw = localStorage.getItem("bots_dev.pendingConfigPatch");
    if (!raw) {
      setPendingPatchApplied(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as any;
      const patch = parsed?.patch ?? {};
      const nextDraft: RuntimeConfig = {
        ...draft,
        signals: {
          ...draft.signals,
          priceThresholdPct: Number(patch?.signals?.priceThresholdPct ?? draft.signals.priceThresholdPct),
          oivThresholdPct: Number(patch?.signals?.oivThresholdPct ?? draft.signals.oivThresholdPct),
          dailyTriggerMin: Number(patch?.signals?.dailyTriggerMin ?? draft.signals.dailyTriggerMin),
          dailyTriggerMax: Number(patch?.signals?.dailyTriggerMax ?? draft.signals.dailyTriggerMax),
          requireFundingSign: true,
        },
        execution: {
          ...draft.execution,
          mode: (patch?.execution?.mode === "demo" ? "demo" : patch?.execution?.mode === "empty" ? "empty" : patch?.execution?.mode === "paper" ? "paper" : draft.execution?.mode ?? "paper"),
        },
        paper: {
          ...draft.paper,
          tpRoiPct: Number(patch?.paper?.tpRoiPct ?? draft.paper.tpRoiPct),
          slRoiPct: Number(patch?.paper?.slRoiPct ?? draft.paper.slRoiPct),
          entryOffsetPct: Number(patch?.paper?.entryOffsetPct ?? draft.paper.entryOffsetPct),
          entryTimeoutSec: Number(patch?.paper?.entryTimeoutSec ?? draft.paper.entryTimeoutSec),
          rearmDelayMs: toNonNegativeRoundedInt(
            patch?.paper?.rearmSec != null
              ? Number(patch.paper.rearmSec)
              : ((patch?.paper?.rearmMs ?? patch?.paper?.rearmDelayMs ?? draft.paper.rearmDelayMs) / 1000),
          ) * 1000,
          maxDailyLossUSDT: Number(patch?.paper?.maxDailyLossUSDT ?? draft.paper.maxDailyLossUSDT),
        },
      };
      setDraft(nextDraft);
      setNumericDraft(toNumericDraft(nextDraft));
    } catch {
    } finally {
      localStorage.removeItem("bots_dev.pendingConfigPatch");
      setPendingPatchApplied(true);
    }
  }, [draft, numericDraft, pendingPatchApplied, setDraft]);

  useEffect(() => {
    if (defaultPresetEnsured || presetBusy) return;
    if (!draft || !numericDraft) return;
    if (presets.some((p) => p.id === "default")) {
      if (!selectedPresetId) setSelectedPresetId("default");
      setDefaultPresetEnsured(true);
      return;
    }
    void (async () => {
      setPresetBusy(true);
      setInputError(null);
      try {
        const cfg = buildConfigForApply();
        await savePreset("default", "Default", cfg);
        await refreshPresets();
        setSelectedPresetId("default");
      } catch (e: any) {
        setInputError(String(e?.message ?? e));
      } finally {
        setPresetBusy(false);
        setDefaultPresetEnsured(true);
      }
    })();
  }, [defaultPresetEnsured, presetBusy, draft, numericDraft, presets, selectedPresetId]);

  async function onUniverseSelect(id: string) {
    setSelectedUniverseId(id);
    if (!id || !draft) return;

    setUniverseError(null);
    setUniverseLoading(true);
    try {
      const uni = await readUniverse(id);
      setDraft({
        ...draft,
        universe: {
          ...draft.universe,
          selectedId: uni.meta.id,
          symbols: [...uni.symbols]
        }
      });
    } catch (e: any) {
      setUniverseError(String(e?.message ?? e));
    } finally {
      setUniverseLoading(false);
    }
  }

  function setNumericField<K extends keyof NumericDraft>(key: K, value: string) {
    if (!numericDraft) return;
    setInputError(null);
    setNumericDraft({ ...numericDraft, [key]: value });
  }

function buildConfigForApply(): RuntimeConfig {
    if (!validation.ok) throw new Error("Fix invalid numeric values before applying.");
    return { ...validation.parsed, signals: { ...validation.parsed.signals, requireFundingSign: true } };
  }

  async function onApply() {
    setInputError(null);
    if (!selectedUniverseId) {
      setInputError("Universe is required.");
      return;
    }
    try {
      await save(buildConfigForApply());
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    }
  }

  async function onPresetSelect(id: string) {
    setSelectedPresetId(id);
    if (!id || !draft) return;
    setPresetBusy(true);
    setInputError(null);
    try {
      const preset = await readPreset(id);
      if (!preset.config) return;
      const patch = preset.config;
      let merged: RuntimeConfig = {
        ...draft,
        ...patch,
        execution: {
          ...draft.execution,
          ...patch.execution,
        },
        universe: {
          ...draft.universe,
          ...patch.universe,
        },
        signals: {
          ...draft.signals,
          ...patch.signals,
          requireFundingSign: true,
        },
        paper: {
          ...draft.paper,
          ...patch.paper,
        },
      };
      const preferredUniverseName = preferredUniverseNameFromPreset(preset.name);
      const matchedUniverse = preferredUniverseName ? universeList.find((u) => u.name === preferredUniverseName) : undefined;
      if (matchedUniverse) {
        const uni = await readUniverse(matchedUniverse.id);
        merged = {
          ...merged,
          universe: {
            ...merged.universe,
            selectedId: uni.meta.id,
            symbols: [...uni.symbols],
          },
        };
        setSelectedUniverseId(matchedUniverse.id);
      }
      setDraft((prev) => {
        const base = prev ?? draft;
        return {
          ...base,
          ...patch,
          execution: {
            ...base.execution,
            ...patch.execution,
          },
          universe: {
            ...merged.universe,
          },
          signals: {
            ...base.signals,
            ...patch.signals,
            requireFundingSign: true,
          },
          paper: {
            ...base.paper,
            ...patch.paper,
          },
        };
      });
      setNumericDraft(toNumericDraft(merged));
      onDraftKlineTfMinChange?.(Number(merged.universe.klineTfMin));
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onPresetSave() {
    if (!selectedPresetId) {
      setInputError("Select a preset to save.");
      return;
    }
    setPresetBusy(true);
    setInputError(null);
    try {
      const cfg = buildConfigForApply();
      const selected = presets.find((p) => p.id === selectedPresetId);
      await savePreset(selectedPresetId, selected?.name ?? selectedPresetId, cfg);
      await refreshPresets();
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onPresetNew() {
    if (!draft || !numericDraft) return;
    const rawName = window.prompt("Preset name", "");
    const name = String(rawName ?? "").trim();
    if (!name) {
      setInputError("Preset name is required.");
      return;
    }
    setPresetBusy(true);
    setInputError(null);
    try {
      const cfg = buildConfigForApply();
      const nextId = `preset-${Date.now()}`;
      await savePreset(nextId, name, cfg);
      await refreshPresets();
      setSelectedPresetId(nextId);
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onPresetRemove() {
    if (!selectedPresetId) {
      setInputError("Select a preset to remove.");
      return;
    }
    setPresetBusy(true);
    setInputError(null);
    try {
      await deletePreset(selectedPresetId);
      setSelectedPresetId("");
      await refreshPresets();
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Config</b>
        {badge}

        {appliedHint ? (
          <span style={{ opacity: 0.8, fontSize: 12 }}>
            applied: {appliedHint}
            {lastSavedAt ? ` at ${fmtTime(lastSavedAt)}` : ""}
          </span>
        ) : null}

        <div className="ms-auto d-flex align-items-center gap-2">
          <Button size="sm" variant="success" onClick={() => void onApply()} disabled={applyDisabled || rebooting}>
            Apply
          </Button>
        </div>
      </Card.Header>

      <Card.Body>
        {!draft || !numericDraft ? (
          <div style={{ opacity: 0.8 }}>Loading config...</div>
        ) : (
          <>
            {universeError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{universeError}</div> : null}
            {inputError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{inputError}</div> : null}

            <Row className="g-2 mb-3">
              <Col xs={12}>
                <Form.Label>Preset</Form.Label>
                <div className="d-flex align-items-center gap-2">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Form.Select value={selectedPresetId} onChange={(e) => void onPresetSelect(e.currentTarget.value)} disabled={presetBusy}>
                      <option value="">Select preset...</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} [tf={presetTfById[p.id] ?? 1}m]</option>
                      ))}
                    </Form.Select>
                  </div>
                  <div className="d-flex align-items-center gap-2 ms-auto">
                    <Button size="sm" variant="outline-primary" onClick={() => void onPresetSave()} disabled={presetBusy}>Save</Button>
                    <Button size="sm" variant="outline-danger" onClick={() => void onPresetRemove()} disabled={presetBusy || selectedPresetId === "default"}>Delete</Button>
                    <Button size="sm" variant="outline-secondary" onClick={() => void onPresetNew()} disabled={presetBusy}>New</Button>
                  </div>
                </div>
                <Form.Text muted>Select a saved parameter set to load into the form.</Form.Text>
              </Col>
            </Row>

            <Row className="g-3">
              <Col lg={4}>
                <Card className="h-100">
                  <Card.Body>
                    <h6 className="mb-3">Universe</h6>
                    <Form.Group className="mb-3">
                      <Form.Label>Symbol set (saved)</Form.Label>
                      <Form.Select value={selectedUniverseId} onChange={(e) => void onUniverseSelect(e.currentTarget.value)} disabled={universeLocked || universeLoading}>
                        <option value="">Select set...</option>
                        {universeList.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.count})</option>)}
                      </Form.Select>
                      <Form.Text muted>Defines the list of trading symbols for the current session.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-0">
                      <Form.Label>Candle timeframe, min</Form.Label>
                      <Form.Select value={String(draft.universe.klineTfMin)} onChange={(e) => setDraft({ ...draft, universe: { ...draft.universe, klineTfMin: Number(e.currentTarget.value) } })}>
                        <option value={1}>1</option><option value={3}>3</option><option value={5}>5</option><option value={15}>15</option><option value={30}>30</option><option value={60}>60</option>
                      </Form.Select>
                      <Form.Text muted>Base candle interval used for signal calculations.</Form.Text>
                    </Form.Group>
                  </Card.Body>
                </Card>
              </Col>
              <Col lg={4}>
                <Card className="h-100">
                  <Card.Body>
                    <h6 className="mb-3">Signals</h6>
                    <Form.Group className="mb-3"><Form.Label>Price threshold, %</Form.Label><Form.Control type="number" step="0.001" value={numericDraft.signalsPriceThresholdPct} onChange={(e) => setNumericField("signalsPriceThresholdPct", e.currentTarget.value)} /><Form.Text muted>Minimum relative price move required to trigger a signal.</Form.Text></Form.Group>
                    <Form.Group className="mb-3"><Form.Label>OI threshold, %</Form.Label><Form.Control type="number" step="0.001" value={numericDraft.signalsOivThresholdPct} onChange={(e) => setNumericField("signalsOivThresholdPct", e.currentTarget.value)} /><Form.Text muted>Minimum open-interest change required to confirm a signal.</Form.Text></Form.Group>
                    <Form.Group className="mb-3"><Form.Label>Min triggers per day</Form.Label><Form.Control type="number" step="1" min={1} value={numericDraft.signalsDailyTriggerMin} onChange={(e) => setNumericField("signalsDailyTriggerMin", e.currentTarget.value)} /><Form.Text muted>Lower bound for daily signal count.</Form.Text></Form.Group>
                    <Form.Group className="mb-0"><Form.Label>Max triggers per day</Form.Label><Form.Control type="number" step="1" min={1} value={numericDraft.signalsDailyTriggerMax} onChange={(e) => setNumericField("signalsDailyTriggerMax", e.currentTarget.value)} /><Form.Text muted>Upper bound for daily signal count.</Form.Text></Form.Group>
                  </Card.Body>
                </Card>
              </Col>
              <Col lg={4}>
                <Card className="h-100">
                  <Card.Body>
                    <h6 className="mb-3">Execution mode and funding pause</h6>
                    <Form.Group className="mb-3">
                      <Form.Label>Execution mode</Form.Label>
                      <div className="d-flex align-items-center gap-2">
                        <Form.Select value={draft.execution?.mode ?? "paper"} onChange={(e) => setDraft({ ...draft, execution: { ...draft.execution, mode: e.currentTarget.value as "paper" | "demo" | "empty" } })}>
                          <option value="paper">Paper</option>
                          <option value="demo">Demo</option>
                          <option value="empty">No entries</option>
                        </Form.Select>
                        <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {isDemoMode
                            ? `keys ${doctorLoading ? "..." : doctorStatus?.demoKeysPresent ? "ok" : "x"} | auth ${doctorLoading ? "..." : doctorStatus?.demoAuthOk ? "ok" : "x"}`
                            : "keys - | auth -"}
                        </span>
                        <Button size="sm" variant="outline-secondary" onClick={() => void loadDoctor()} disabled={doctorLoading || !isDemoMode}>
                          Check
                        </Button>
                      </div>
                      <Form.Text muted>Selects order execution type: simulation, demo, or disabled entries.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3"><Form.Label>Minutes before funding</Form.Label><Form.Control type="number" step="1" value={numericDraft.fundingBeforeMin} onChange={(e) => setNumericField("fundingBeforeMin", e.currentTarget.value)} /><Form.Text muted>How many minutes before funding to block new entries.</Form.Text></Form.Group>
                    <Form.Group className="mb-0"><Form.Label>Minutes after funding</Form.Label><Form.Control type="number" step="1" value={numericDraft.fundingAfterMin} onChange={(e) => setNumericField("fundingAfterMin", e.currentTarget.value)} /><Form.Text muted>How many minutes after funding to keep entries paused.</Form.Text></Form.Group>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
            <Card className="mt-3">
              <Card.Body>
                <h6 className="mb-3">Order Settings</h6>
                <Row className="g-3 mt-0">
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Margin per trade, USDT</Form.Label>
                      <Form.Control type="number" step="1" value={numericDraft.paperMarginUSDT} onChange={(e) => setNumericField("paperMarginUSDT", e.currentTarget.value)} />
                      <Form.Text muted>Capital allocated to a single position.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Leverage</Form.Label>
                      <Form.Control type="number" step="1" value={numericDraft.paperLeverage} onChange={(e) => setNumericField("paperLeverage", e.currentTarget.value)} />
                      <Form.Text muted>Leverage multiplier used for position sizing.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Take-profit, % ROI</Form.Label>
                      <Form.Control type="number" step="0.1" value={numericDraft.paperTpRoiPct} onChange={(e) => setNumericField("paperTpRoiPct", e.currentTarget.value)} />
                      <Form.Text muted>Target return used to close in profit.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Stop-loss, % ROI</Form.Label>
                      <Form.Control type="number" step="0.1" value={numericDraft.paperSlRoiPct} onChange={(e) => setNumericField("paperSlRoiPct", e.currentTarget.value)} />
                      <Form.Text muted>Maximum loss threshold used for protective exit.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-0">
                      <Form.Label>Max daily loss, USDT</Form.Label>
                      <Form.Control type="number" step="1" min={0} value={numericDraft.paperMaxDailyLossUSDT} onChange={(e) => setNumericField("paperMaxDailyLossUSDT", e.currentTarget.value)} />
                      <Form.Text muted>New entries are blocked after this daily loss limit is reached.</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Direction</Form.Label>
                      <Form.Select id="paperDirectionMode" value={draft.paper.directionMode} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, directionMode: e.currentTarget.value as "both" | "long" | "short" } })}>
                        <option value="both">Both directions</option>
                        <option value="long">Long only</option>
                        <option value="short">Short only</option>
                      </Form.Select>
                      <Form.Text muted>Allowed entry direction for this strategy.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Entry offset, %</Form.Label>
                      <Form.Control type="number" step="0.01" value={numericDraft.paperEntryOffsetPct} onChange={(e) => setNumericField("paperEntryOffsetPct", e.currentTarget.value)} />
                      <Form.Text muted>Limit-entry distance from the current price.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Entry timeout, min</Form.Label>
                      <Form.Control type="number" step="1" min={1} value={String(timeoutSecToMin(numericDraft.paperEntryTimeoutSec))} onChange={(e) => setNumericField("paperEntryTimeoutSec", timeoutMinToSec(e.currentTarget.value))} />
                      <Form.Text muted>Minutes after which an unfilled entry order is cancelled.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Rearm delay, sec</Form.Label>
                      <Form.Control type="number" step="1" value={numericDraft.paperRearmSec} onChange={(e) => setNumericField("paperRearmSec", e.currentTarget.value)} />
                      <Form.Text muted>Cooldown between trade completion and the next possible entry.</Form.Text>
                    </Form.Group>
                    <Form.Group className="mb-0">
                      <Form.Label>Trading fee model</Form.Label>
                      <div style={{ fontSize: 14, padding: "6px 0" }}>
                        Maker fee fixed: <b>0.02%</b> per side (VIP 0, Bybit Futures).
                      </div>
                      <Form.Text muted>Passive entry and passive TP/SL exit are modeled with maker fee. Round-trip cost is 0.04% of position notional; taker applies if an order removes liquidity.</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <Form.Check className="mt-3" type="switch" id="applyFunding" label="Apply funding" checked={draft.paper.applyFunding} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, applyFunding: e.currentTarget.checked } })} />
                <Form.Text muted>Includes funding impact in financial result calculations.</Form.Text>
              </Card.Body>
            </Card>
</>
        )}
      </Card.Body>
    </Card>
  );
}

