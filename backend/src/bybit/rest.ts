import { fetch } from 'undici';
import {
  BYBIT_V5_REST_BASE_URL,
  type BybitInstrumentsInfoResponse,
  type InstrumentSpec,
} from './types';

const INSTRUMENTS_INFO_PATH = '/v5/market/instruments-info';
const PAGE_LIMIT = 1_000;

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchInstrumentsInfoLinear(
  baseUrl = BYBIT_V5_REST_BASE_URL,
): Promise<Record<string, InstrumentSpec>> {
  const specs: Record<string, InstrumentSpec> = {};
  let cursor: string | undefined;

  do {
    const url = new URL(INSTRUMENTS_INFO_PATH, baseUrl);
    url.searchParams.set('category', 'linear');
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Bybit instruments-info request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as BybitInstrumentsInfoResponse;
    if (payload.retCode !== 0) {
      throw new Error(
        `Bybit instruments-info request returned retCode=${payload.retCode}, retMsg=${payload.retMsg}`,
      );
    }

    const list = payload.result?.list ?? [];
    for (const item of list) {
      const symbol = item.symbol;
      const tickSize = toNumber(item.priceFilter?.tickSize);
      const qtyStep = toNumber(item.lotSizeFilter?.qtyStep);
      const minQty = toNumber(item.lotSizeFilter?.minOrderQty);

      if (!symbol || tickSize === undefined || qtyStep === undefined || minQty === undefined) {
        continue;
      }

      specs[symbol] = {
        symbol,
        tickSize,
        qtyStep,
        minQty,
      };
    }

    cursor = payload.result?.nextPageCursor || undefined;
  } while (cursor);

  return specs;
}
