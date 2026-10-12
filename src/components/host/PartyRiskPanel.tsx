"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Status, focusRing, useLoader } from "@/components/ui/ui";

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

/** `threshold` eski API yanıtlarında yok; varsa giriş metninde eşik sayısı gösterilir. */
interface PartyRiskResponse {
  items: PartyRiskItem[];
  threshold?: number;
}

const linkClass = `inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] hover:underline sm:min-h-0 ${focusRing}`;

/**
 * Host paneli ▸ parti riski uyarıları (P1-6): eşik üstündeki yaklaşan rezervasyonlar ve
 * açıklanabilir gerekçe kodları. Yalnızca bilgilendirir; rezervasyonu değiştirmez.
 */
export default function PartyRiskPanel() {
  const t = useTranslations("trust.partyRisk");
  const f = useFormat();
  const captionId = useId();
  const [retrying, setRetrying] = useState(false);
  const { data, error, reload } = useLoader(() =>
    apiFetch<PartyRiskResponse>("/api/host/trust/party-risk").finally(() => setRetrying(false))
  );
  const items = data?.items ?? null;
  const threshold = typeof data?.threshold === "number" ? data.threshold : null;
  const label = (r: string) => (t.has(`reasons.${r}`) ? t(`reasons.${r}`) : r);
  // Aynı sayfadaki rezervasyon tablosuyla eşleşsin diye aynı kısa kimlik (HostDashboard).
  const bookingRef = (id: string) => id.slice(-8);

  return (
    <Card title={t("title")} id="host-party-risk">
      <p className="mb-3 text-sm text-gray-600">
        {t("intro")} {threshold !== null ? t("scaleWithThreshold", { threshold }) : t("scale")}
      </p>
      <Status error={error ? t("loadFailed") : null} />
      {error && (
        <Button
          variant="secondary"
          className="mt-2"
          busy={retrying}
          onClick={() => {
            setRetrying(true);
            reload();
          }}
        >
          {t("retry")}
        </Button>
      )}
      {items === null && !error && <p className="text-sm text-gray-600">{t("loading")}</p>}
      {items?.length === 0 && <p className="text-sm text-gray-700">{t("empty")}</p>}
      {items && items.length > 0 && (
        <div
          className={`relative max-w-full overflow-x-auto ${focusRing}`}
          role="region"
          aria-labelledby={captionId}
          tabIndex={0}
        >
          <table className="min-w-full text-left text-sm">
            <caption id={captionId} className="sr-only">
              {t("caption")}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-gray-700">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.property")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.booking")}
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
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("columns.reasons")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("columns.contact")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const from = f.date(i.checkIn, "short");
                return (
                  <tr key={i.bookingId} className="border-b border-gray-100 align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {i.propertyTitle}
                    </th>
                    <td className="py-2 pr-3 font-mono">{bookingRef(i.bookingId)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {t("dateRange", { from, to: f.date(i.checkOut, "short") })}
                    </td>
                    <td className="py-2 pr-3">{i.guestCount}</td>
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold text-red-800">
                      {t("scoreValue", { score: i.score })}
                    </td>
                    <td className="py-2 pr-3">{i.reasons.map(label).join(", ")}</td>
                    <td className="py-2">
                      {/* Mesajlaşma yalnız onaylı rezervasyonda açık (message-service). */}
                      {i.status === "CONFIRMED" ? (
                        <Link href={"/host/messages/" + i.bookingId} className={linkClass}>
                          {t("messageGuest")}
                          <span className="sr-only">
                            : {i.propertyTitle}, {from}
                          </span>
                        </Link>
                      ) : (
                        <span>{t("messageAfterConfirm")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
