import { useMemo } from 'react';
import { Button, Card } from 'react-bootstrap';
import { SymbolsTable } from '../components/SymbolsTable';
import { appStore, useAppStore } from '../state/store';

export function SymbolsPage() {
  const symbolsByKey = useAppStore((state) => state.symbolsByKey);
  const symbolsRenderPaused = useAppStore((state) => state.symbolsRenderPaused);

  const rows = useMemo(
    () => Array.from(symbolsByKey.values()).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [symbolsByKey],
  );

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Card.Title className="mb-0">Symbols ({rows.length})</Card.Title>
          <Button size="sm" variant={symbolsRenderPaused ? 'success' : 'outline-secondary'} onClick={() => appStore.toggleSymbolsRenderPaused()}>
            {symbolsRenderPaused ? 'Resume rendering' : 'Pause rendering'}
          </Button>
        </div>
        <SymbolsTable rows={rows} />
      </Card.Body>
    </Card>
  );
}
