import { Badge, Container, Nav, Navbar } from 'react-bootstrap';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../state/store';

export function AppNavbar() {
  const sessionId = useAppStore((state) => state.sessionId);
  const sessionState = useAppStore((state) => state.sessionState);
  const wsConnectionState = useAppStore((state) => state.wsConnectionState);
  const wsLastMessageTs = useAppStore((state) => state.wsLastMessageTs);

  const wsBadgeVariant =
    wsConnectionState === 'CONNECTED' ? 'success' : wsConnectionState === 'RECONNECTING' ? 'warning' : 'secondary';

  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <Container fluid>
        <Navbar.Brand>Paper Bot UI</Navbar.Brand>
        <Navbar.Toggle aria-controls="main-nav" />
        <Navbar.Collapse id="main-nav">
          <Nav className="me-auto">
            <Nav.Link as={NavLink} to="/config">
              Config
            </Nav.Link>
            <Nav.Link as={NavLink} to="/runtime">
              Runtime
            </Nav.Link>
            <Nav.Link as={NavLink} to="/symbols">
              Symbols
            </Nav.Link>
            <Nav.Link as={NavLink} to="/events">
              Events
            </Nav.Link>
          </Nav>
          <div className="d-flex gap-2 align-items-center text-light small">
            <Badge bg={wsBadgeVariant}>{wsConnectionState}</Badge>
            <span>last tick: {wsLastMessageTs ? new Date(wsLastMessageTs).toLocaleTimeString() : '-'}</span>
            {sessionId ? <span>{sessionId}</span> : <span>No session</span>}
            <Badge bg="info">{sessionState}</Badge>
          </div>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
