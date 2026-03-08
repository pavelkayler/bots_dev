import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Row } from "react-bootstrap";
import type { SessionState } from "../../shared/types/domain";
import { useRuntimeConfig } from "../../features/config/hooks/useRuntimeConfig";
import { usePersistentState } from "../../shared/hooks/usePersistentState";

const SIGNAL_BOT_ID = "signal-multi-factor-v1";
const SIGNAL_BOT_SETTINGS_DRAFT_KEY = "signalbot.settings.draft";

type Props = {
  sessionState?: SessionState;
};

type NumericDraft = {
  priceThresholdPct: string;
  oivThresholdPct: string;
  dailyTriggerMin: string;
  dailyTriggerMax: string;
  klineTfMin: string;
  requireFundingSign: boolean;
};

function toDraft(config: any): NumericDraft {
  return {
    priceThresholdPct: String(config?.botConfig?.signals?.priceThresholdPct ?? 0.3),
    oivThresholdPct: String(config?.botConfig?.signals?.oivThresholdPct ?? 0.3),
    dailyTriggerMin: String(config?.botConfig?.signals?.dailyTriggerMin ?? 1),
    dailyTriggerMax: String(config?.botConfig?.signals?.dailyTriggerMax ?? 999),
    klineTfMin: String(config?.botConfig?.strategy?.klineTfMin ?? 1),
    requireFundingSign: Boolean(config?.botConfig?.signals?.requireFundingSign ?? true),
  };
}

function asNum(text: string, label: string, min: number): number {
  const n = Number(text);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${label} must be >= ${min}.`);
  }
  return n;
}

export function SignalBotSettingsPanel({ sessionState }: Props) {
  const { draft, setDraft, save, saving, error, dirty } = useRuntimeConfig({ selectedBotId: SIGNAL_BOT_ID });
  const [form, setForm] = useState<NumericDraft | null>(null);
  const [persistedForm, setPersistedForm] = usePersistentState<NumericDraft | null>(SIGNAL_BOT_SETTINGS_DRAFT_KEY, null);
  const [inputError, setInputError] = useState<string>("");

  useEffect(() => {
    if (!draft) return;
    setForm(persistedForm ?? toDraft(draft));
  }, [draft, persistedForm]);

  const disabled = !draft || !form || saving;
  const canApply = useMemo(() => !disabled && (dirty || Boolean(inputError) === false), [disabled, dirty, inputError]);

  function setField<K extends keyof NumericDraft>(key: K, value: NumericDraft[K]) {
    if (!form) return;
    setInputError("");
    const nextForm = { ...form, [key]: value };
    setForm(nextForm);
    setPersistedForm(nextForm);
  }

  async function onApply() {
    if (!draft || !form) return;
    setInputError("");
    try {
      const dailyMin = Math.floor(asNum(form.dailyTriggerMin, "Min triggers/day", 1));
      const dailyMax = Math.floor(asNum(form.dailyTriggerMax, "Max triggers/day", 1));
      if (dailyMax < dailyMin) {
        throw new Error("Max triggers/day must be >= Min triggers/day.");
      }
      const nextDraft = {
        ...draft,
        universe: {
          ...draft.universe,
          klineTfMin: Math.floor(asNum(form.klineTfMin, "Signal candle tf", 1)),
        },
        botConfig: {
          ...draft.botConfig,
          signals: {
            ...draft.botConfig?.signals,
            priceThresholdPct: asNum(form.priceThresholdPct, "Price threshold", 0),
            oivThresholdPct: asNum(form.oivThresholdPct, "OI threshold", 0),
            dailyTriggerMin: dailyMin,
            dailyTriggerMax: dailyMax,
            requireFundingSign: Boolean(form.requireFundingSign),
          },
          strategy: {
            ...draft.botConfig?.strategy,
            klineTfMin: Math.floor(asNum(form.klineTfMin, "Signal candle tf", 1)),
          },
        },
      };
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
      {error ? <Alert variant="danger" className="py-2">{error}</Alert> : null}
      {inputError ? <Alert variant="warning" className="py-2">{inputError}</Alert> : null}
      <Row className="g-2">
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Price threshold, %</Form.Label>
            <Form.Control value={form?.priceThresholdPct ?? ""} onChange={(e) => setField("priceThresholdPct", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>OI threshold, %</Form.Label>
            <Form.Control value={form?.oivThresholdPct ?? ""} onChange={(e) => setField("oivThresholdPct", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Signal candle tf, min</Form.Label>
            <Form.Control value={form?.klineTfMin ?? ""} onChange={(e) => setField("klineTfMin", e.currentTarget.value)} disabled={disabled || sessionState === "RUNNING"} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Min triggers/day</Form.Label>
            <Form.Control value={form?.dailyTriggerMin ?? ""} onChange={(e) => setField("dailyTriggerMin", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Max triggers/day</Form.Label>
            <Form.Control value={form?.dailyTriggerMax ?? ""} onChange={(e) => setField("dailyTriggerMax", e.currentTarget.value)} disabled={disabled} />
          </Form.Group>
        </Col>
        <Col xl={3} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label>Require funding sign</Form.Label>
            <Form.Select
              value={form?.requireFundingSign ? "yes" : "no"}
              onChange={(e) => setField("requireFundingSign", e.currentTarget.value === "yes" ? true : false)}
              disabled={disabled}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>
    </div>
  );
}
