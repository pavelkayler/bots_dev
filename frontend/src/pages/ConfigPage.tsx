import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { appStore } from '../state/store';
import type { SessionStartRequest } from '../ws/types';

const defaultConfig: SessionStartRequest = {
  tfMin: 5,
  universe: {
    minVolatility24hPct: 5,
    minTurnover24hUSDT: 1000000,
    maxSymbols: 200,
  },
  signal: {
    priceMovePctThreshold: 0.8,
    oivMovePctThreshold: 2,
  },
  trade: {
    marginUSDT: 100,
    leverage: 10,
    entryOffsetPct: 0.15,
    entryOrderTimeoutMin: 10,
    tpRoiPct: 5,
    slRoiPct: 3,
  },
  fundingCooldown: {
    beforeMin: 15,
    afterMin: 10,
  },
  fees: {
    makerRate: 0.0001,
    takerRate: 0.0006,
  },
};

export function ConfigPage() {
  const startSession = appStore.startSession;
  const [config, setConfig] = useState<SessionStartRequest>(defaultConfig);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setNumber = (path: string, value: string) => {
    const numValue = Number(value);
    setConfig((current) => {
      const next = structuredClone(current);
      const keys = path.split('.');
      let pointer: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let idx = 0; idx < keys.length - 1; idx += 1) {
        pointer = pointer[keys[idx]] as Record<string, unknown>;
      }
      pointer[keys[keys.length - 1]] = numValue;
      return next;
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await startSession(config);
      setFeedback(`Started session ${response.sessionId} (${response.state})`);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <Card.Title>Session Configuration</Card.Title>
        <Form onSubmit={onSubmit}>
          <Row className="g-3">
            <Col md={2}>
              <Form.Label>tfMin</Form.Label>
              <Form.Select
                value={config.tfMin}
                onChange={(event) => setNumber('tfMin', event.target.value)}
              >
                {[1, 3, 5, 10, 15].map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col md={5}>
              <Form.Label>universe.minVolatility24hPct</Form.Label>
              <Form.Control
                type="number"
                value={config.universe.minVolatility24hPct}
                onChange={(event) => setNumber('universe.minVolatility24hPct', event.target.value)}
              />
            </Col>
            <Col md={5}>
              <Form.Label>universe.minTurnover24hUSDT</Form.Label>
              <Form.Control
                type="number"
                value={config.universe.minTurnover24hUSDT}
                onChange={(event) => setNumber('universe.minTurnover24hUSDT', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>universe.maxSymbols</Form.Label>
              <Form.Control
                type="number"
                value={config.universe.maxSymbols}
                onChange={(event) => setNumber('universe.maxSymbols', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>signal.priceMovePctThreshold</Form.Label>
              <Form.Control
                type="number"
                value={config.signal.priceMovePctThreshold}
                onChange={(event) => setNumber('signal.priceMovePctThreshold', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>signal.oivMovePctThreshold</Form.Label>
              <Form.Control
                type="number"
                value={config.signal.oivMovePctThreshold}
                onChange={(event) => setNumber('signal.oivMovePctThreshold', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>trade.marginUSDT</Form.Label>
              <Form.Control
                type="number"
                value={config.trade.marginUSDT}
                onChange={(event) => setNumber('trade.marginUSDT', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>trade.leverage</Form.Label>
              <Form.Control
                type="number"
                value={config.trade.leverage}
                onChange={(event) => setNumber('trade.leverage', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>trade.entryOffsetPct</Form.Label>
              <Form.Control
                type="number"
                value={config.trade.entryOffsetPct}
                onChange={(event) => setNumber('trade.entryOffsetPct', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>trade.entryOrderTimeoutMin</Form.Label>
              <Form.Control
                type="number"
                value={config.trade.entryOrderTimeoutMin}
                onChange={(event) => setNumber('trade.entryOrderTimeoutMin', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>trade.tpRoiPct</Form.Label>
              <Form.Control
                type="number"
                value={config.trade.tpRoiPct}
                onChange={(event) => setNumber('trade.tpRoiPct', event.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Label>trade.slRoiPct</Form.Label>
              <Form.Control
                type="number"
                value={config.trade.slRoiPct}
                onChange={(event) => setNumber('trade.slRoiPct', event.target.value)}
              />
            </Col>
            <Col md={3}>
              <Form.Label>fundingCooldown.beforeMin</Form.Label>
              <Form.Control
                type="number"
                value={config.fundingCooldown.beforeMin}
                onChange={(event) => setNumber('fundingCooldown.beforeMin', event.target.value)}
              />
            </Col>
            <Col md={3}>
              <Form.Label>fundingCooldown.afterMin</Form.Label>
              <Form.Control
                type="number"
                value={config.fundingCooldown.afterMin}
                onChange={(event) => setNumber('fundingCooldown.afterMin', event.target.value)}
              />
            </Col>
            <Col md={3}>
              <Form.Label>fees.makerRate</Form.Label>
              <Form.Control
                type="number"
                step="0.0001"
                value={config.fees.makerRate}
                onChange={(event) => setNumber('fees.makerRate', event.target.value)}
              />
            </Col>
            <Col md={3}>
              <Form.Label>fees.takerRate</Form.Label>
              <Form.Control
                type="number"
                step="0.0001"
                value={config.fees.takerRate}
                onChange={(event) => setNumber('fees.takerRate', event.target.value)}
              />
            </Col>
          </Row>

          <div className="mt-4 d-flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Starting...' : 'Start'}
            </Button>
          </div>
        </Form>

        {feedback && (
          <Alert variant="success" className="mt-3 mb-0">
            {feedback}
          </Alert>
        )}
        {error && (
          <Alert variant="danger" className="mt-3 mb-0">
            {error}
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
}
