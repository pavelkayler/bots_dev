import { useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { useRuntimeConfig } from "../hooks/useRuntimeConfig";
import { BotExecutionSelectors } from "../../bots/components/BotExecutionSelectors";

const MAKER_FEE_RATE_FIXED = 0.0002;

export function ExecutionPanel() {
  const { draft, setDraft, error, saving, dirty, save } = useRuntimeConfig();
  const [inputError, setInputError] = useState<string | null>(null);

  const canApply = useMemo(() => {
    return Boolean(draft) && dirty && !saving;
  }, [draft, dirty, saving]);

  async function onApply() {
    if (!draft) return;
    setInputError(null);
    try {
      const mergedRiskLimits = {
        maxTradesPerDay: draft.executionProfile?.riskLimits?.maxTradesPerDay ?? draft.riskLimits?.maxTradesPerDay ?? 2,
        maxLossPerDayUsdt: draft.executionProfile?.riskLimits?.maxLossPerDayUsdt ?? draft.riskLimits?.maxLossPerDayUsdt ?? null,
        maxLossPerSessionUsdt: draft.executionProfile?.riskLimits?.maxLossPerSessionUsdt ?? draft.riskLimits?.maxLossPerSessionUsdt ?? null,
        maxConsecutiveErrors: draft.executionProfile?.riskLimits?.maxConsecutiveErrors ?? draft.riskLimits?.maxConsecutiveErrors ?? 10,
      };
      await save({
        ...draft,
        execution: draft.execution,
        riskLimits: mergedRiskLimits,
        executionProfile: {
          ...(draft.executionProfile ?? {
            execution: draft.execution,
            paper: {
              enabled: draft.paper.enabled,
              directionMode: draft.paper.directionMode,
              marginUSDT: draft.paper.marginUSDT,
              leverage: draft.paper.leverage,
              makerFeeRate: draft.paper.makerFeeRate,
              maxDailyLossUSDT: draft.paper.maxDailyLossUSDT,
            },
            riskLimits: mergedRiskLimits,
          }),
          riskLimits: mergedRiskLimits,
        },
        paper: {
          ...draft.paper,
          enabled: draft.paper.enabled,
          directionMode: draft.paper.directionMode,
          marginUSDT: draft.paper.marginUSDT,
          leverage: draft.paper.leverage,
          makerFeeRate: MAKER_FEE_RATE_FIXED,
          maxDailyLossUSDT: draft.paper.maxDailyLossUSDT,
          entryOffsetPct: draft.paper.entryOffsetPct,
          entryTimeoutSec: draft.paper.entryTimeoutSec,
          tpRoiPct: draft.paper.tpRoiPct,
          slRoiPct: draft.paper.slRoiPct,
          rearmDelayMs: draft.paper.rearmDelayMs,
          applyFunding: draft.paper.applyFunding,
        },
      });
    } catch (e: any) {
      setInputError(String(e?.message ?? e));
    }
  }

  if (!draft) {
    return (
      <Card className="mb-3">
        <Card.Header><b>Execution Profile</b></Card.Header>
        <Card.Body>Loading...</Card.Body>
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2">
        <b>Execution Profile</b>
        {saving ? <Badge bg="warning">saving...</Badge> : dirty ? <Badge bg="primary">modified</Badge> : <Badge bg="secondary">clean</Badge>}
        <div className="ms-auto">
          <Button size="sm" variant="success" disabled={!canApply} onClick={() => void onApply()}>Apply</Button>
        </div>
      </Card.Header>
      <Card.Body>
        {error ? <div style={{ color: "#b00020", marginBottom: 8 }}>{error}</div> : null}
        {inputError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{inputError}</div> : null}
        <div className="mb-3">
          <BotExecutionSelectors compact />
        </div>
        <Row className="g-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Execution mode</Form.Label>
              <Form.Select value={draft.execution.mode} onChange={(e) => setDraft({ ...draft, execution: { ...draft.execution, mode: e.currentTarget.value as "paper" | "demo" | "empty" } })}>
                <option value="paper">Paper</option>
                <option value="demo">Demo</option>
                <option value="empty">No entries</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Direction</Form.Label>
              <Form.Select value={draft.paper.directionMode} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, directionMode: e.currentTarget.value as "both" | "long" | "short" } })}>
                <option value="both">Both</option>
                <option value="long">Long only</option>
                <option value="short">Short only</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Max daily loss, USDT</Form.Label>
              <Form.Control type="number" value={draft.paper.maxDailyLossUSDT} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, maxDailyLossUSDT: Number(e.currentTarget.value) } })} />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Max trades per day</Form.Label>
              <Form.Control
                type="number"
                min={1}
                step={1}
                value={draft.riskLimits?.maxTradesPerDay ?? 2}
                onChange={(e) => {
                  const next = Math.max(1, Math.round(Number(e.currentTarget.value) || 1));
                  setDraft({
                    ...draft,
                    riskLimits: {
                      ...(draft.riskLimits ?? {
                        maxTradesPerDay: 2,
                        maxLossPerDayUsdt: null,
                        maxLossPerSessionUsdt: null,
                        maxConsecutiveErrors: 10,
                      }),
                      maxTradesPerDay: next,
                    },
                    executionProfile: {
                      ...(draft.executionProfile ?? {
                        execution: draft.execution,
                        paper: {
                          enabled: draft.paper.enabled,
                          directionMode: draft.paper.directionMode,
                          marginUSDT: draft.paper.marginUSDT,
                          leverage: draft.paper.leverage,
                          makerFeeRate: draft.paper.makerFeeRate,
                          maxDailyLossUSDT: draft.paper.maxDailyLossUSDT,
                        },
                        riskLimits: {
                          maxTradesPerDay: 2,
                          maxLossPerDayUsdt: null,
                          maxLossPerSessionUsdt: null,
                          maxConsecutiveErrors: 10,
                        },
                      }),
                      riskLimits: {
                        ...(draft.executionProfile?.riskLimits ?? {
                          maxTradesPerDay: 2,
                          maxLossPerDayUsdt: null,
                          maxLossPerSessionUsdt: null,
                          maxConsecutiveErrors: 10,
                        }),
                        maxTradesPerDay: next,
                      },
                    },
                  });
                }}
              />
              <Form.Text muted>Daily cap for opened entries. Extra entries are skipped with risk_max_trades_per_day.</Form.Text>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Margin per trade, USDT</Form.Label>
              <Form.Control type="number" value={draft.paper.marginUSDT} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, marginUSDT: Number(e.currentTarget.value) } })} />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Leverage</Form.Label>
              <Form.Control type="number" value={draft.paper.leverage} onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, leverage: Number(e.currentTarget.value) } })} />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Minutes before funding</Form.Label>
              <Form.Control
                type="number"
                min={0}
                step={1}
                value={draft.fundingCooldown.beforeMin}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fundingCooldown: {
                      ...draft.fundingCooldown,
                      beforeMin: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)),
                    },
                  })
                }
              />
              <Form.Text muted>How many minutes before funding to block new entries.</Form.Text>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Minutes after funding</Form.Label>
              <Form.Control
                type="number"
                min={0}
                step={1}
                value={draft.fundingCooldown.afterMin}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fundingCooldown: {
                      ...draft.fundingCooldown,
                      afterMin: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)),
                    },
                  })
                }
              />
              <Form.Text muted>How many minutes after funding to keep entries paused.</Form.Text>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Trading fee model</Form.Label>
              <div style={{ fontSize: 14, padding: "6px 0" }}>
                Maker fee fixed: <b>0.02%</b> per side (VIP 0, Bybit Futures).
              </div>
              <Form.Text muted>
                Entry and passive TP/SL exits use maker fee; round-trip fee is 0.04% of position notional. If an exit removes liquidity, that leg is charged as taker.
              </Form.Text>
            </Form.Group>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}
