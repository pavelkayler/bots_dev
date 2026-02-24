type TickerCacheRow = {
  symbol: string;

  markPrice: number | null;
  openInterestValue: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  fundingIntervalHour: number | null;

  updatedAt: number;
};

export class BybitMarketCache {
  private readonly map = new Map<string, TickerCacheRow>();

  upsertFromTicker(symbol: string, delta: Record<string, any>) {
    const row =
      this.map.get(symbol) ??
      ({
        symbol,
        markPrice: null,
        openInterestValue: null,
        fundingRate: null,
        nextFundingTime: null,
        fundingIntervalHour: null,
        updatedAt: Date.now(),
      } satisfies TickerCacheRow);

    if (delta.markPrice != null) row.markPrice = Number(delta.markPrice);
    if (delta.openInterestValue != null) row.openInterestValue = Number(delta.openInterestValue);
    if (delta.fundingRate != null) row.fundingRate = Number(delta.fundingRate);
    if (delta.nextFundingTime != null) row.nextFundingTime = Number(delta.nextFundingTime);
    if (delta.fundingIntervalHour != null) row.fundingIntervalHour = Number(delta.fundingIntervalHour);

    row.updatedAt = Date.now();
    this.map.set(symbol, row);
  }

  getOpenInterestValue(symbol: string): number | null {
    const r = this.map.get(symbol);
    return r?.openInterestValue ?? null;
  }

  getMarkPrice(symbol: string): number | null {
    const r = this.map.get(symbol);
    return r?.markPrice ?? null;
  }


  getRawRow(symbol: string): {
    symbol: string;
    markPrice: number | null;
    openInterestValue: number | null;
    fundingRate: number | null;
    nextFundingTime: number | null;
    fundingIntervalHour: number | null;
    updatedAt: number;
  } | null {
    const r = this.map.get(symbol);
    if (!r) return null;
    return {
      symbol: r.symbol,
      markPrice: r.markPrice,
      openInterestValue: r.openInterestValue,
      fundingRate: r.fundingRate,
      nextFundingTime: r.nextFundingTime,
      fundingIntervalHour: r.fundingIntervalHour,
      updatedAt: r.updatedAt,
    };
  }

  getRowsForUi(): Array<{
    symbol: string;
    markPrice: number;
    openInterestValue: number;
    fundingRate: number;
    nextFundingTime: number;
    fundingIntervalHour: number | null;
    updatedAt: number;
  }> {
    const out: any[] = [];
    for (const r of this.map.values()) {
      if (r.markPrice == null || r.openInterestValue == null || r.fundingRate == null || r.nextFundingTime == null) {
        continue;
      }
      out.push({
        symbol: r.symbol,
        markPrice: r.markPrice,
        openInterestValue: r.openInterestValue,
        fundingRate: r.fundingRate,
        nextFundingTime: r.nextFundingTime,
        fundingIntervalHour: r.fundingIntervalHour ?? null,
        updatedAt: r.updatedAt,
      });
    }

    out.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return out;
  }
}
