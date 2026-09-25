"use client";

import { useTranslations } from "next-intl";
import RevenueDashboard from "@/components/host/RevenueDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Host gelir paneli (P1-5): doluluk, ADR, RevPAR, pickup ve sınırlı fiyat önerileri. */
export default function HostRevenuePage() {
  const t = useTranslations("revenue");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <RoleGate roles={["HOST", "ADMIN"]}>{() => <RevenueDashboard />}</RoleGate>
    </PageShell>
  );
}
