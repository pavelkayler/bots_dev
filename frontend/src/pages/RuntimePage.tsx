import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Modal, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
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
  const wsConnectionState = useAppStore((state) => state.wsConnectionState);
  const lastTickTs = useAppStore((state) => state.lastTickTs);

  const [clock, setClock] = useState(Date.now());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmStop, setShowConfirmStop] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const cooldownCountdown = useMemo(() => {
    void clock;
    return formatRemaining(cooldown.untilTs);
  }, [clock, cooldown.untilTs]);

  const onStop = async () => {
    setShowConfirmStop(false);
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
    <>
      <Card>
        <Card.Body>
          <Card.Title>Runtime</Card.Title>
          <div className="d-flex gap-2 mb-3">
            <Button as={Link} to="/symbols" size="sm" variant="outline-primary">
              Open Symbols
            </Button>
            <Button as={Link} to="/events" size="sm" variant="outline-secondary">
              Open Events
            </Button>
          </div>
          <Row className="g-3 mt-1">
            <Col md={3}>
              <strong>Session state</strong>
              <div>
                <Badge bg="primary">{sessionState}</Badge>
              </div>
            </Col>
            <Col md={3}>
              <strong>WS connection</strong>
              <div>{wsConnectionState}</div>
            </Col>
            <Col md={3}>
              <strong>Last tick TS</strong>
              <div>{lastTickTs ? new Date(lastTickTs).toLocaleString() : '-'}</div>
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
              <strong>Cooldown window</strong>
              <div>
                {cooldown.fromTs ? new Date(cooldown.fromTs).toLocaleTimeString() : '-'} →{' '}
                {cooldown.untilTs ? new Date(cooldown.untilTs).toLocaleTimeString() : '-'}
              </div>
            </Col>
            <Col md={3}>
              <strong>Cooldown countdown</strong>
              <div>{cooldown.isActive ? cooldownCountdown : '-'}</div>
            </Col>
          </Row>

          <Button
            className="mt-4"
            variant="danger"
            onClick={() => setShowConfirmStop(true)}
            disabled={loading || sessionState === 'STOPPED'}
          >
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

      <Modal show={showConfirmStop} onHide={() => setShowConfirmStop(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm STOP</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          This will cancel active orders, close open positions, and stop the current session. Continue?
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowConfirmStop(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onStop} disabled={loading}>
            Confirm STOP
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
