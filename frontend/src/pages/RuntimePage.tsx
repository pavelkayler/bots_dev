import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Row } from 'react-bootstrap';
import { appStore, useAppStore } from '../state/store';

function formatRemaining(untilTs: number | null): string {
  if (!untilTs) {
    return '-';
  }
  const remainingSec = Math.max(0, Math.floor((untilTs - Date.now()) / 1000));
  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function RuntimePage() {
  const sessionState = useAppStore((state) => state.sessionState);
  const counts = useAppStore((state) => state.counts);
  const cooldown = useAppStore((state) => state.cooldown);

  const [clock, setClock] = useState(Date.now());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const cooldownCountdown = useMemo(() => {
    void clock;
    return formatRemaining(cooldown.untilTs);
  }, [clock, cooldown.untilTs]);

  const onStop = async () => {
    setLoading(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await appStore.stopSession();
      setFeedback(`Stopped session ${response.sessionId ?? '-'} (${response.state})`);
    } catch (stopError) {
      setError((stopError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <Card.Title>Runtime</Card.Title>
        <Row className="g-3 mt-1">
          <Col md={3}>
            <strong>Session state</strong>
            <div>
              <Badge bg="primary">{sessionState}</Badge>
            </div>
          </Col>
          <Col md={3}>
            <strong>symbolsTotal</strong>
            <div>{counts.symbolsTotal}</div>
          </Col>
          <Col md={3}>
            <strong>ordersActive</strong>
            <div>{counts.ordersActive}</div>
          </Col>
          <Col md={3}>
            <strong>positionsOpen</strong>
            <div>{counts.positionsOpen}</div>
          </Col>
          <Col md={3}>
            <strong>Cooldown active</strong>
            <div>{String(cooldown.isActive)}</div>
          </Col>
          <Col md={3}>
            <strong>Cooldown until</strong>
            <div>{cooldown.untilTs ? new Date(cooldown.untilTs).toLocaleString() : '-'}</div>
          </Col>
          <Col md={3}>
            <strong>Cooldown countdown</strong>
            <div>{cooldown.isActive ? cooldownCountdown : '-'}</div>
          </Col>
        </Row>

        <Button className="mt-4" variant="danger" onClick={onStop} disabled={loading}>
          {loading ? 'Stopping...' : 'Stop'}
        </Button>

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
