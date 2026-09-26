"use client";

import { useTranslations } from "next-intl";
import PayoutAdmin from "@/components/admin/PayoutAdmin";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Yönetici payout kontrolü (P1-4): ev sahibi payout'larını durdur / devam ettir. */
export default function AdminPayoutsPage() {
  const t = useTranslations("payouts");
  return (
    <PageShell title={t("admin.pageTitle")} intro={t("admin.pageIntro")}>
      <RoleGate roles={["ADMIN"]}>{() => <PayoutAdmin />}</RoleGate>
    </PageShell>
  );
}
