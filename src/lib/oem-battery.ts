export const OEM_BATTERY_FAMILIES = [
  "xiaomi",
  "samsung",
  "huawei",
  "oppo",
  "tecno",
] as const;

export type OemBatteryFamily = (typeof OEM_BATTERY_FAMILIES)[number];

export const OEM_STEP_KEYS = ["s1", "s2", "s3", "s4"] as const;
