"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { useFormat } from "@/i18n/use-format";
import {
  RANKING_WEIGHTS,
  RANKING_WEIGHTS_WITH_QUERY,
  type RankingComponent,
} from "@/lib/search/ranking";

/** Sıralamada kullanılan ağırlık kümesi: sorgusuz, sorgulu ya da deneysel LTR modeli. */
export type RankingWeightsSet = "default" | "withQuery" | "ltr";

/** Çevirisi olan skor bileşenleri; bilinmeyen anahtarlar gösterilmez. */
const FACTORS = new Set<string>(Object.keys(RANKING_WEIGHTS));

/** Skor 0..1 aralığındaki ağırlıklı toplamdır; ekranda 100 üzerinden puan olarak gösterilir. */
const SCALE = 100;

/** "Bu sıralama neden?" — skor bileşenlerinin katkıları (DSA şeffaflığı). */
export default function RankingWhy({
  score,
  explain,
  weightsSet,
}: {
  score?: number;
  explain?: Record<string, number>;
  weightsSet?: RankingWeightsSet;
}) {
  const t = useTranslations("ranking");
  const f = useFormat();
  if (score === undefined && !explain) return null;

  const entries = Object.entries(explain ?? {})
    .filter(([k, v]) => FACTORS.has(k) && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]) as Array<[RankingComponent, number]>;
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  // Ağırlıklı sıralamada skor katkıların toplamıdır; tutmuyorsa skor deneysel modelden gelir.
  const experimental =
    weightsSet === "ltr" ||
    (weightsSet === undefined &&
      score !== undefined &&
      entries.length > 0 &&
      Math.abs(score - sum) > 0.001);
  const weights =
    weightsSet === "default"
      ? RANKING_WEIGHTS
      : weightsSet === "withQuery"
        ? RANKING_WEIGHTS_WITH_QUERY
        : null;
  const points = (v: number) => f.number(v * SCALE, { maximumFractionDigits: 1 });
  const total = entries.length > 0 ? sum : score;
  const setNote = experimental ? "ltr" : weightsSet;

  return (
    <details className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800">
      <summary className={`cursor-pointer font-semibold text-[#003580] ${focusRing}`}>
        {t("why")}
      </summary>
      {setNote && <p className="mt-1">{t(`weightsSet.${setNote}`)}</p>}
      {!experimental && total !== undefined && (
        <p className="mt-1">{t("totalScore", { score: points(total) })}</p>
      )}
      {entries.length > 0 && (
        <ul className="mt-1 space-y-1">
          {entries.map(([k, v]) => {
            const max = weights ? weights[k] : null;
            return (
              <li key={k}>
                <div className="flex justify-between gap-2">
                  <span>{t(`factors.${k}.label`)}</span>
                  <span>
                    {max !== null
                      ? t("factorOutOf", { points: points(v), max: points(max) })
                      : t("factorPoints", { points: points(v) })}
                  </span>
                </div>
                {max !== null && max > 0 && (
                  <div className="mt-0.5 h-1 rounded-full bg-gray-200" aria-hidden="true">
                    <div
                      className="h-1 rounded-full bg-[#003580]"
                      style={{ width: `${Math.min(100, Math.max(0, (v / max) * 100))}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/ranking" className={`mt-1 inline-block underline ${focusRing}`}>
        {t("title")}
      </Link>
    </details>
  );
}
