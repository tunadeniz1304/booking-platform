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
/**
 * `className` select'e eklenir (ör. başlığın odak halkası); `showLabel` etiketi görünür
 * yapar ve seçiciyi tam genişlik, 44 px dokunma hedefi olarak çizer (mobil menü).
 */
export default function ThemeToggle({
  className = "",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const t = useTranslations("common.theme");
  // Sunucuda "system"; istemcide çerezden okunur (hidrasyon uyumsuzluğu olmadan).
  const stored = useSyncExternalStore(noopSubscribe, readCookie, () => "system" as const);
  const [chosen, setValue] = useState<ThemePreference | null>(null);
  const value = chosen ?? stored;
  return (
    <label
      className={`flex items-center text-sm ${showLabel ? "justify-between gap-3 px-3" : "gap-1"}`}
    >
      <span className={showLabel ? "font-medium" : "sr-only"}>{t("label")}</span>
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
        className={`rounded border border-white/40 bg-transparent px-1 py-0.5 ${showLabel ? "min-h-[44px] min-w-0 flex-1 sm:flex-none" : "min-h-[1.75rem]"} ${className}`}
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
