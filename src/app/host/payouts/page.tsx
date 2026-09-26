"use client";

import { useTranslations } from "next-intl";
import PayoutPanel from "@/components/host/PayoutPanel";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Ev sahibi ödemeleri (P1-4): emanette / serbest / rezerv / ödenen bakiye + payout geçmişi. */
export default function HostPayoutsPage() {
  const t = useTranslations("payouts");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <RoleGate roles={["HOST", "ADMIN"]}>{() => <PayoutPanel />}</RoleGate>
    </PageShell>
  );
}
