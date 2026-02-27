import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import type { RuntimeConfig, SessionState } from "../../../shared/types/domain";
import { useRuntimeConfig } from "../hooks/useRuntimeConfig";
import { fmtTime } from "../../../shared/utils/format";
import { listUniverses, readUniverse } from "../../universe/api";
import type { UniverseMeta } from "../../universe/types";
import { deletePreset, listPresets, readPreset, savePreset } from "../../presets/api";
import type { PresetMeta } from "../../presets/types";

type Props = {
  sessionState?: SessionState;
  rebooting?: boolean;
  onDraftKlineTfMinChange?: (klineTfMin: number) => void;
};



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
  paperRearmDelayMs: string;
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
    paperRearmDelayMs: String(cfg.paper.rearmDelayMs),
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

function validateDraft(draft: RuntimeConfig | null, numericDraft: NumericDraft | null): { ok: true; parsed: RuntimeConfig } | { ok: false } {
  if (!draft || !numericDraft) return { ok: false };
  try {
    const parsed: RuntimeConfig = {
      ...draft,
      signals: {
        ...draft.signals,
        priceThresholdPct: parseNumber(numericDraft.signalsPriceThresholdPct, "priceThresholdPct"),
        oivThresholdPct: parseNumber(numericDraft.signalsOivThresholdPct, "oivThresholdPct"),
        dailyTriggerMin: parseNumber(numericDraft.signalsDailyTriggerMin, "dailyTriggerMin"),
        dailyTriggerMax: parseNumber(numericDraft.signalsDailyTriggerMax, "dailyTriggerMax"),
        requireFundingSign: true,
      },
      fundingCooldown: {
        ...draft.fundingCooldown,
        beforeMin: parseNumber(numericDraft.fundingBeforeMin, "beforeMin"),
        afterMin: parseNumber(numericDraft.fundingAfterMin, "afterMin"),
      },
      paper: {
        ...draft.paper,
        marginUSDT: parseNumber(numericDraft.paperMarginUSDT, "marginUSDT"),
        leverage: parseNumber(numericDraft.paperLeverage, "leverage"),
        entryOffsetPct: parseNumber(numericDraft.paperEntryOffsetPct, "entryOffsetPct"),
        entryTimeoutSec: parseNumber(numericDraft.paperEntryTimeoutSec, "entryTimeoutSec"),
        tpRoiPct: parseNumber(numericDraft.paperTpRoiPct, "tpRoiPct"),
        slRoiPct: parseNumber(numericDraft.paperSlRoiPct, "slRoiPct"),
        makerFeeRate: parseNumber(numericDraft.paperMakerFeeRate, "makerFeeRate"),
        rearmDelayMs: parseNumber(numericDraft.paperRearmDelayMs, "rearmDelayMs"),
        maxDailyLossUSDT: parseNumber(numericDraft.paperMaxDailyLossUSDT, "maxDailyLossUSDT"),
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

  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);

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
      const res = await fetch("/api/doctor");
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
    void loadDoctor();
  }, [loadDoctor, draft?.execution.mode]);

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
          mode: (patch?.execution?.mode === "demo" ? "demo" : patch?.execution?.mode === "empty" ? "empty" : patch?.execution?.mode === "paper" ? "paper" : draft.execution.mode),
        },
        paper: {
          ...draft.paper,
          tpRoiPct: Number(patch?.paper?.tpRoiPct ?? draft.paper.tpRoiPct),
          slRoiPct: Number(patch?.paper?.slRoiPct ?? draft.paper.slRoiPct),
          entryOffsetPct: Number(patch?.paper?.entryOffsetPct ?? draft.paper.entryOffsetPct),
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
    if (!validation.ok) throw new Error("Config is not loaded.");
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
      let merged = {
        ...preset.config,
        universe: { ...draft.universe, ...preset.config.universe },
        signals: { ...draft.signals, ...preset.config.signals, requireFundingSign: true },
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
      setDraft(merged);
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
          <div style={{ opacity: 0.8 }}>Loading config…</div>
        ) : (
          <>
            {universeError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{universeError}</div> : null}
            {inputError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{inputError}</div> : null}

            <Row className="g-2 mb-3">
              <Col md={8}>
                <Form.Label>Preset</Form.Label>
                <Form.Select value={selectedPresetId} onChange={(e) => void onPresetSelect(e.currentTarget.value)} disabled={presetBusy}>
                  <option value="">Select preset…</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} [tf={presetTfById[p.id] ?? 1}m]</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={4} className="d-flex align-items-end gap-2">
                <Button size="sm" variant="outline-danger" onClick={() => void onPresetRemove()} disabled={presetBusy}>Remove</Button>
                <Button size="sm" variant="outline-primary" onClick={() => void onPresetSave()} disabled={presetBusy}>Save</Button>
              </Col>
            </Row>

            <Row className="g-3">
              <Col md={4}>
                <h6>Universe</h6>
                <Form.Group className="mb-2">
                  <Form.Label>Universe (saved sets)</Form.Label>
                  <Form.Select value={selectedUniverseId} onChange={(e) => void onUniverseSelect(e.currentTarget.value)} disabled={universeLocked || universeLoading}>
                    <option value="">Select universe…</option>
                    {universeList.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.count})</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group className="mb-2">
                  <Form.Label>klineTfMin</Form.Label>
                  <Form.Select value={String(draft.universe.klineTfMin)} onChange={(e) => setDraft({ ...draft, universe: { ...draft.universe, klineTfMin: Number(e.currentTarget.value) } })}>
                    <option value={1}>1</option><option value={3}>3</option><option value={5}>5</option><option value={15}>15</option><option value={30}>30</option><option value={60}>60</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={4}>
                <h6>Signals</h6>
                <Form.Group className="mb-2"><Form.Label>priceThresholdPct</Form.Label><Form.Control type="number" step="0.001" value={numericDraft.signalsPriceThresholdPct} onChange={(e) => setNumericField("signalsPriceThresholdPct", e.currentTarget.value)} /></Form.Group>
                <Form.Group className="mb-2"><Form.Label>oivThresholdPct</Form.Label><Form.Control type="number" step="0.001" value={numericDraft.signalsOivThresholdPct} onChange={(e) => setNumericField("signalsOivThresholdPct", e.currentTarget.value)} /></Form.Group>
                <Form.Group className="mb-2"><Form.Label>dailyTriggerMin</Form.Label><Form.Control type="number" step="1" min={1} value={numericDraft.signalsDailyTriggerMin} onChange={(e) => setNumericField("signalsDailyTriggerMin", e.currentTarget.value)} /></Form.Group>
                <Form.Group className="mb-2"><Form.Label>dailyTriggerMax</Form.Label><Form.Control type="number" step="1" min={1} value={numericDraft.signalsDailyTriggerMax} onChange={(e) => setNumericField("signalsDailyTriggerMax", e.currentTarget.value)} /></Form.Group>
              </Col>

              <Col md={4}>
                <h6>Funding cooldown</h6>
                <Form.Group className="mb-2">
                  <Form.Label>Execution mode</Form.Label>
                  <div className="d-flex align-items-center gap-2">
                    <Form.Select value={draft.execution.mode} onChange={(e) => setDraft({ ...draft, execution: { mode: e.currentTarget.value as "paper" | "demo" | "empty" } })}>
                      <option value="paper">Paper</option>
                      <option value="demo">Demo</option>
                      <option value="empty">Empty (tape only)</option>
                    </Form.Select>
                    <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      keys {doctorLoading ? "…" : doctorStatus?.demoKeysPresent ? "✅" : "❌"} · auth {doctorLoading ? "…" : doctorStatus?.demoAuthOk ? "✅" : "❌"}
                    </span>
                  </div>
                </Form.Group>
                <Form.Group className="mb-2"><Form.Label>beforeMin</Form.Label><Form.Control type="number" step="1" value={numericDraft.fundingBeforeMin} onChange={(e) => setNumericField("fundingBeforeMin", e.currentTarget.value)} /></Form.Group>
                <Form.Group className="mb-2"><Form.Label>afterMin</Form.Label><Form.Control type="number" step="1" value={numericDraft.fundingAfterMin} onChange={(e) => setNumericField("fundingAfterMin", e.currentTarget.value)} /></Form.Group>

                <Card className="mt-2 mb-2">
                  <Card.Body style={{ padding: 12 }}>
                    <h6 className="mb-1">Demo settings{draft.execution.mode === "demo" ? "" : " (inactive)"}</h6>
                    <div style={{ fontSize: 12 }}>Demo keys are read from backend env.</div>
                    {draft.execution.mode === "empty" ? <div style={{ fontSize: 12 }}>Empty mode records tapes only and does not trade.</div> : null}
                    <div style={{ fontSize: 12 }}>demoKeysPresent: <b>{doctorStatus?.demoKeysPresent ? "✅" : "❌"}</b> · demoAuthOk: <b>{doctorStatus?.demoAuthOk ? "✅" : "❌"}</b></div>
                  </Card.Body>
                </Card>

                <Card className="mt-2">
                  <Card.Body style={{ padding: 12 }}>
                    <h6 className="mb-0">Paper settings{draft.execution.mode === "demo" ? " (inactive in Demo mode)" : ""}</h6>
                    <div className="mt-2 d-flex align-items-center gap-3">
                      <Form.Group className="mb-0"><Form.Label className="mb-1">Direction</Form.Label><Form.Select id="paperDirectionMode" size="sm" value={draft.paper.directionMode} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, directionMode: e.currentTarget.value as "both" | "long" | "short" } })}><option value="both">Both directions</option><option value="long">Long only</option><option value="short">Short only</option></Form.Select></Form.Group>
                    </div>
                    <Row className="g-2 mt-1"><Col><Form.Label>marginUSDT</Form.Label><Form.Control type="number" step="1" value={numericDraft.paperMarginUSDT} onChange={(e) => setNumericField("paperMarginUSDT", e.currentTarget.value)} /></Col><Col><Form.Label>leverage</Form.Label><Form.Control type="number" step="1" value={numericDraft.paperLeverage} onChange={(e) => setNumericField("paperLeverage", e.currentTarget.value)} /></Col></Row>
                    <Row className="g-2 mt-1"><Col><Form.Label>entryOffsetPct</Form.Label><Form.Control type="number" step="0.01" value={numericDraft.paperEntryOffsetPct} onChange={(e) => setNumericField("paperEntryOffsetPct", e.currentTarget.value)} /></Col><Col><Form.Label>entryTimeoutSec</Form.Label><Form.Control type="number" step="1" value={numericDraft.paperEntryTimeoutSec} onChange={(e) => setNumericField("paperEntryTimeoutSec", e.currentTarget.value)} /></Col></Row>
                    <Row className="g-2 mt-1"><Col><Form.Label>tpRoiPct</Form.Label><Form.Control type="number" step="0.1" value={numericDraft.paperTpRoiPct} onChange={(e) => setNumericField("paperTpRoiPct", e.currentTarget.value)} /></Col><Col><Form.Label>slRoiPct</Form.Label><Form.Control type="number" step="0.1" value={numericDraft.paperSlRoiPct} onChange={(e) => setNumericField("paperSlRoiPct", e.currentTarget.value)} /></Col></Row>
                    <Row className="g-2 mt-1"><Col><Form.Label>makerFeeRate</Form.Label><Form.Control type="number" step="0.0001" value={numericDraft.paperMakerFeeRate} onChange={(e) => setNumericField("paperMakerFeeRate", e.currentTarget.value)} /></Col><Col><Form.Label>rearmDelayMs</Form.Label><Form.Control type="number" step="100" value={numericDraft.paperRearmDelayMs} onChange={(e) => setNumericField("paperRearmDelayMs", e.currentTarget.value)} /></Col></Row>
                    <Form.Group className="mt-1"><Form.Label>maxDailyLossUSDT</Form.Label><Form.Control type="number" step="1" min={0} value={numericDraft.paperMaxDailyLossUSDT} onChange={(e) => setNumericField("paperMaxDailyLossUSDT", e.currentTarget.value)} /></Form.Group>
                    <Form.Check className="mt-2" type="switch" id="applyFunding" label="applyFunding" checked={draft.paper.applyFunding} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, applyFunding: e.currentTarget.checked } })} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Card.Body>
    </Card>
  );
}
