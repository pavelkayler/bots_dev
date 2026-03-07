import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Row } from "react-bootstrap";
import type { SessionState } from "../../shared/types/domain";
import { useRuntimeConfig } from "../../features/config/hooks/useRuntimeConfig";

type Props = {
  sessionState?: SessionState;
};

type NumericDraft = {
  priceThresholdPct: string;
  oivThresholdPct: string;
  dailyTriggerMin: string;
  dailyTriggerMax: string;
  klineTfMin: string;
  fundingBeforeMin: string;
  fundingAfterMin: string;
  requireFundingSign: boolean;
};

function toDraft(config: any): NumericDraft {
  return {
    priceThresholdPct: String(config?.botConfig?.signals?.priceThresholdPct ?? 0.3),
    oivThresholdPct: String(config?.botConfig?.signals?.oivThresholdPct ?? 0.3),
    dailyTriggerMin: String(config?.botConfig?.signals?.dailyTriggerMin ?? 1),
    dailyTriggerMax: String(config?.botConfig?.signals?.dailyTriggerMax ?? 999),
    klineTfMin: String(config?.botConfig?.strategy?.klineTfMin ?? 1),
    fundingBeforeMin: String(config?.botConfig?.fundingCooldown?.beforeMin ?? 5),
    fundingAfterMin: String(config?.botConfig?.fundingCooldown?.afterMin ?? 5),
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

function asInt(text: string, label: string, min: number): number {
  const n = Math.floor(asNum(text, label, min));
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a valid integer.`);
  }
  return n;
}

export function SignalBotSettingsPanel({ sessionState }: Props) {
  const { draft, setDraft, save, saving, error, dirty } = useRuntimeConfig();
  const [form, setForm] = useState<NumericDraft | null>(null);
  const [inputError, setInputError] = useState<string>("");

  useEffect(() => {
    if (!draft) return;
    setForm(toDraft(draft));
  }, [draft]);

  const disabled = !draft || !form || saving;
  const canApply = useMemo(() => !disabled && (dirty || Boolean(inputError) === false), [disabled, dirty, inputError]);

  function setField<K extends keyof NumericDraft>(key: K, value: NumericDraft[K]) {
    if (!form) return;
    setInputError("");
    setForm({ ...form, [key]: value });
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
      const fundingBeforeMin = asInt(form.fundingBeforeMin, "Minutes before funding", 0);
      const fundingAfterMin = asInt(form.fundingAfterMin, "Minutes after funding", 0);
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
          fundingCooldown: {
            beforeMin: fundingBeforeMin,
            afterMin: fundingAfterMin,
          },
          strategy: {
            ...draft.botConfig?.strategy,
            klineTfMin: Math.floor(asNum(form.klineTfMin, "Signal candle tf", 1)),
          },
        },
      };
      setDraft(nextDraft as any);
      await save(nextDraft as any);
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    }
  }

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <b>Signal Bot Settings</b>
        <Button size="sm" onClick={() => void onApply()} disabled={!canApply}>
          Apply
        </Button>
      </Card.Header>
      <Card.Body>
        {error ? <Alert variant="danger" className="py-2">{error}</Alert> : null}
        {inputError ? <Alert variant="warning" className="py-2">{inputError}</Alert> : null}
        <Row className="g-2">
          <Col md={4} xs={12}>
            <Form.Group>
              <Form.Label>Price threshold, %</Form.Label>
              <Form.Control value={form?.priceThresholdPct ?? ""} onChange={(e) => setField("priceThresholdPct", e.currentTarget.value)} disabled={disabled} />
            </Form.Group>
          </Col>
          <Col md={4} xs={12}>
            <Form.Group>
              <Form.Label>OI threshold, %</Form.Label>
              <Form.Control value={form?.oivThresholdPct ?? ""} onChange={(e) => setField("oivThresholdPct", e.currentTarget.value)} disabled={disabled} />
            </Form.Group>
          </Col>
          <Col md={4} xs={12}>
            <Form.Group>
              <Form.Label>Signal candle tf, min</Form.Label>
              <Form.Control value={form?.klineTfMin ?? ""} onChange={(e) => setField("klineTfMin", e.currentTarget.value)} disabled={disabled || sessionState === "RUNNING"} />
            </Form.Group>
          </Col>
          <Col md={6} xs={12}>
            <Form.Group>
              <Form.Label>Min triggers/day</Form.Label>
              <Form.Control value={form?.dailyTriggerMin ?? ""} onChange={(e) => setField("dailyTriggerMin", e.currentTarget.value)} disabled={disabled} />
            </Form.Group>
          </Col>
          <Col md={6} xs={12}>
            <Form.Group>
              <Form.Label>Max triggers/day</Form.Label>
              <Form.Control value={form?.dailyTriggerMax ?? ""} onChange={(e) => setField("dailyTriggerMax", e.currentTarget.value)} disabled={disabled} />
            </Form.Group>
          </Col>
          <Col md={4} xs={12}>
            <Form.Group>
              <Form.Label>Minutes before funding</Form.Label>
              <Form.Control value={form?.fundingBeforeMin ?? ""} onChange={(e) => setField("fundingBeforeMin", e.currentTarget.value)} disabled={disabled} />
            </Form.Group>
          </Col>
          <Col md={4} xs={12}>
            <Form.Group>
              <Form.Label>Minutes after funding</Form.Label>
              <Form.Control value={form?.fundingAfterMin ?? ""} onChange={(e) => setField("fundingAfterMin", e.currentTarget.value)} disabled={disabled} />
            </Form.Group>
          </Col>
          <Col md={4} xs={12}>
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
      </Card.Body>
    </Card>
  );
}
