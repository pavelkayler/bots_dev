import { memo } from 'react';
import { Badge, Table } from 'react-bootstrap';
import type { SymbolRow, SymbolStatus } from '../ws/types';

interface SymbolsTableProps {
  rows: SymbolRow[];
}

function formatMarkPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (value >= 1000) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(6);
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(2)}%`;
}

function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function formatCompactUsdt(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCountdown(totalSec: number): string {
  const safe = Math.max(0, Number.isFinite(totalSec) ? totalSec : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function statusBadgeVariant(status: SymbolStatus): string {
  if (status === 'ARMED') {
    return 'primary';
  }
  if (status === 'ORDER_PLACED') {
    return 'warning';
  }
  if (status === 'POSITION_OPEN') {
    return 'success';
  }
  return 'secondary';
}

function deriveWhyNotTrading(row: SymbolRow): string {
  const reasons: string[] = [];
  if (row.status !== 'ARMED') {
    reasons.push(`Status is ${row.status} (signals ignored unless ARMED).`);
  }
  if (row.gates.cooldownBlocked) {
    reasons.push('Global funding cooldown gate is active.');
  }
  if (!row.gates.dataReady) {
    reasons.push('Market data not ready (funding fields missing or stale ticker).');
  }
  return reasons.length === 0 ? 'Eligible for strategy evaluation.' : reasons.join(' ');
}

const SymbolTableRow = memo(function SymbolTableRow({ row }: { row: SymbolRow }) {
  return (
    <tr title={deriveWhyNotTrading(row)}>
      <td>{row.symbol}</td>
      <td>
        <Badge bg={statusBadgeVariant(row.status)}>{row.status}</Badge>
      </td>
      <td>{formatMarkPrice(row.market.markPrice)}</td>
      <td>{formatPct(row.signalMetrics.priceMovePct)}</td>
      <td title={formatNumber(row.market.oivUSDT, 2)}>{formatCompactUsdt(row.market.oivUSDT)}</td>
      <td>{formatPct(row.signalMetrics.oivMovePct)}</td>
      <td>{formatNumber(row.funding.rate, 6)}</td>
      <td>{row.funding.nextFundingTimeMsk}</td>
      <td>{formatCountdown(row.funding.countdownSec)}</td>
      <td>
        <div className="d-flex gap-1 flex-wrap">
          {row.gates.cooldownBlocked ? <Badge bg="warning">COOLDOWN</Badge> : null}
          {!row.gates.dataReady ? <Badge bg="danger">STALE</Badge> : null}
          {!row.gates.cooldownBlocked && row.gates.dataReady ? <span className="text-muted">-</span> : null}
        </div>
      </td>
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
            )}/${formatNumber(row.position.slPrice, 2)}/${formatPct(row.position.unrealizedRoiPct)}`
          : '-'}
      </td>
    </tr>
  );
});

export function SymbolsTable({ rows }: SymbolsTableProps) {
  return (
    <div className="symbols-table-wrap">
      <Table striped bordered hover size="sm" className="mb-0 symbols-table">
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
            <th>gates</th>
            <th>order</th>
            <th>position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SymbolTableRow key={row.symbol} row={row} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}
