"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE } from "@/i18n/config";
import { useSessionUserCache } from "./useSessionUserCache";

/** Kapalı select'te değeri hemen değiştiren tuşlar (Windows: ok, Home/End, PageUp/PageDown). */
const NAV_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];
/** Tuşun ardından bu süre içinde gelen change klavyeyle gezinmedir (aynı görevde tetiklenir). */
const KEY_CHANGE_WINDOW_MS = 250;

function changesValueByKey(e: KeyboardEvent<HTMLSelectElement>): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  // Boşluk açılır listeyi açar; diğer tek karakterler harfle aramadır.
  return NAV_KEYS.includes(e.key) || (e.key.length === 1 && e.key !== " ");
}

/** Dil seçimi çerezde saklanır (1 yıl); URL değişmez. */
/**
 * `className` select'e eklenir (ör. başlığın odak halkası); `showLabel` etiketi görünür
 * yapar ve seçiciyi tam genişlik, 44 px dokunma hedefi olarak çizer (mobil menü).
 * WCAG 3.2.2: ok tuşlarıyla gezinmek dili değiştirmez; seçim Enter ya da odak çıkışıyla
 * uygulanır, Escape vazgeçer. Fareyle (ya da açılır listeden) seçim hemen uygulanır.
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
  const user = useSessionUserCache();
  const [draft, setDraft] = useState<string | null>(null);
  const [requested, setRequested] = useState(locale);
  const [isPending, startTransition] = useTransition();
  const lastKeyAt = useRef(-Infinity);
  /** Yenileme sürerken istenen dil gösterilir; seçici eski dile geri sıçramaz. */
  const current = isPending ? requested : locale;

  const apply = (next: string) => {
    setDraft(null);
    if (next === current) return;
    setRequested(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Oturum açıksa kalıcı tercih (e-posta dili) de güncellenir; misafirde istek atılmaz.
    if (user !== null) {
      void fetch("/api/user/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => undefined);
    }
    startTransition(() => router.refresh());
  };

  const status = isPending ? t("switching") : draft !== null ? t("applyHint") : "";

  return (
    <>
      <label
        className={`flex items-center text-sm ${showLabel ? "justify-between gap-3 px-3" : "gap-1"}`}
      >
        <span className={showLabel ? "font-medium" : "sr-only"}>{t("label")}</span>
        <select
          value={draft ?? current}
          aria-label={t("label")}
          aria-busy={isPending || undefined}
          onKeyDown={(e) => {
            if (draft !== null && e.key === "Enter") {
              e.preventDefault();
              apply(draft);
              return;
            }
            if (draft !== null && e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
              return;
            }
            lastKeyAt.current = changesValueByKey(e) ? performance.now() : -Infinity;
          }}
          onChange={(e) => {
            const next = e.target.value;
            if (performance.now() - lastKeyAt.current < KEY_CHANGE_WINDOW_MS) {
              lastKeyAt.current = -Infinity;
              setDraft(next === current ? null : next);
              return;
            }
            apply(next);
          }}
          onBlur={() => {
            if (draft !== null) apply(draft);
          }}
          className={`rounded border border-white/40 bg-transparent px-1 py-0.5 aria-busy:cursor-progress aria-busy:opacity-60 ${showLabel ? "min-h-[44px] min-w-0 flex-1 sm:flex-none" : "min-h-[1.75rem]"} ${className}`}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l} className="bg-white text-gray-900">
              {t(l)}
            </option>
          ))}
        </select>
      </label>
      <span role="status" className="sr-only">
        {status}
      </span>
    </>
  );
}
