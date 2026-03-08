import { useCallback, useEffect, useState } from "react";
import {
  getConfigSelections,
  listBotPresets,
  listBots,
  listExecutionProfiles,
  saveConfigSelections,
  type BotMeta,
  type BotPresetMeta,
  type ExecutionProfileMeta,
} from "../api";

export function resolveSelectedBotPresetId(
  presets: BotPresetMeta[],
  selectedBotPresetId: string | null | undefined,
): string {
  const defaultPresetId = presets.find((p) => p.id === "default")?.id ?? presets[0]?.id ?? "default";
  const selected = String(selectedBotPresetId ?? "").trim();
  if (!selected) return defaultPresetId;
  return presets.some((p) => p.id === selected) ? selected : defaultPresetId;
}

export function useBotSelections() {
  const [bots, setBots] = useState<BotMeta[]>([]);
  const [botPresets, setBotPresets] = useState<BotPresetMeta[]>([]);
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfileMeta[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>("");
  const [selectedBotPresetId, setSelectedBotPresetId] = useState<string>("");
  const [selectedExecutionProfileId, setSelectedExecutionProfileId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [botsRes, selectionsRes, profilesRes] = await Promise.all([
        listBots(),
        getConfigSelections(),
        listExecutionProfiles(),
      ]);
      const botId = selectionsRes.selectedBotId || botsRes.selectedBotId || botsRes.bots[0]?.id || "";
      const presetsRes = await listBotPresets(botId);
      const resolvedPresetId = resolveSelectedBotPresetId(presetsRes.presets ?? [], selectionsRes.selectedBotPresetId);
      setBots(botsRes.bots ?? []);
      setExecutionProfiles(profilesRes.profiles ?? []);
      setSelectedBotId(botId);
      setSelectedBotPresetId(resolvedPresetId);
      setSelectedExecutionProfileId(selectionsRes.selectedExecutionProfileId || profilesRes.profiles?.[0]?.id || "");
      setBotPresets(presetsRes.presets ?? []);
      if (resolvedPresetId && selectionsRes.selectedBotPresetId !== resolvedPresetId) {
        await saveConfigSelections({ selectedBotPresetId: resolvedPresetId });
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const changeBotId = useCallback(async (botId: string) => {
    setSelectedBotId(botId);
    await saveConfigSelections({ selectedBotId: botId });
    const presetsRes = await listBotPresets(botId);
    setBotPresets(presetsRes.presets ?? []);
    const nextPresetId = resolveSelectedBotPresetId(presetsRes.presets ?? [], "");
    setSelectedBotPresetId(nextPresetId);
    if (nextPresetId) {
      await saveConfigSelections({ selectedBotPresetId: nextPresetId });
    }
  }, []);

  const changeBotPresetId = useCallback(async (id: string) => {
    setSelectedBotPresetId(id);
    await saveConfigSelections({ selectedBotPresetId: id });
  }, []);

  const changeExecutionProfileId = useCallback(async (id: string) => {
    setSelectedExecutionProfileId(id);
    await saveConfigSelections({ selectedExecutionProfileId: id });
  }, []);

  return {
    bots,
    botPresets,
    executionProfiles,
    selectedBotId,
    selectedBotPresetId,
    selectedExecutionProfileId,
    loading,
    error,
    reload,
    setSelectedBotId: changeBotId,
    setSelectedBotPresetId: changeBotPresetId,
    setSelectedExecutionProfileId: changeExecutionProfileId,
  };
}
