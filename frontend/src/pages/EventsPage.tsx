import { Card } from 'react-bootstrap';
import { EventsTable } from '../components/EventsTable';
import { useAppStore } from '../state/store';

export function EventsPage() {
  const events = useAppStore((state) => state.events);

  return (
    <Card>
      <Card.Body>
        <Card.Title>Events ({events.length})</Card.Title>
        <EventsTable events={events} />
      </Card.Body>
    </Card>
  );
}
