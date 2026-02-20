import type { InstrumentSpec, KlineCandle, TickerPatch } from '../bybit';

export interface MarketState {
  symbol: string;
  markPrice?: number;
  openInterestValue?: number;
  turnover24h?: number;
  highPrice24h?: number;
  lowPrice24h?: number;
  fundingRate?: number;
  nextFundingTime?: number;
}

export interface CandleReference {
  prevCandleClose?: number;
  prevCandleOivUSDT?: number;
  lastConfirmedTs?: number;
}

export interface UniverseBuildInput {
  candidateSymbols: string[];
  minVolatility24hPct: number;
  minTurnover24hUSDT: number;
  maxSymbols: number;
}

export interface UniverseBuildResult {
  symbols: string[];
  warmedSymbols: number;
}

export type TickerHandler = (symbol: string, patch: TickerPatch) => void;
export type KlineHandler = (symbol: string, tfMin: number, candle: KlineCandle) => void;

export type InstrumentSpecMap = Record<string, InstrumentSpec>;
