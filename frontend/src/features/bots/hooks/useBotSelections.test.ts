import { describe, expect, it } from "vitest";
import { resolveSelectedBotPresetId } from "./useBotSelections";

describe("resolveSelectedBotPresetId", () => {
  it("prefers explicitly selected preset", () => {
    const id = resolveSelectedBotPresetId(
      [
        { id: "default", botId: "oi-momentum-v1", name: "Default", updatedAt: 1 },
        { id: "x", botId: "oi-momentum-v1", name: "X", updatedAt: 2 },
      ],
      "x",
    );
    expect(id).toBe("x");
  });

  it("falls back to default preset when selection is empty", () => {
    const id = resolveSelectedBotPresetId(
      [
        { id: "default", botId: "oi-momentum-v1", name: "Default", updatedAt: 1 },
        { id: "x", botId: "oi-momentum-v1", name: "X", updatedAt: 2 },
      ],
      "",
    );
    expect(id).toBe("default");
  });

  it("falls back to first preset if default is absent", () => {
    const id = resolveSelectedBotPresetId(
      [{ id: "p1", botId: "oi-momentum-v1", name: "Preset", updatedAt: 1 }],
      "",
    );
    expect(id).toBe("p1");
  });
});

