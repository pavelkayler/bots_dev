import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Row } from "react-bootstrap";
import {
  deleteBotPreset,
  listBotPresets,
  readBotPreset,
  saveBotPreset,
  saveConfigSelections,
  type BotPresetMeta,
} from "../../features/bots/api";
import { useRuntimeConfig } from "../../features/config/hooks/useRuntimeConfig";
import { usePersistentState } from "../../shared/hooks/usePersistentState";
import type { SessionState } from "../../shared/types/domain";

const SIGNAL_BOT_ID = "signal-multi-factor-v1";
const SIGNAL_BOT_SETTINGS_DRAFT_KEY = "signalbot.settings.draft";

type Props = {
  sessionState?: SessionState;
};

type NumericDraft = {
  signalTfMin: string;
  lookbackCandles: string;
  cooldownCandles: string;
  priceMovePct: string;
  oiMovePct: string;
  cvdMoveThreshold: string;
  requireCvdDivergence: boolean;
  requireFundingExtreme: boolean;
  fundingMinAbsPct: string;
  minTriggersPerDay: string;
  maxTriggersPerDay: string;
  minBarsBetweenSignals: string;
};

function toDraft(config: any): NumericDraft {
  return {
    signalTfMin: String(config?.botConfig?.strategy?.signalTfMin ?? config?.botConfig?.strategy?.klineTfMin ?? 1),
    lookbackCandles: String(config?.botConfig?.strategy?.lookbackCandles ?? 3),
    cooldownCandles: String(config?.botConfig?.strategy?.cooldownCandles ?? 1),
    priceMovePct: String(config?.botConfig?.signals?.priceMovePct ?? 0.3),
    oiMovePct: String(config?.botConfig?.signals?.oiMovePct ?? 0.3),
    cvdMoveThreshold: String(config?.botConfig?.signals?.cvdMoveThreshold ?? 0.1),
    requireCvdDivergence: Boolean(config?.botConfig?.signals?.requireCvdDivergence ?? false),
    requireFundingExtreme: Boolean(config?.botConfig?.signals?.requireFundingExtreme ?? true),
    fundingMinAbsPct: String(config?.botConfig?.signals?.fundingMinAbsPct ?? 0.0001),
    minTriggersPerDay: String(config?.botConfig?.signals?.minTriggersPerDay ?? 1),
    maxTriggersPerDay: String(config?.botConfig?.signals?.maxTriggersPerDay ?? 999),
    minBarsBetweenSignals: String(config?.botConfig?.signals?.minBarsBetweenSignals ?? 1),
  };
}

function asNum(text: string, label: string, min: number): number {
  const n = Number(text);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${label} must be >= ${min}.`);
  }
  return n;
}

function buildConfig(draft: any, form: NumericDraft) {
  const minTriggersPerDay = Math.floor(asNum(form.minTriggersPerDay, "Min triggers/day", 1));
  const maxTriggersPerDay = Math.floor(asNum(form.maxTriggersPerDay, "Max triggers/day", 1));
  if (maxTriggersPerDay < minTriggersPerDay) {
    throw new Error("Max triggers/day must be >= Min triggers/day.");
  }
  const signalTfMin = Math.floor(asNum(form.signalTfMin, "Signal timeframe", 1));
  return {
    ...draft,
    universe: {
      ...draft.universe,
      klineTfMin: signalTfMin,
    },
    botConfig: {
      ...draft.botConfig,
      signals: {
        ...draft.botConfig?.signals,
        priceMovePct: asNum(form.priceMovePct, "Price move threshold", 0),
        oiMovePct: asNum(form.oiMovePct, "OI move threshold", 0),
        cvdMoveThreshold: asNum(form.cvdMoveThreshold, "CVD move threshold", 0),
        requireCvdDivergence: Boolean(form.requireCvdDivergence),
        requireFundingExtreme: Boolean(form.requireFundingExtreme),
        fundingMinAbsPct: asNum(form.fundingMinAbsPct, "Funding min abs", 0),
        minTriggersPerDay,
        maxTriggersPerDay,
        minBarsBetweenSignals: Math.floor(asNum(form.minBarsBetweenSignals, "Min bars between signals", 0)),
      },
      strategy: {
        ...draft.botConfig?.strategy,
        signalTfMin,
        lookbackCandles: Math.floor(asNum(form.lookbackCandles, "Lookback candles", 1)),
        cooldownCandles: Math.floor(asNum(form.cooldownCandles, "Cooldown candles", 0)),
      },
    },
  };
}

export function SignalBotSettingsPanel({ sessionState }: Props) {
  const { draft, setDraft, save, saving, error, dirty } = useRuntimeConfig({ selectedBotId: SIGNAL_BOT_ID });
  const [form, setForm] = useState<NumericDraft | null>(null);
  const [persistedForm, setPersistedForm] = usePersistentState<NumericDraft | null>(SIGNAL_BOT_SETTINGS_DRAFT_KEY, null);
  const [inputError, setInputError] = useState<string>("");
  const [presets, setPresets] = useState<BotPresetMeta[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetSaveMessage, setPresetSaveMessage] = useState<string | null>(null);
  const [lastPresetSavedFingerprint, setLastPresetSavedFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setForm(persistedForm ?? toDraft(draft));
  }, [draft, persistedForm]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await listBotPresets(SIGNAL_BOT_ID);
        if (!active) return;
        const items = res.presets ?? [];
        setPresets(items);
        const selectedFromConfig = String(draft?.selectedBotPresetId ?? "");
        const fallback = items.find((p) => p.id === "default")?.id ?? items[0]?.id ?? "";
        setSelectedPresetId(items.some((p) => p.id === selectedFromConfig) ? selectedFromConfig : fallback);
      } catch (e: any) {
        if (!active) return;
        setInputError(String(e?.message ?? e));
      }
    })();
    return () => {
      active = false;
    };
  }, [draft?.selectedBotPresetId]);

  useEffect(() => {
    if (!draft || !form) return;
    const scopedKey = `bots_dev.pendingConfigPatch.${SIGNAL_BOT_ID}`;
    const legacyKey = "bots_dev.pendingConfigPatch";
    const scopedRaw = localStorage.getItem(scopedKey);
    const raw = scopedRaw ?? localStorage.getItem(legacyKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as any;
      const patchBotId = String(parsed?.botId ?? "").trim();
      if (patchBotId && patchBotId !== SIGNAL_BOT_ID) return;
      const botConfigPatch = parsed?.patch?.botConfig;
      if (!botConfigPatch || typeof botConfigPatch !== "object") return;
      const merged = {
        ...draft,
        botConfig: {
          ...(draft.botConfig ?? {}),
          ...botConfigPatch,
          signals: {
            ...(draft.botConfig?.signals ?? {}),
            ...(botConfigPatch.signals ?? {}),
          },
          strategy: {
            ...(draft.botConfig?.strategy ?? {}),
            ...(botConfigPatch.strategy ?? {}),
          },
        },
      };
      const mergedForm = toDraft(merged);
      setForm(mergedForm);
      setPersistedForm(mergedForm);
      setDraft(merged as any);
      setPresetSaveMessage(null);
      setLastPresetSavedFingerprint(null);
    } catch {
      return;
    } finally {
      if (scopedRaw != null) {
        localStorage.removeItem(scopedKey);
      } else {
        localStorage.removeItem(legacyKey);
      }
    }
  }, [draft, form, setDraft, setPersistedForm]);

  const disabled = !draft || !form || saving || presetBusy;
  const canApply = useMemo(() => !disabled && (dirty || !inputError), [disabled, dirty, inputError]);
  const currentPresetFingerprint = useMemo(() => {
    if (!draft || !form) return null;
    try {
      return JSON.stringify(buildConfig(draft, form));
    } catch {
      return null;
    }
  }, [draft, form]);
  const savePresetDisabled = presetBusy
    || !selectedPresetId
    || !currentPresetFingerprint
    || currentPresetFingerprint === lastPresetSavedFingerprint;

  function setField<K extends keyof NumericDraft>(key: K, value: NumericDraft[K]) {
    if (!form) return;
    setInputError("");
    setPresetSaveMessage(null);
    setLastPresetSavedFingerprint(null);
    const nextForm = { ...form, [key]: value };
    setForm(nextForm);
    setPersistedForm(nextForm);
  }

  async function onPresetSelect(id: string) {
    setSelectedPresetId(id);
    setPresetSaveMessage(null);
    setLastPresetSavedFingerprint(null);
    if (!id || !draft) return;
    setPresetBusy(true);
    setInputError("");
    try {
      await saveConfigSelections({ selectedBotId: SIGNAL_BOT_ID, selectedBotPresetId: id });
      const preset = await readBotPreset(SIGNAL_BOT_ID, id);
      const merged = { ...draft, botConfig: preset.botConfig };
      const mergedForm = toDraft(merged);
      setForm(mergedForm);
      setPersistedForm(mergedForm);
      setDraft(merged as any);
      await save(merged as any);
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onPresetSave() {
    if (!selectedPresetId || !draft || !form) {
      setInputError("Select a preset to save.");
      return;
    }
    setPresetBusy(true);
    setInputError("");
    try {
      const cfg = buildConfig(draft, form);
      const selected = presets.find((p) => p.id === selectedPresetId);
      await saveBotPreset(SIGNAL_BOT_ID, selectedPresetId, selected?.name ?? selectedPresetId, cfg.botConfig);
      setLastPresetSavedFingerprint(JSON.stringify(cfg));
      setPresetSaveMessage("Preset saved.");
      const res = await listBotPresets(SIGNAL_BOT_ID);
      setPresets(res.presets ?? []);
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onPresetNew() {
    if (!draft || !form) return;
    const rawName = window.prompt("Preset name", "");
    const name = String(rawName ?? "").trim();
    if (!name) {
      setInputError("Preset name is required.");
      return;
    }
    setPresetBusy(true);
    setInputError("");
    try {
      const cfg = buildConfig(draft, form);
      const nextId = `preset-${Date.now()}`;
      await saveBotPreset(SIGNAL_BOT_ID, nextId, name, cfg.botConfig);
      await saveConfigSelections({ selectedBotId: SIGNAL_BOT_ID, selectedBotPresetId: nextId });
      const res = await listBotPresets(SIGNAL_BOT_ID);
      setPresets(res.presets ?? []);
      setSelectedPresetId(nextId);
      setLastPresetSavedFingerprint(JSON.stringify(cfg));
      setPresetSaveMessage("Preset saved.");
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onPresetDelete() {
    if (!selectedPresetId) return;
    setPresetBusy(true);
    setInputError("");
    try {
      await deleteBotPreset(SIGNAL_BOT_ID, selectedPresetId);
      const res = await listBotPresets(SIGNAL_BOT_ID);
      const items = res.presets ?? [];
      setPresets(items);
      const fallback = items.find((p) => p.id === "default")?.id ?? items[0]?.id ?? "";
      setSelectedPresetId(fallback);
      setLastPresetSavedFingerprint(null);
      setPresetSaveMessage(null);
      if (fallback) {
        await onPresetSelect(fallback);
      }
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function onApply() {
    if (!draft || !form) return;
    setInputError("");
    try {
      const nextDraft = buildConfig(draft, form);
      setPersistedForm(form);
      setDraft(nextDraft as any);
      await save(nextDraft as any);
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    }
  }

  return (
    <div className="mb-3">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <b>Signal Bot Settings</b>
        <Button size="sm" onClick={() => void onApply()} disabled={!canApply}>
          Apply
        </Button>
      </div>
      <Row className="g-2 mb-2">
        <Col xs={12}>
          <Form.Label>Preset</Form.Label>
          <div className="d-flex align-items-center gap-2">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Form.Select value={selectedPresetId} onChange={(e) => void onPresetSelect(e.currentTarget.value)} disabled={presetBusy}>
                <option value="">Select preset...</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Form.Select>
            </div>
            <Button size="sm" variant="outline-primary" onClick={() => void onPresetSave()} disabled={savePresetDisabled}>Save</Button>
            <Button size="sm" variant="outline-danger" onClick={() => void onPresetDelete()} disabled={presetBusy || !selectedPresetId || selectedPresetId === "default"}>Delete</Button>
            <Button size="sm" variant="outline-secondary" onClick={() => void onPresetNew()} disabled={presetBusy}>New</Button>
          </div>
          <Form.Text muted>Select a saved Signal Bot parameter set to load into the form.</Form.Text>
          {presetSaveMessage ? <div style={{ color: "#198754", fontSize: 12, marginTop: 4 }}>{presetSaveMessage}</div> : null}
        </Col>
      </Row>
      {error ? <Alert variant="danger" className="py-2">{error}</Alert> : null}
      {inputError ? <Alert variant="warning" className="py-2">{inputError}</Alert> : null}
      <Row className="g-2">
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Signal timeframe, min</Form.Label>
            <Form.Control value={form?.signalTfMin ?? ""} onChange={(e) => setField("signalTfMin", e.currentTarget.value)} disabled={disabled || sessionState === "RUNNING"} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Lookback candles</Form.Label>
            <Form.Control value={form?.lookbackCandles ?? ""} onChange={(e) => setField("lookbackCandles", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Cooldown candles</Form.Label>
            <Form.Control value={form?.cooldownCandles ?? ""} onChange={(e) => setField("cooldownCandles", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Price move threshold, %</Form.Label>
            <Form.Control value={form?.priceMovePct ?? ""} onChange={(e) => setField("priceMovePct", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>OI move threshold, %</Form.Label>
            <Form.Control value={form?.oiMovePct ?? ""} onChange={(e) => setField("oiMovePct", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>CVD move threshold</Form.Label>
            <Form.Control value={form?.cvdMoveThreshold ?? ""} onChange={(e) => setField("cvdMoveThreshold", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Require CVD divergence</Form.Label>
            <Form.Select
              value={form?.requireCvdDivergence ? "yes" : "no"}
              onChange={(e) => setField("requireCvdDivergence", e.currentTarget.value === "yes")}
              disabled={disabled}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Require funding extreme</Form.Label>
            <Form.Select
              value={form?.requireFundingExtreme ? "yes" : "no"}
              onChange={(e) => setField("requireFundingExtreme", e.currentTarget.value === "yes")}
              disabled={disabled}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Funding min abs, %</Form.Label>
            <Form.Control value={form?.fundingMinAbsPct ?? ""} onChange={(e) => setField("fundingMinAbsPct", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Min triggers/day</Form.Label>
            <Form.Control value={form?.minTriggersPerDay ?? ""} onChange={(e) => setField("minTriggersPerDay", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Max triggers/day</Form.Label>
            <Form.Control value={form?.maxTriggersPerDay ?? ""} onChange={(e) => setField("maxTriggersPerDay", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Min bars between signals</Form.Label>
            <Form.Control value={form?.minBarsBetweenSignals ?? ""} onChange={(e) => setField("minBarsBetweenSignals", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
      </Row>
    </div>
  );
}
