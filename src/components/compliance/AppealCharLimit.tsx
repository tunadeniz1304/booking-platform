"use client";

import { useTranslations } from "next-intl";

/** Alan ipucuna "n/max karakter" sayacı ekler (ipucu `aria-describedby` ile okunur). */
export function useAppealCountHint(): (hint: string, length: number, max: number) => string {
  const t = useTranslations("compliance.admin.fieldLimits");
  return (hint, length, max) => `${hint} · ${t("count", { count: length, max })}`;
}

/** Sınırın %90'ında ve sınırda bir kez duyurulur (her tuş vuruşunda değil). */
export function AppealCharLimitStatus({ length, max }: { length: number; max: number }) {
  const t = useTranslations("compliance.admin.fieldLimits");
  const text = length >= max ? t("reached") : length >= max * 0.9 ? t("near") : "";
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}
