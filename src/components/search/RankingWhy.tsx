"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";

/** Çevirisi olan skor bileşenleri; bilinmeyen anahtarlar olduğu gibi gösterilir. */
const FACTORS = new Set(["priceFit", "rating", "popularity", "personal", "semantic"]);

/** "Bu sıralama neden?" — skor bileşenlerinin katkıları (DSA şeffaflığı). */
export default function RankingWhy({
  score,
  explain,
}: {
  score?: number;
  explain?: Record<string, number>;
}) {
  const t = useTranslations("ranking");
  if (score === undefined && !explain) return null;
  const entries = Object.entries(explain ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <details className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800">
      <summary className={`cursor-pointer font-semibold text-[#003580] ${focusRing}`}>
        {t("why")}
      </summary>
      {score !== undefined && (
        <p className="mt-1">{t("totalScore", { score: score.toFixed(3) })}</p>
      )}
      {entries.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {entries.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2">
              <span>{FACTORS.has(k) ? t(`factors.${k}.label`) : k}</span>
              <span>{v.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/ranking" className={`mt-1 inline-block underline ${focusRing}`}>
        {t("title")}
      </Link>
    </details>
  );
}
