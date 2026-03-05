import { describe, expect, it } from "vitest";
import { ROUTER_FUTURE_FLAGS, ROUTER_PROVIDER_FUTURE_FLAGS } from "./routing/futureFlags";

describe("App router future flags", () => {
  it("enables v7_startTransition on RouterProvider", () => {
    expect(ROUTER_PROVIDER_FUTURE_FLAGS.v7_startTransition).toBe(true);
  });

  it("keeps v7_relativeSplatPath enabled on router config", () => {
    expect(ROUTER_FUTURE_FLAGS.v7_relativeSplatPath).toBe(true);
  });
});
