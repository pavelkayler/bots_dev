import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProviderCapabilities } from "../api/providerCapabilities.js";

const originalCoinGlassKey = process.env.COINGLASS_API_KEY;

afterEach(() => {
  if (originalCoinGlassKey == null) delete process.env.COINGLASS_API_KEY;
  else process.env.COINGLASS_API_KEY = originalCoinGlassKey;
});

describe("provider capabilities", () => {
  it("marks required Bybit checks as available with healthy responses", async () => {
    delete process.env.COINGLASS_API_KEY;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.bybit.com")) {
        if (url.includes("/v5/market/open-interest")) {
          return new Response(JSON.stringify({ retCode: 0, result: { list: [{ timestamp: "1", openInterest: "1" }] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ retCode: 0, result: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const checks = await collectProviderCapabilities({ fetchImpl });
    const required = checks.filter((row) => row.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required.every((row) => row.available)).toBe(true);
    const cg = checks.find((row) => row.id === "coinglass_oi_1m_history");
    expect(cg?.status).toBe("missing_key");
  });

  it("shows plan_unsupported for CoinGlass when API returns upgrade requirement", async () => {
    process.env.COINGLASS_API_KEY = "x";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.bybit.com")) {
        if (url.includes("/v5/market/open-interest")) {
          return new Response(JSON.stringify({ retCode: 0, result: { list: [{ timestamp: "1", openInterest: "1" }] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ retCode: 0, result: {} }), { status: 200 });
      }
      if (url.includes("open-api-v3.coinglass.com")) {
        return new Response(JSON.stringify({ code: 40001, msg: "interval is not available" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const checks = await collectProviderCapabilities({ fetchImpl });
    const cg = checks.find((row) => row.id === "coinglass_oi_1m_history");
    expect(cg?.status).toBe("plan_unsupported");
    expect(cg?.available).toBe(false);
  });

  it("uses Bybit public trades as required CVD source for signal bot checks", async () => {
    process.env.COINGLASS_API_KEY = "x";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.bybit.com")) {
        if (url.includes("/v5/market/open-interest")) {
          return new Response(JSON.stringify({ retCode: 0, result: { list: [{ timestamp: "1", openInterest: "1" }] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ retCode: 0, result: {} }), { status: 200 });
      }
      if (url.includes("open-api-v4.coinglass.com") || url.includes("open-api-v3.coinglass.com")) {
        return new Response(JSON.stringify({ code: 403, msg: "interval unavailable" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const checks = await collectProviderCapabilities({ botId: "signal-multi-factor-v1", fetchImpl });
    const cvdBybit = checks.find((row) => row.id === "signal_cvd_source_bybit");
    const oldCgCvd = checks.find((row) => row.id === "signal_cvd_history_5m");
    expect(cvdBybit?.required).toBe(true);
    expect(cvdBybit?.available).toBe(true);
    expect(oldCgCvd).toBeUndefined();
  });
});
