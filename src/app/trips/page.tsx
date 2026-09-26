"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/ui/ui";
import TripsView from "@/components/pwa/TripsView";
import PushToggle from "@/components/pwa/PushToggle";

/** Seyahatlerim (P1-12): çevrimdışı açılan rezervasyon kartları + push ayarı. */
export default function TripsPage() {
  const t = useTranslations("pwa.trips");
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <TripsView />
      <PushToggle />
    </PageShell>
  );
}
