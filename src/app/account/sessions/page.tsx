"use client";

import { useTranslations } from "next-intl";
import AccountBreadcrumb from "@/components/account/AccountBreadcrumb";
import SessionManager from "@/components/account/SessionManager";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Hesap ▸ Oturumlar (P0-4): etkin oturumlar + uzaktan çıkış. */
export default function AccountSessionsPage() {
  const t = useTranslations("account.sessions");
  return (
    <PageShell
      title={t("title")}
      intro={
        <>
          {/* Hesap merkezine dönüş ve konum (F1083/F1174). */}
          <AccountBreadcrumb current={t("title")} />
          <p className="mt-1">{t("description")}</p>
        </>
      }
    >
      <RoleGate>{() => <SessionManager />}</RoleGate>
    </PageShell>
  );
}
