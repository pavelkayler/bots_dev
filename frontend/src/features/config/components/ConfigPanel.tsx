import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import type { SessionState } from "../../../shared/types/domain";
import { useRuntimeConfig } from "../hooks/useRuntimeConfig";
import { fmtTime } from "../../../shared/utils/format";
import { listUniverses, readUniverse } from "../../universe/api";
import type { UniverseMeta } from "../../universe/types";

function num(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

type Props = {
  sessionState?: SessionState;
};

export function ConfigPanel({ sessionState }: Props) {
  const { draft, setDraft, dirty, error, saving, lastApplied, lastSavedAt, reload, save, reset } = useRuntimeConfig();

  const [universeList, setUniverseList] = useState<UniverseMeta[]>([]);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [universeError, setUniverseError] = useState<string | null>(null);
  const [selectedUniverseId, setSelectedUniverseId] = useState<string>("");

  const disabled = !draft;
  const universeLocked = sessionState === "RUNNING" || sessionState === "STOPPING";

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

  useEffect(() => {
    void refreshUniverses();
  }, []);

  useEffect(() => {
    if (!draft) return;
    const id = String((draft as any).universe?.selectedId ?? "");
    setSelectedUniverseId(id);
  }, [draft]);

  async function onUniverseSelect(id: string) {
    setSelectedUniverseId(id);
    if (!id) return;
    if (!draft) return;

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

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Config</b>
        {badge}

        <span style={{ opacity: 0.75, fontSize: 12 }}>
          Universe symbols are selected from saved universes. Universe changes require Session STOPPED.
        </span>

        {appliedHint ? (
          <span style={{ opacity: 0.8, fontSize: 12 }}>
            applied: {appliedHint}
            {lastSavedAt ? ` at ${fmtTime(lastSavedAt)}` : ""}
          </span>
        ) : null}

        <div className="ms-auto d-flex align-items-center gap-2">
          <Button size="sm" variant="outline-secondary" onClick={() => void reload()} disabled={saving}>
            Reload
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={reset} disabled={!dirty || disabled || saving}>
            Reset
          </Button>
          <Button size="sm" variant="success" onClick={() => void save()} disabled={!dirty || disabled || saving}>
            Apply
          </Button>
        </div>
      </Card.Header>

      <Card.Body>
        {!draft ? (
          <div style={{ opacity: 0.8 }}>Loading config…</div>
        ) : (
          <>
            {universeError ? <div style={{ color: "#b00020", marginBottom: 8 }}>{universeError}</div> : null}

            <Row className="g-3">
              <Col md={4}>
                <h6>Universe</h6>

                <Form.Group className="mb-2">
                  <Form.Label>Universe (saved sets)</Form.Label>
                  <div className="d-flex gap-2">
                    <Form.Select
                      value={selectedUniverseId}
                      onChange={(e) => void onUniverseSelect(e.currentTarget.value)}
                      disabled={universeLocked || universeLoading}
                    >
                      <option value="">Select universe…</option>
                      {universeList.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.count})
                        </option>
                      ))}
                    </Form.Select>

                    <Button size="sm" variant="outline-secondary" onClick={() => void refreshUniverses()} disabled={universeLoading}>
                      {universeLoading ? <Spinner animation="border" size="sm" /> : "↻"}
                    </Button>
                  </div>

                  <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                    current symbols: {draft.universe.symbols.length}
                  </div>
                  {!selectedUniverseId ? (
                    <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>
                      Universe is not selected. Choose one and click Apply before Start.
                    </div>
                  ) : null}
                  {universeLocked ? (
                    <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                      Locked while session is {sessionState}.
                    </div>
                  ) : null}
                </Form.Group>

                <Form.Group className="mb-2">
                  <Form.Label>klineTfMin</Form.Label>
                  <Form.Control
                    type="number"
                    step="1"
                    value={draft.universe.klineTfMin}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        universe: { ...draft.universe, klineTfMin: num(e.currentTarget.value, 1) }
                      })
                    }
                  />
                </Form.Group>
              </Col>

              <Col md={4}>
                <h6>Signals</h6>
                <Form.Group className="mb-2">
                  <Form.Label>priceThresholdPct</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.001"
                    value={draft.signals.priceThresholdPct}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        signals: { ...draft.signals, priceThresholdPct: num(e.currentTarget.value, 0) }
                      })
                    }
                  />
                </Form.Group>

                <Form.Group className="mb-2">
                  <Form.Label>oivThresholdPct</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.001"
                    value={draft.signals.oivThresholdPct}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        signals: { ...draft.signals, oivThresholdPct: num(e.currentTarget.value, 0) }
                      })
                    }
                  />
                </Form.Group>

                <Form.Check
                  type="switch"
                  id="requireFundingSign"
                  label="requireFundingSign"
                  checked={draft.signals.requireFundingSign}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      signals: { ...draft.signals, requireFundingSign: e.currentTarget.checked }
                    })
                  }
                />
              </Col>

              <Col md={4}>
                <h6>Funding cooldown</h6>

                <Form.Group className="mb-2">
                  <Form.Label>beforeMin</Form.Label>
                  <Form.Control
                    type="number"
                    step="1"
                    value={draft.fundingCooldown.beforeMin}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        fundingCooldown: { ...draft.fundingCooldown, beforeMin: num(e.currentTarget.value, 0) }
                      })
                    }
                  />
                </Form.Group>

                <Form.Group className="mb-2">
                  <Form.Label>afterMin</Form.Label>
                  <Form.Control
                    type="number"
                    step="1"
                    value={draft.fundingCooldown.afterMin}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        fundingCooldown: { ...draft.fundingCooldown, afterMin: num(e.currentTarget.value, 0) }
                      })
                    }
                  />
                </Form.Group>

                <hr />

                <div className="d-flex align-items-baseline justify-content-between">
                  <h6 className="mb-0">Paper</h6>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>applies next Start</span>
                </div>

                <Form.Check
                  className="mt-2"
                  type="switch"
                  id="paperEnabled"
                  label="enabled"
                  checked={draft.paper.enabled}
                  onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, enabled: e.currentTarget.checked } })}
                />

                <Row className="g-2 mt-1">
                  <Col>
                    <Form.Group>
                      <Form.Label>marginUSDT</Form.Label>
                      <Form.Control
                        type="number"
                        step="1"
                        value={draft.paper.marginUSDT}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, marginUSDT: num(e.currentTarget.value, 0) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                  <Col>
                    <Form.Group>
                      <Form.Label>leverage</Form.Label>
                      <Form.Control
                        type="number"
                        step="1"
                        value={draft.paper.leverage}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, leverage: num(e.currentTarget.value, 1) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Row className="g-2 mt-1">
                  <Col>
                    <Form.Group>
                      <Form.Label>entryOffsetPct</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={draft.paper.entryOffsetPct}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, entryOffsetPct: num(e.currentTarget.value, 0) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                  <Col>
                    <Form.Group>
                      <Form.Label>entryTimeoutSec</Form.Label>
                      <Form.Control
                        type="number"
                        step="1"
                        value={draft.paper.entryTimeoutSec}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, entryTimeoutSec: num(e.currentTarget.value, 1) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Row className="g-2 mt-1">
                  <Col>
                    <Form.Group>
                      <Form.Label>tpRoiPct</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        value={draft.paper.tpRoiPct}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, tpRoiPct: num(e.currentTarget.value, 0) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                  <Col>
                    <Form.Group>
                      <Form.Label>slRoiPct</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        value={draft.paper.slRoiPct}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, slRoiPct: num(e.currentTarget.value, 0) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Row className="g-2 mt-1">
                  <Col>
                    <Form.Group>
                      <Form.Label>makerFeeRate</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.0001"
                        value={draft.paper.makerFeeRate}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, makerFeeRate: num(e.currentTarget.value, 0) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                  <Col>
                    <Form.Group>
                      <Form.Label>rearmDelayMs</Form.Label>
                      <Form.Control
                        type="number"
                        step="100"
                        value={draft.paper.rearmDelayMs}
                        onChange={(e) =>
                          setDraft({ ...draft, paper: { ...draft.paper, rearmDelayMs: num(e.currentTarget.value, 0) } })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <Form.Check
                  className="mt-2"
                  type="switch"
                  id="applyFunding"
                  label="applyFunding"
                  checked={draft.paper.applyFunding}
                  onChange={(e) => setDraft({ ...draft, paper: { ...draft.paper, applyFunding: e.currentTarget.checked } })}
                />
              </Col>
            </Row>
          </>
        )}
      </Card.Body>
    </Card>
  );
}
