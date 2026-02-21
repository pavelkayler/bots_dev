import { useState } from 'react';
import { Badge, Button, Card } from 'react-bootstrap';
import { EventsTable } from '../components/EventsTable';
import { useAppStore } from '../state/store';

const QUICK_TYPES = ['signal_fired', 'order_filled', 'position_closed', 'funding_applied', 'error'];

export function EventsPage() {
  const events = useAppStore((state) => state.events);
  const [quickFilter, setQuickFilter] = useState<string | null>(null);

  return (
    <Card>
      <Card.Body>
        <Card.Title>Events ({events.length})</Card.Title>
        <div className="d-flex gap-2 flex-wrap mb-3">
          <Button
            size="sm"
            variant={quickFilter === null ? 'dark' : 'outline-dark'}
            onClick={() => setQuickFilter(null)}
          >
            All
          </Button>
          {QUICK_TYPES.map((type) => (
            <Button
              key={type}
              size="sm"
              variant={quickFilter === type ? 'dark' : 'outline-dark'}
              onClick={() => setQuickFilter(type)}
            >
              <Badge bg="secondary" className="me-1">
                type
              </Badge>
              {type}
            </Button>
          ))}
        </div>
        <EventsTable events={events} quickTypeFilter={quickFilter} />
      </Card.Body>
    </Card>
  );
}
