import { getApiBase } from "../../../shared/config/env";
import { getJson } from "../../../shared/api/http";
import type { EventsTailResponse } from "../../../shared/types/domain";

export async function fetchEventsTail(limit: number): Promise<EventsTailResponse> {
  const api = getApiBase();
  return getJson<EventsTailResponse>(`${api}/api/session/events?limit=${encodeURIComponent(String(limit))}`);
}
