export const OPTIMIZER_TF_OPTIONS = [
  { value: 5, disabled: false },
  { value: 10, disabled: false },
  { value: 15, disabled: false },
  { value: 30, disabled: false },
  { value: 60, disabled: false },
  { value: 120, disabled: false },
  { value: 240, disabled: false },
] as const;

export const OPTIMIZER_TF_ENABLED_VALUES = OPTIMIZER_TF_OPTIONS.filter((it) => !it.disabled).map((it) => it.value);
