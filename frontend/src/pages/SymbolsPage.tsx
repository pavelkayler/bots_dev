import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { SymbolsTable } from '../components/SymbolsTable';
import { appStore, useAppStore } from '../state/store';
import type { SymbolRow, SymbolStatus } from '../ws/types';

type StatusFilter = 'ALL' | SymbolStatus;
type SortMode = 'PRICE_MOVE_DESC' | 'OIV_MOVE_DESC' | 'FUNDING_COUNTDOWN_ASC';

function sortRows(rows: SymbolRow[], sortMode: SortMode): SymbolRow[] {
  const output = [...rows];
  if (sortMode === 'FUNDING_COUNTDOWN_ASC') {
    output.sort((a, b) => a.funding.countdownSec - b.funding.countdownSec || a.symbol.localeCompare(b.symbol));
    return output;
  }

  const key = sortMode === 'PRICE_MOVE_DESC' ? 'priceMovePct' : 'oivMovePct';
  output.sort((a, b) => b.signalMetrics[key] - a.signalMetrics[key] || a.symbol.localeCompare(b.symbol));
  return output;
}

export function SymbolsPage() {
  const symbolsByKey = useAppStore((state) => state.symbolsByKey);
  const symbolsRenderPaused = useAppStore((state) => state.symbolsRenderPaused);

  const [symbolFilter, setSymbolFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('PRICE_MOVE_DESC');

  const rows = useMemo(() => {
    const normalizedFilter = symbolFilter.trim().toLowerCase();
    const filtered = Array.from(symbolsByKey.values()).filter((row) => {
      if (normalizedFilter.length > 0 && !row.symbol.toLowerCase().includes(normalizedFilter)) {
        return false;
      }
      if (statusFilter !== 'ALL' && row.status !== statusFilter) {
        return false;
      }
      if (showOnlyActive && row.status !== 'ORDER_PLACED' && row.status !== 'POSITION_OPEN') {
        return false;
      }
      return true;
    });

    return sortRows(filtered, sortMode);
  }, [showOnlyActive, sortMode, statusFilter, symbolFilter, symbolsByKey]);

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <Card.Title className="mb-0">Symbols ({rows.length})</Card.Title>
          <Button
            size="sm"
            variant={symbolsRenderPaused ? 'success' : 'outline-secondary'}
            onClick={() => appStore.toggleSymbolsRenderPaused()}
          >
            {symbolsRenderPaused ? 'Resume rendering' : 'Pause rendering'}
          </Button>
        </div>

        <Row className="g-2 mb-3">
          <Col md={4}>
            <Form.Control
              value={symbolFilter}
              onChange={(event) => setSymbolFilter(event.target.value)}
              placeholder="Filter symbol (substring)"
            />
          </Col>
          <Col md={3}>
            <Form.Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="ALL">All statuses</option>
              <option value="IDLE">IDLE</option>
              <option value="ARMED">ARMED</option>
              <option value="ORDER_PLACED">ORDER_PLACED</option>
              <option value="POSITION_OPEN">POSITION_OPEN</option>
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="PRICE_MOVE_DESC">Sort: priceMovePct (desc)</option>
              <option value="OIV_MOVE_DESC">Sort: oivMovePct (desc)</option>
              <option value="FUNDING_COUNTDOWN_ASC">Sort: funding countdown (asc)</option>
            </Form.Select>
          </Col>
          <Col md={2} className="d-flex align-items-center">
            <Form.Check
              id="show-only-active"
              type="switch"
              label="Only active"
              checked={showOnlyActive}
              onChange={(event) => setShowOnlyActive(event.target.checked)}
            />
          </Col>
        </Row>

        <SymbolsTable rows={rows} />
      </Card.Body>
    </Card>
  );
}
