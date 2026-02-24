/**
 * WS topic builder (stub).
 * TODO: build args list for tickers.{symbol} + kline.{tf}.{symbol} with batching.
 */
export function buildTickerTopic(symbol: string) {
  return `tickers.${symbol}`;
}

export function buildKlineTopic(tfMin: number, symbol: string) {
  return `kline.${tfMin}.${symbol}`;
}
