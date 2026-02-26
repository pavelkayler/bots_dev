import { Badge, Button, Container, Nav, Navbar, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import type { ConnStatus, SessionState, StreamsState } from "../../../shared/types/domain";

type Props = {
  conn: ConnStatus;
  sessionState: SessionState;
  wsUrl: string;
  lastServerTime: number | null;
  streams: StreamsState;
  canStart: boolean;
  canStop: boolean;
  canPause: boolean;
  canResume: boolean;
  busy: "none" | "start" | "stop" | "pause" | "resume";
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
};

export function HeaderBar(props: Props) {
  const { conn, sessionState, wsUrl, lastServerTime, streams, canStart, canStop, canPause, canResume, busy, onStart, onStop, onPause, onResume } = props;

  const connVariant = conn === "CONNECTED" ? "success" : conn === "CONNECTING" || conn === "RECONNECTING" ? "warning" : "danger";
  const sessionVariant = sessionState === "RUNNING" ? "success" : sessionState === "STOPPING" || sessionState === "PAUSING" || sessionState === "RESUMING" ? "warning" : "secondary";
  const streamsVariant = !streams.streamsEnabled ? "secondary" : streams.bybitConnected ? "success" : "warning";
  const streamsText = !streams.streamsEnabled ? "Streams: OFF" : streams.bybitConnected ? "Streams: ON" : "Streams: ON (connecting)";

  return (
    <Navbar bg="light">
      <Container fluid>
        <Navbar.Brand>Bybit Bots (skeleton)</Navbar.Brand>
        <Nav className="me-2">
          <Nav.Link as={Link} to="/">Dashboard</Nav.Link>
          <Nav.Link as={Link} to="/universe">Universe</Nav.Link>
          <Nav.Link as={Link} to="/optimizer">Optimizer</Nav.Link>
        </Nav>
        <div className="d-flex align-items-center gap-2 flex-wrap" style={{ width: "100%" }}>
          <Badge bg={connVariant}>{conn}</Badge>
          <Badge bg={streamsVariant}>{streamsText}</Badge>
          <Badge bg={sessionVariant}>Session: {sessionState}</Badge>
          <div style={{ fontSize: 12, opacity: 0.8 }}>WS: {wsUrl} · Last tick: {lastServerTime ? new Date(lastServerTime).toLocaleTimeString() : "-"}</div>
          <div className="ms-auto d-flex align-items-center gap-2">
            <Button size="sm" variant="success" onClick={onStart} disabled={!canStart}>{busy === "start" ? <Spinner animation="border" size="sm" /> : "Start"}</Button>
            <Button size="sm" variant="warning" onClick={onPause} disabled={!canPause}>{busy === "pause" ? <Spinner animation="border" size="sm" /> : "Pause"}</Button>
            <Button size="sm" variant="primary" onClick={onResume} disabled={!canResume}>{busy === "resume" ? <Spinner animation="border" size="sm" /> : "Resume"}</Button>
            <Button size="sm" variant="danger" onClick={onStop} disabled={!canStop}>{busy === "stop" ? <Spinner animation="border" size="sm" /> : "Stop"}</Button>
          </div>
        </div>
      </Container>
    </Navbar>
  );
}
