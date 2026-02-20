import type { BybitWsClient } from '../bybit';
import { MarketStateStore } from './MarketStateStore';
import type { UniverseBuildInput, UniverseBuildResult } from './types';

const DEFAULT_WARMUP_MS = 4_000;

export class UniverseBuilder {
  constructor(
    private readonly wsClient: BybitWsClient,
    private readonly marketStateStore: MarketStateStore,
    private readonly warmupMs = DEFAULT_WARMUP_MS,
  ) {}

  async build(input: UniverseBuildInput, tfMin: number): Promise<UniverseBuildResult> {
    this.wsClient.setSubscriptions({
      symbols: input.candidateSymbols,
      tfMin,
      includeKline: false,
    });
    this.wsClient.start();

    await new Promise((resolve) => setTimeout(resolve, this.warmupMs));

    const marketSnapshot = this.marketStateStore.snapshot(input.candidateSymbols);

    const eligible = input.candidateSymbols
      .map((symbol) => {
        const market = marketSnapshot.get(symbol);
        if (!market) {
          return undefined;
        }

        const turnover = market.turnover24h;
        const high = market.highPrice24h;
        const low = market.lowPrice24h;

        if (turnover === undefined || high === undefined || low === undefined || low <= 0) {
          return undefined;
        }

        const vol24hPct = ((high - low) / low) * 100;
        return {
          symbol,
          turnover,
          vol24hPct,
        };
      })
      .filter((value): value is { symbol: string; turnover: number; vol24hPct: number } => Boolean(value))
      .filter(
        (item) =>
          item.turnover >= input.minTurnover24hUSDT && item.vol24hPct >= input.minVolatility24hPct,
      )
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, input.maxSymbols)
      .map((item) => item.symbol);

    this.wsClient.setSubscriptions({
      symbols: eligible,
      tfMin,
      includeKline: true,
    });

    return {
      symbols: eligible,
      warmedSymbols: marketSnapshot.size,
    };
  }
}
