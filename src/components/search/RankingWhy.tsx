"use client";

import Link from "next/link";
import { focusRing } from "@/components/ui/ui";

const LABELS: Record<string, string> = {
  priceFit: "Fiyat uyumu",
  rating: "Misafir puanı",
  popularity: "Yorum sayısı",
  personal: "Kişiselleştirme",
  semantic: "Arama metni benzerliği",
};

/** "Bu sıralama neden?" — skor bileşenlerinin katkıları (DSA şeffaflığı). */
export default function RankingWhy({
  score,
  explain,
}: {
  score?: number;
  explain?: Record<string, number>;
}) {
  if (score === undefined && !explain) return null;
  const entries = Object.entries(explain ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <details className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800">
      <summary className={`cursor-pointer font-semibold text-[#003580] ${focusRing}`}>
        Bu sıralama neden?
      </summary>
      {score !== undefined && <p className="mt-1">Toplam skor: {score.toFixed(3)}</p>}
      {entries.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {entries.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2">
              <span>{LABELS[k] ?? k}</span>
              <span>{v.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/ranking" className={`mt-1 inline-block underline ${focusRing}`}>
        Sıralama nasıl çalışır?
      </Link>
    </details>
  );
}
