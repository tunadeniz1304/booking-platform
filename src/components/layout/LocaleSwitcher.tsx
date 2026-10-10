"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE } from "@/i18n/config";

/** Dil seçimi çerezde saklanır (1 yıl); URL değişmez. */
/**
 * `className` select'e eklenir (ör. başlığın odak halkası); `showLabel` etiketi görünür
 * yapar ve seçiciyi tam genişlik, 44 px dokunma hedefi olarak çizer (mobil menü).
 */
export default function LocaleSwitcher({
  className = "",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();
  return (
    <label
      className={`flex items-center text-sm ${showLabel ? "justify-between gap-3 px-3" : "gap-1"}`}
    >
      <span className={showLabel ? "font-medium" : "sr-only"}>{t("label")}</span>
      <select
        value={locale}
        aria-label={t("label")}
        onChange={(e) => {
          const next = e.target.value;
          document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          // Oturum açıksa kalıcı tercih (e-posta dili) de güncellenir; misafirde 401 sessizce yok sayılır.
          void fetch("/api/user/locale", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale: next }),
          }).catch(() => undefined);
          router.refresh();
        }}
        className={`rounded border border-white/40 bg-transparent px-1 py-0.5 ${showLabel ? "min-h-[44px] min-w-0 flex-1 sm:flex-none" : "min-h-[1.75rem]"} ${className}`}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="bg-white text-gray-900">
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
