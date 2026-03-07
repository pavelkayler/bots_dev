import { describe, expect, it } from "vitest";
import {
  defaultFollowTailStartInput,
  parseDatetimeLocalInput,
  resolveDatasetWindowInput,
  toDatetimeLocalInput,
} from "./datasetWindow";

describe("datasetWindow utils", () => {
  it("formats and parses datetime-local input", () => {
    const ts = Date.UTC(2026, 2, 6, 10, 30);
    const text = toDatetimeLocalInput(ts);
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const parsed = parseDatetimeLocalInput(text);
    expect(parsed).not.toBeNull();
  });

  it("returns empty payload for snapshot mode", () => {
    const out = resolveDatasetWindowInput({
      datasetMode: "snapshot",
      followTailStartInput: "",
    });
    expect(out.error).toBeUndefined();
    expect(out.timeRangeFromTs).toBeUndefined();
    expect(out.timeRangeToTs).toBeUndefined();
  });

  it("requires start date for follow tail mode", () => {
    const out = resolveDatasetWindowInput({
      datasetMode: "followTail",
      followTailStartInput: "",
    });
    expect(out.error).toContain("required");
  });

  it("returns fromTs and null toTs for follow tail mode", () => {
    const start = defaultFollowTailStartInput(Date.UTC(2026, 2, 6, 12, 0));
    const out = resolveDatasetWindowInput({
      datasetMode: "followTail",
      followTailStartInput: start,
    });
    expect(out.error).toBeUndefined();
    expect(typeof out.timeRangeFromTs).toBe("number");
    expect(out.timeRangeToTs).toBeNull();
  });
});

