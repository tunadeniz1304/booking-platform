"use client";

import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Card, Status, useLoader } from "@/components/ui/ui";

interface PartyRiskItem {
  bookingId: string;
  propertyTitle: string;
  status: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  score: number;
  reasons: string[];
}

/**
 * Host paneli ▸ parti riski uyarıları (P1-6): eşik üstündeki yaklaşan rezervasyonlar ve
 * açıklanabilir gerekçe kodları. Yalnızca bilgilendirir; rezervasyonu değiştirmez.
 */
export default function PartyRiskPanel() {
  const t = useTranslations("trust.partyRisk");
  const { data, error } = useLoader(() =>
    apiFetch<{ items: PartyRiskItem[] }>("/api/host/trust/party-risk").then((r) => r.items)
  );
  const label = (r: string) => (t.has(`reasons.${r}`) ? t(`reasons.${r}`) : r);

  return (
    <Card title={t("title")} id="host-party-risk">
      <p className="mb-3 text-sm text-gray-600">{t("intro")}</p>
      <Status error={error ? t("loadFailed") : null} />
      {data === null && !error && <p className="text-sm text-gray-600">{t("loading")}</p>}
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("empty")}</p>}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">{t("caption")}</caption>
            <thead>
              <tr className="border-b border-gray-200 text-gray-700">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.property")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.dates")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.guests")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.score")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("columns.reasons")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.bookingId} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3">{i.propertyTitle}</td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {i.checkIn} → {i.checkOut}
                  </td>
                  <td className="py-2 pr-3">{i.guestCount}</td>
                  <td className="py-2 pr-3 font-semibold text-red-800">{i.score}</td>
                  <td className="py-2">{i.reasons.map(label).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
