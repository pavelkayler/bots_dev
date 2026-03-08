import { useEffect, useMemo, useState } from "react";
import type { ConfigResponse, RuntimeConfig } from "../../../shared/types/domain";
import { fetchRuntimeConfig, updateRuntimeConfig } from "../api/configApi";

function deepClone<T>(x: T): T {
  return structuredClone(x);
}

type UseRuntimeConfigOptions = {
  selectedBotId?: string;
  selectedBotPresetId?: string;
};

export function useRuntimeConfig(options?: UseRuntimeConfigOptions) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastApplied, setLastApplied] = useState<ConfigResponse["applied"] | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  async function reload() {
    setError(null);
    try {
      let cfg = await fetchRuntimeConfig();
      const needsBotSelection = Boolean(options?.selectedBotId) && cfg.selectedBotId !== options?.selectedBotId;
      const needsPresetSelection = Boolean(options?.selectedBotPresetId) && cfg.selectedBotPresetId !== options?.selectedBotPresetId;
      if (needsBotSelection || needsPresetSelection) {
        await updateRuntimeConfig({
          ...(options?.selectedBotId ? { selectedBotId: options.selectedBotId } : {}),
          ...(options?.selectedBotPresetId ? { selectedBotPresetId: options.selectedBotPresetId } : {}),
        });
        cfg = await fetchRuntimeConfig();
      }
      setConfig(cfg);
      setDraft(deepClone(cfg));
      setLastApplied(null);
      setLastSavedAt(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    void reload();
  }, [options?.selectedBotId, options?.selectedBotPresetId]);

  const dirty = useMemo(() => {
    if (!config || !draft) return false;
    return JSON.stringify(config) !== JSON.stringify(draft);
  }, [config, draft]);

  async function save(nextDraft?: RuntimeConfig) {
    const payload = nextDraft ?? draft;
    if (!payload) return;
    setError(null);
    setSaving(true);
    try {
      const res = await updateRuntimeConfig({
        ...payload,
        ...(options?.selectedBotId ? { selectedBotId: options.selectedBotId } : {}),
        ...(options?.selectedBotPresetId ? { selectedBotPresetId: options.selectedBotPresetId } : {}),
      });
      setConfig(res.config);
      setDraft(deepClone(res.config));
      setLastApplied(res.applied ?? null);
      setLastSavedAt(Date.now());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (!config) return;
    setDraft(deepClone(config));
  }

  return { config, draft, setDraft, dirty, error, saving, lastApplied, lastSavedAt, reload, save, reset };
}
