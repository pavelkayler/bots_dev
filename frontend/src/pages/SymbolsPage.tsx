import { Card } from 'react-bootstrap';
import { SymbolsTable } from '../components/SymbolsTable';
import { useAppStore } from '../state/store';

export function SymbolsPage() {
  const symbolsByKey = useAppStore((state) => state.symbolsByKey);
  const rows = Object.values(symbolsByKey).sort((a, b) => a.symbol.localeCompare(b.symbol));

  return (
    <Card>
      <Card.Body>
        <Card.Title>Symbols ({rows.length})</Card.Title>
        <SymbolsTable rows={rows} />
      </Card.Body>
    </Card>
  );
}
