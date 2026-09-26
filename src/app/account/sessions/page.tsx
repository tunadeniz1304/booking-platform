"use client";

import { useTranslations } from "next-intl";
import SessionManager from "@/components/account/SessionManager";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Hesap ▸ Oturumlar (P0-4): etkin oturumlar + uzaktan çıkış. */
export default function AccountSessionsPage() {
  const t = useTranslations("account.sessions");
  return (
    <PageShell title={t("title")} intro={t("description")}>
      <RoleGate>{() => <SessionManager />}</RoleGate>
    </PageShell>
  );
}
