export const DEFAULT_OPTIMIZER_STORAGE_BOT_ID = "oi-momentum-v1";
const STORAGE_PREFIX = "bots_dev.optimizer";

export function resolveOptimizerStorageBotId(activeBotId: string | null | undefined): string {
  const trimmed = String(activeBotId ?? "").trim();
  return trimmed || DEFAULT_OPTIMIZER_STORAGE_BOT_ID;
}

export function makeOptimizerScopedStorageKey(activeBotId: string | null | undefined, suffix: string): string {
  const scope = resolveOptimizerStorageBotId(activeBotId);
  return `${STORAGE_PREFIX}.${scope}.${suffix}`;
}

