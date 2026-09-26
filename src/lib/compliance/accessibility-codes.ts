/**
 * P1-13(e): erişilebilirlik özelliği kodları — istemci/sunucu ortak (Prisma'sız) liste.
 * `AccessibilityCode` Prisma enum'u ile birebir aynı olmalı (birim testi karşılaştırır).
 */
export const ACCESSIBILITY_CODES = [
  "STEP_FREE_ENTRANCE",
  "STEP_FREE_PATH_TO_ROOM",
  "ROLL_IN_SHOWER",
  "GRAB_BARS",
  "SHOWER_CHAIR",
  "ACCESSIBLE_PARKING",
  "WIDE_DOORWAY",
  "ELEVATOR",
  "VISUAL_ALARM",
  "LOWERED_BED",
  "ACCESSIBLE_TOILET",
] as const;

export type AccessibilityCodeValue = (typeof ACCESSIBILITY_CODES)[number];

/** Yalnız bu kod için genişlik (cm) girilebilir. */
export const WIDTH_CODE: AccessibilityCodeValue = "WIDE_DOORWAY";
export const MIN_WIDTH_CM = 50;
export const MAX_WIDTH_CM = 300;

export function isAccessibilityCode(value: string): value is AccessibilityCodeValue {
  return (ACCESSIBILITY_CODES as readonly string[]).includes(value);
}

/**
 * `accessibility=CODE,CODE` URL değerini ayrıştırır: büyük harfe çevirir, tekilleştirir,
 * sıralar (önbellek anahtarı kararlı olsun). Bilinmeyen kod `invalid` içinde döner.
 */
export function parseAccessibilityParam(raw: string | null | undefined): {
  codes: AccessibilityCodeValue[];
  invalid: string[];
} {
  const codes = new Set<AccessibilityCodeValue>();
  const invalid: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const value = part.trim().toUpperCase();
    if (!value) continue;
    if (isAccessibilityCode(value)) codes.add(value);
    else invalid.push(part.trim());
  }
  return { codes: [...codes].sort(), invalid };
}
