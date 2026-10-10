import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { RANKING_WEIGHTS, RANKING_WEIGHTS_WITH_QUERY } from "@/lib/search/ranking";
import { focusRing } from "@/components/ui/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ranking");
  return { title: t("metaTitle") };
}

/** DSA ve Omnibus şeffaflık yükümlülükleri: sıralamanın ana parametreleri ve ağırlıkları. */
export default async function RankingExplainedPage() {
  const t = await getTranslations("ranking");
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main id="main" className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-4 text-gray-700">{t("intro")}</p>
        <div
          role="region"
          aria-label={t("table.caption")}
          tabIndex={0}
          className={`mt-6 overflow-x-auto ${focusRing}`}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-3">
                  {t("table.component")}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t("table.weightNoQuery")}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t("table.weightWithQuery")}
                </th>
                <th scope="col" className="py-2">
                  {t("table.description")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(RANKING_WEIGHTS) as Array<keyof typeof RANKING_WEIGHTS>).map((k) => (
                <tr key={k} className="border-b align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {t(`factors.${k}.label`)}
                  </th>
                  <td className="py-2 pr-3">
                    {t("weightValue", { value: Math.round(RANKING_WEIGHTS[k] * 100) })}
                  </td>
                  <td className="py-2 pr-3">
                    {t("weightValue", { value: Math.round(RANKING_WEIGHTS_WITH_QUERY[k] * 100) })}
                  </td>
                  <td className="py-2 text-gray-600">{t(`factors.${k}.description`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-gray-700">{t("withQueryNote")}</p>
        <p className="mt-2 text-sm text-gray-700">{t("experimentNote")}</p>
        <p className="mt-6 text-sm text-gray-500">{t("footnote")}</p>
      </main>
      <Footer />
    </div>
  );
}
