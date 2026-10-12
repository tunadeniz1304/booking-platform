"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell, focusRing } from "@/components/ui/ui";
import TripsView from "@/components/pwa/TripsView";
import PushToggle from "@/components/pwa/PushToggle";

/** Ödemesi bekleyen, geçmiş ve iptal edilen rezervasyonlar hesap sayfasında listelenir. */
const ALL_BOOKINGS_HREF = "/account#account-bookings";

/** Seyahatlerim (P1-12): çevrimdışı açılan rezervasyon kartları + push ayarı. */
export default function TripsPage() {
  const t = useTranslations("pwa.trips");
  return (
    <PageShell
      title={t("title")}
      intro={
        <>
          <p>{t("intro")}</p>
          <p className="mt-1">
            {t.rich("introScope", {
              link: (chunks) => (
                <Link
                  href={ALL_BOOKINGS_HREF}
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </>
      }
    >
      <TripsView />
      <PushToggle />
    </PageShell>
  );
}
