import type { RuntimeConfig } from "../../shared/types/domain";

export type PresetMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PresetFile = {
  meta: PresetMeta;
  config: RuntimeConfig;
};

export type PresetsListResponse = {
  presets: PresetMeta[];
};
