"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE } from "@/i18n/config";

/** Dil seçimi çerezde saklanır (1 yıl); URL değişmez. */
export default function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        aria-label={t("label")}
        onChange={(e) => {
          document.cookie = `${LOCALE_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="rounded border border-white/40 bg-transparent px-1 py-0.5"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="text-gray-900">
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
