import { Badge, Button, Container, Nav, Navbar, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import type { ConnStatus, SessionState, StreamsState } from "../../../shared/types/domain";

type Props = {
  conn: ConnStatus;
  sessionState: SessionState;
  wsUrl: string;
  lastServerTime: number | null;

  streams: StreamsState;
  onToggleStreams: () => void;
  onApplySubscriptions: () => void;

  canStart: boolean;
  canStop: boolean;
  busy: "none" | "start" | "stop";
  onStart: () => void;
  onStop: () => void;
};

export function HeaderBar(props: Props) {
  const {
    conn,
    sessionState,
    wsUrl,
    lastServerTime,
    streams,
    onToggleStreams,
    onApplySubscriptions,
    canStart,
    canStop,
    busy,
    onStart,
    onStop
  } = props;

  const connVariant =
    conn === "CONNECTED" ? "success" :
    conn === "CONNECTING" ? "warning" :
    conn === "RECONNECTING" ? "warning" : "danger";

  const sessionVariant =
    sessionState === "RUNNING" ? "success" :
    sessionState === "STOPPING" ? "warning" : "secondary";

  const streamsVariant =
    !streams.streamsEnabled ? "secondary" :
    streams.bybitConnected ? "success" : "warning";

  const streamsText =
    !streams.streamsEnabled ? "Streams: OFF" :
    streams.bybitConnected ? "Streams: ON" : "Streams: ON (connecting)";

  return (
    <Navbar bg="light">
      <Container fluid>
        <Navbar.Brand>Bybit Bots (skeleton)</Navbar.Brand>

        <Nav className="me-2">
          <Nav.Link as={Link} to="/">Dashboard</Nav.Link>
          <Nav.Link as={Link} to="/universe">Universe</Nav.Link>
        </Nav>

        <div className="d-flex align-items-center gap-2 flex-wrap" style={{ width: "100%" }}>
          <Badge bg={connVariant}>{conn}</Badge>
          <Badge bg={sessionVariant}>Session: {sessionState}</Badge>
          <Badge bg={streamsVariant}>{streamsText}</Badge>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            WS: {wsUrl} · Last tick: {lastServerTime ? new Date(lastServerTime).toLocaleTimeString() : "-"}
          </div>

          <div className="ms-auto d-flex align-items-center gap-2">
            <Button size="sm" variant="outline-secondary" onClick={onToggleStreams}>
              Toggle streams
            </Button>

            <Button
              size="sm"
              variant="outline-secondary"
              onClick={onApplySubscriptions}
              disabled={!streams.streamsEnabled}
              title={!streams.streamsEnabled ? "Streams are OFF" : "Reconnect + re-subscribe with current universe"}
            >
              Apply subscriptions
            </Button>

            <Button size="sm" variant="success" onClick={onStart} disabled={!canStart}>
              {busy === "start" ? <Spinner animation="border" size="sm" /> : "Start"}
            </Button>
            <Button size="sm" variant="danger" onClick={onStop} disabled={!canStop}>
              {busy === "stop" ? <Spinner animation="border" size="sm" /> : "Stop"}
            </Button>
          </div>
        </div>
      </Container>
    </Navbar>
  );
}
