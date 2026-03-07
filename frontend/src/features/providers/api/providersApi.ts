import { getJson } from "../../../shared/api/http";
import { getApiBase } from "../../../shared/config/env";

export type ProviderCapabilityStatus =
  | "ok"
  | "missing_key"
  | "plan_unsupported"
  | "rate_limited"
  | "http_error";

export type ProviderCapabilityCheck = {
  id: string;
  provider: "bybit" | "coinglass";
  label: string;
  required: boolean;
  status: ProviderCapabilityStatus;
  available: boolean;
  message: string;
  latencyMs: number | null;
};

export type ProviderCapabilitiesResponse = {
  ok: boolean;
  nowMs: number;
  bybitRestUrl: string;
  coinglassBaseUrl: string;
  checks: ProviderCapabilityCheck[];
  summary: {
    total: number;
    available: number;
    requiredTotal: number;
    requiredAvailable: number;
  };
};

export async function getProviderCapabilities(botId?: string): Promise<ProviderCapabilitiesResponse> {
  const base = getApiBase();
  const query = botId ? `?botId=${encodeURIComponent(botId)}` : "";
  return getJson(`${base}/api/providers/capabilities${query}`);
}
