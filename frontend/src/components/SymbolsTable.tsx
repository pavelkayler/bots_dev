import Table from 'react-bootstrap/Table';
import type { SymbolRow } from '../ws/types';

interface SymbolsTableProps {
  rows: SymbolRow[];
}

function formatNumber(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function formatCountdown(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.max(0, totalSec % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function SymbolsTable({ rows }: SymbolsTableProps) {
  return (
    <Table striped bordered hover size="sm" responsive>
      <thead>
        <tr>
          <th>symbol</th>
          <th>status</th>
          <th>markPrice</th>
          <th>priceMovePct</th>
          <th>oivUSDT</th>
          <th>oivMovePct</th>
          <th>funding.rate</th>
          <th>funding.nextFundingTimeMsk</th>
          <th>funding.countdownSec</th>
          <th>gates.cooldownBlocked</th>
          <th>gates.dataReady</th>
          <th>order</th>
          <th>position</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.symbol}>
            <td>{row.symbol}</td>
            <td>{row.status}</td>
            <td>{formatNumber(row.market.markPrice, 2)}</td>
            <td>{formatNumber(row.signalMetrics.priceMovePct, 3)}</td>
            <td>{formatNumber(row.market.oivUSDT, 2)}</td>
            <td>{formatNumber(row.signalMetrics.oivMovePct, 3)}</td>
            <td>{formatNumber(row.funding.rate, 6)}</td>
            <td>{row.funding.nextFundingTimeMsk}</td>
            <td>{formatCountdown(row.funding.countdownSec)}</td>
            <td>{String(row.gates.cooldownBlocked)}</td>
            <td>{String(row.gates.dataReady)}</td>
            <td>
              {row.order
                ? `${row.order.side}/${formatNumber(row.order.price, 2)}/${formatNumber(row.order.qty, 4)}/${new Date(
                    row.order.expiresTs,
                  ).toLocaleTimeString()}`
                : '-'}
            </td>
            <td>
              {row.position
                ? `${row.position.side}/${formatNumber(row.position.entryPrice, 2)}/${formatNumber(
                    row.position.tpPrice,
                    2,
                  )}/${formatNumber(row.position.slPrice, 2)}/${formatNumber(
                    row.position.unrealizedRoiPct,
                    2,
                  )}`
                : '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
