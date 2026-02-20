export const BYBIT_PUBLIC_LINEAR_WS_URL = 'wss://stream.bybit.com/v5/public/linear';
export const BYBIT_V5_REST_BASE_URL = 'https://api.bybit.com';

export const BYBIT_WS_ARGS_MAX_CHARS = 21_000;
export const BYBIT_WS_PING_INTERVAL_MS = 20_000;
export const BYBIT_WS_RECONNECT_BASE_MS = 1_000;
export const BYBIT_WS_RECONNECT_MAX_MS = 30_000;

export interface InstrumentSpec {
  symbol: string;
  tickSize: number;
  qtyStep: number;
  minQty: number;
}

export interface TickerPatch {
  markPrice?: number;
  openInterestValue?: number;
  turnover24h?: number;
  highPrice24h?: number;
  lowPrice24h?: number;
  fundingRate?: number;
  nextFundingTime?: number;
}

export interface KlineCandle {
  start: number;
  end: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  turnover?: number;
  confirm: boolean;
  timestamp: number;
}

export interface BybitTopicMessage<TData> {
  topic: string;
  type?: 'snapshot' | 'delta';
  ts?: number;
  data: TData;
}

export interface BybitTickerRaw {
  symbol?: string;
  markPrice?: string;
  openInterestValue?: string;
  turnover24h?: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  fundingRate?: string;
  nextFundingTime?: string;
}

export interface BybitKlineRaw {
  start?: string;
  end?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  turnover?: string;
  confirm?: boolean;
  timestamp?: string;
}

export interface BybitInstrumentsInfoResponse {
  retCode: number;
  retMsg: string;
  result?: {
    list?: Array<{
      symbol?: string;
      priceFilter?: {
        tickSize?: string;
      };
      lotSizeFilter?: {
        qtyStep?: string;
        minOrderQty?: string;
      };
    }>;
    nextPageCursor?: string;
  };
}

export interface BybitWsClientOptions {
  wsUrl?: string;
  pingIntervalMs?: number;
  argsMaxChars?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  onTicker?: (symbol: string, patch: TickerPatch) => void;
  onKline?: (symbol: string, tfMin: number, candle: KlineCandle) => void;
  onError?: (error: Error) => void;
}

export interface BybitSubscriptions {
  symbols: string[];
  tfMin: number;
}
