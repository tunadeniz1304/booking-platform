"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  THEMES,
  THEME_COOKIE,
  resolveTheme,
  themeAttribute,
  type ThemePreference,
} from "@/lib/ui/theme";

const noopSubscribe = () => () => {};
const readCookie = (): ThemePreference =>
  resolveTheme(
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${THEME_COOKIE}=`))
      ?.slice(THEME_COOKIE.length + 1)
  );

/** Tema seçimi (sistem / açık / koyu): çereze yazılır, `<html data-theme>` anında güncellenir. */
export default function ThemeToggle() {
  const t = useTranslations("common.theme");
  // Sunucuda "system"; istemcide çerezden okunur (hidrasyon uyumsuzluğu olmadan).
  const stored = useSyncExternalStore(noopSubscribe, readCookie, () => "system" as const);
  const [chosen, setValue] = useState<ThemePreference | null>(null);
  const value = chosen ?? stored;
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        value={value}
        aria-label={t("label")}
        onChange={(e) => {
          const next = e.target.value as ThemePreference;
          setValue(next);
          document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          const attr = themeAttribute(next);
          if (attr) document.documentElement.dataset.theme = attr;
          else delete document.documentElement.dataset.theme;
        }}
        className="min-h-[1.75rem] rounded border border-white/40 bg-transparent px-1 py-0.5"
      >
        {THEMES.map((th) => (
          <option key={th} value={th} className="bg-white text-gray-900">
            {t(th)}
          </option>
        ))}
      </select>
    </label>
  );
}
