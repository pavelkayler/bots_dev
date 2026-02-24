import type { RuntimeConfig } from "../../shared/types/domain";

export type PresetMeta = {
  id: string;
  name: string;
  updatedAt: number;
};

export type PresetFile = {
  id: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
  config: RuntimeConfig;
};

export type PresetsListResponse = {
  presets: PresetMeta[];
};
