import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RANKING_WEIGHTS, RANKING_WEIGHTS_WITH_QUERY } from "@/lib/search/ranking";
import { Card, PageShell, focusRing } from "@/components/ui/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ranking");
  return { title: t("metaTitle") };
}

type RankingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const link = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`;

/** DSA ve Omnibus şeffaflık yükümlülükleri: sıralamanın ana parametreleri ve ağırlıkları. */
// F1138/F1358: ortak PageShell ve çıkış yolları; `from`, dönülecek arama sorgusudur.
export default async function RankingExplainedPage({ searchParams }: RankingPageProps) {
  const t = await getTranslations("ranking");
  const from = (await searchParams)?.from;
  const fromRaw = typeof from === "string" ? from : "";
  const fromQuery = fromRaw
    ? new URLSearchParams(fromRaw.slice(fromRaw.indexOf("?") + 1)).toString()
    : "";
  // F1115: varsayılan ağırlığa göre azalan sıra; çubuk yalnızca görsel orantı.
  const factors = (Object.keys(RANKING_WEIGHTS) as Array<keyof typeof RANKING_WEIGHTS>).sort(
    (a, b) => RANKING_WEIGHTS[b] - RANKING_WEIGHTS[a]
  );
  const weight = (value: number) => (
    <>
      {t("weightValue", { value: Math.round(value * 100) })}
      <span aria-hidden="true" className="ml-auto mt-1 block h-1.5 w-20 rounded-full bg-gray-200">
        <span
          className="block h-1.5 rounded-full bg-[#003580]"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
    </>
  );

  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <nav aria-label={t("nav.label")} className="flex flex-wrap gap-x-6 text-sm">
        <Link href={fromQuery ? `/search?${fromQuery}` : "/search"} className={link}>
          {fromQuery && <span aria-hidden="true">←&nbsp;</span>}
          {fromQuery ? t("nav.backToResults") : t("nav.search")}
        </Link>
        <Link href="/trust" className={link}>
          {t("nav.trust")}
        </Link>
      </nav>
      <Card>
        {/* F1139: dar ekranda dört sütun sıkışmasın diye bileşenler kart listesi olarak. */}
        <ul aria-label={t("table.caption")} className="divide-y text-sm sm:hidden">
          {factors.map((k) => (
            <li key={k} className="py-3 first:pt-0">
              <p className="font-medium text-gray-900">{t(`factors.${k}.label`)}</p>
              <p className="mt-1 text-gray-600">{t(`factors.${k}.description`)}</p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt className="text-gray-700">{t("table.weightNoQuery")}</dt>
                <dd className="text-right font-medium tabular-nums text-gray-900">
                  {weight(RANKING_WEIGHTS[k])}
                </dd>
                <dt className="text-gray-700">{t("table.weightWithQuery")}</dt>
                <dd className="text-right font-medium tabular-nums text-gray-900">
                  {weight(RANKING_WEIGHTS_WITH_QUERY[k])}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
        <div
          role="region"
          aria-label={t("table.caption")}
          tabIndex={0}
          className={`hidden overflow-x-auto sm:block ${focusRing}`}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-3">
                  {t("table.component")}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t("table.weightNoQuery")}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t("table.weightWithQuery")}
                </th>
                <th scope="col" className="py-2 pl-3">
                  {t("table.description")}
                </th>
              </tr>
            </thead>
            <tbody>
              {factors.map((k) => (
                <tr key={k} className="border-b align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {t(`factors.${k}.label`)}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {weight(RANKING_WEIGHTS[k])}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {weight(RANKING_WEIGHTS_WITH_QUERY[k])}
                  </td>
                  <td className="py-2 pl-3 text-gray-600">{t(`factors.${k}.description`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-gray-700">{t("withQueryNote")}</p>
        <p className="mt-2 text-sm text-gray-700">{t("experimentNote")}</p>
        <p className="mt-4 text-sm text-gray-500">{t("footnote")}</p>
      </Card>
    </PageShell>
  );
}
