import { useMemo, useState } from 'react';
import { Badge, Button, Col, Form, Row, Table } from 'react-bootstrap';
import type { EventRow } from '../ws/types';

interface EventsTableProps {
  events: EventRow[];
  quickTypeFilter: string | null;
}

function severityVariant(type: string): string {
  if (type.startsWith('signal_')) {
    return 'primary';
  }
  if (type.startsWith('order_')) {
    return 'warning';
  }
  if (type.startsWith('position_')) {
    return 'success';
  }
  if (type.startsWith('funding_')) {
    return 'info';
  }
  if (type === 'error') {
    return 'danger';
  }
  return 'secondary';
}

export function EventsTable({ events, quickTypeFilter }: EventsTableProps) {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const uniqueTypes = useMemo(
    () => [...new Set(events.map((event) => event.type))].sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const effectiveTypeFilter = quickTypeFilter ?? typeFilter;

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const symbolMatch =
          symbolFilter.trim().length === 0 ||
          event.symbol.toLowerCase().includes(symbolFilter.trim().toLowerCase());
        const typeMatch = effectiveTypeFilter === 'all' || event.type === effectiveTypeFilter;
        return symbolMatch && typeMatch;
      }),
    [effectiveTypeFilter, events, symbolFilter],
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      <Row className="mb-3 g-2">
        <Col md={4}>
          <Form.Control
            value={symbolFilter}
            onChange={(event) => setSymbolFilter(event.target.value)}
            placeholder="Filter by symbol"
          />
        </Col>
        <Col md={4}>
          <Form.Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All event types</option>
            {uniqueTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      <Table striped bordered hover size="sm" responsive>
        <thead>
          <tr>
            <th>ts</th>
            <th>type</th>
            <th>symbol</th>
            <th>data</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((event) => {
            const expanded = expandedIds.has(event.id);
            return (
              <tr key={event.id}>
                <td>{new Date(event.ts).toLocaleString()}</td>
                <td>
                  <Badge bg={severityVariant(event.type)}>{event.type}</Badge>
                </td>
                <td>{event.symbol}</td>
                <td>
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <code className="mb-0">
                      {expanded ? JSON.stringify(event.data, null, 2) : JSON.stringify(event.data)}
                    </code>
                    <Button size="sm" variant="outline-secondary" onClick={() => toggleExpanded(event.id)}>
                      {expanded ? 'Collapse' : 'Expand'}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
