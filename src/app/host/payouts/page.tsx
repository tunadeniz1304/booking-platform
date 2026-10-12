"use client";

import { useTranslations } from "next-intl";
import HostPagesNav from "@/components/host/HostPagesNav";
import PayoutPanel from "@/components/host/PayoutPanel";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Ev sahibi ödemeleri (P1-4): emanette / serbest / rezerv / ödenen bakiye + payout geçmişi. */
export default function HostPayoutsPage() {
  const t = useTranslations("payouts");
  return (
    <PageShell
      title={t("page.title")}
      intro={
        <>
          <p>{t("page.intro")}</p>
          {/* Panel ve gelir paneline doğrudan geçiş; geçerli sayfa işaretli (F1124/F1294). */}
          <HostPagesNav className="mt-1" />
        </>
      }
    >
      <RoleGate roles={["HOST", "ADMIN"]}>{() => <PayoutPanel />}</RoleGate>
    </PageShell>
  );
}
