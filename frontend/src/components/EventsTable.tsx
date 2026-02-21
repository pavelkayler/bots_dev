import { useMemo, useState } from 'react';
import { Form, Row, Col, Table } from 'react-bootstrap';
import type { EventRow } from '../ws/types';

interface EventsTableProps {
  events: EventRow[];
}

function compactJson(value: Record<string, unknown>): string {
  const json = JSON.stringify(value);
  if (json.length <= 120) {
    return json;
  }
  return `${json.slice(0, 117)}...`;
}

export function EventsTable({ events }: EventsTableProps) {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const uniqueTypes = useMemo(
    () => [...new Set(events.map((event) => event.type))].sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const symbolMatch =
          symbolFilter.trim().length === 0 ||
          event.symbol.toLowerCase().includes(symbolFilter.trim().toLowerCase());
        const typeMatch = typeFilter === 'all' || event.type === typeFilter;
        return symbolMatch && typeMatch;
      }),
    [events, symbolFilter, typeFilter],
  );

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
          {filtered.map((event) => (
            <tr key={event.id}>
              <td>{new Date(event.ts).toLocaleString()}</td>
              <td>{event.type}</td>
              <td>{event.symbol}</td>
              <td>
                <code>{compactJson(event.data)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
