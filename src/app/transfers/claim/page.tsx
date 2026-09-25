"use client";

import { useTranslations } from "next-intl";
import ClaimForm from "@/components/transfers/ClaimForm";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Devir linkini açan alıcı: kart istemcide token'lanır, POST /api/transfers/claim. */
export default function ClaimPage() {
  const t = useTranslations("transfers");
  return (
    <PageShell title={t("claim.title")} intro={t("claim.intro")}>
      <RoleGate>{() => <ClaimForm />}</RoleGate>
    </PageShell>
  );
}
