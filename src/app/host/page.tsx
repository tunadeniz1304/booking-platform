"use client";

import { useTranslations } from "next-intl";
import HostDashboard from "@/components/host/HostDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Host extranet (P1-7): mülk düzenleme, oda ekleme, toplu takvim, rezervasyonlar, ilan metni önerisi. */
export default function HostPage() {
  const t = useTranslations("host");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <RoleGate roles={["HOST", "ADMIN"]}>{() => <HostDashboard />}</RoleGate>
    </PageShell>
  );
}
