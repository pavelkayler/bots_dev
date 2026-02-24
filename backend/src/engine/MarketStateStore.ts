/**
 * Market state cache (stub).
 * TODO: keep last known tickers + kline state per symbol (snapshot+delta aware).
 */
export class MarketStateStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTicker(_symbol: string, _delta: any): void {
    // TODO
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateKline(_symbol: string, _kline: any): void {
    // TODO
  }
}
