"use client";

import { useTranslations } from "next-intl";
import AccountBreadcrumb from "@/components/account/AccountBreadcrumb";
import PrivacyCenter from "@/components/privacy/PrivacyCenter";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** KVKK/GDPR self-servis (P2-5). */
export default function AccountPrivacyPage() {
  const t = useTranslations("privacy");
  return (
    <PageShell
      title={t("accountPage.title")}
      intro={
        <>
          {/* Hesap merkezine dönüş ve konum (F1083). */}
          <AccountBreadcrumb current={t("accountPage.title")} />
          <p className="mt-1">{t("accountPage.intro")}</p>
        </>
      }
    >
      <RoleGate>{() => <PrivacyCenter />}</RoleGate>
    </PageShell>
  );
}
