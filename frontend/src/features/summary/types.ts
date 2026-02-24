export type PaperTrade = {
  symbol?: string;
  side?: "LONG" | "SHORT" | string;
  openedAt?: number;
  closedAt?: number;
  entryPrice?: number;
  closePrice?: number;
  qty?: number;
  closeType?: string;
  pnlFromMove?: number;
  fundingAccrued?: number;
  feesPaid?: number;
  realizedPnl?: number;
  holdMs?: number;
};

export type PaperSummary = {
  generatedAt?: number;
  sessionId?: string;
  startTs?: number;
  endTs?: number;
  durationSec?: number;
  trades?: {
    total?: number;
    wins?: number;
    losses?: number;
    winRate?: number | null;
    avgWin?: number | null;
    avgLoss?: number | null;
    expectancy?: number | null;
    avgHoldSec?: number | null;
  };
  pnl?: {
    netRealized?: number;
    grossFromMove?: number;
    funding?: number;
    fees?: number;
  };
  equity?: {
    maxDrawdown?: number | null;
    peak?: number;
    trough?: number;
  };
  perSymbol?: Array<{
    symbol?: string;
    trades?: number;
    wins?: number;
    losses?: number;
    winRate?: number | null;
    netRealized?: number;
  }>;
};

export type SessionSummaryResponse = {
  summary: PaperSummary;
  trades: PaperTrade[];
};
