import { BYBIT_WS_ARGS_MAX_CHARS } from './types';

export function tickerTopic(symbol: string): string {
  return `tickers.${symbol}`;
}

export function klineTopic(tfMin: number, symbol: string): string {
  return `kline.${tfMin}.${symbol}`;
}

export function buildTopics(symbols: string[], tfMin: number): string[] {
  return buildTopicsWithOptions(symbols, tfMin, { includeKline: true });
}

export function buildTopicsWithOptions(
  symbols: string[],
  tfMin: number,
  options: { includeKline: boolean },
): string[] {
  if (!options.includeKline) {
    return symbols.map((symbol) => tickerTopic(symbol));
  }

  return symbols.flatMap((symbol) => [tickerTopic(symbol), klineTopic(tfMin, symbol)]);
}

export function partitionTopicsByArgsLength(
  topics: string[],
  maxChars = BYBIT_WS_ARGS_MAX_CHARS,
): string[][] {
  if (maxChars <= 0) {
    throw new Error(`maxChars must be positive, received ${maxChars}`);
  }

  const normalizedTopics = topics.filter((topic) => topic.length > 0);

  const groups: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const topic of normalizedTopics) {
    if (topic.length > maxChars) {
      throw new Error(`Topic exceeds max args length (${maxChars}): ${topic}`);
    }

    const topicCost = currentChars === 0 ? topic.length : topic.length + 1;
    const nextChars = currentChars + topicCost;

    if (nextChars > maxChars) {
      groups.push(current);
      current = [topic];
      currentChars = topic.length;
      continue;
    }

    current.push(topic);
    currentChars = nextChars;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}
