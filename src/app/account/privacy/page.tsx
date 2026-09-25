"use client";

import { useTranslations } from "next-intl";
import PrivacyCenter from "@/components/privacy/PrivacyCenter";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** KVKK/GDPR self-servis (P2-5). */
export default function AccountPrivacyPage() {
  const t = useTranslations("privacy");
  return (
    <PageShell title={t("accountPage.title")} intro={t("accountPage.intro")}>
      <RoleGate>{() => <PrivacyCenter />}</RoleGate>
    </PageShell>
  );
}
