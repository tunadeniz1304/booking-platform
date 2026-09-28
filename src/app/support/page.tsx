"use client";

import { useTranslations } from "next-intl";
import SupportChat from "@/components/support/SupportChat";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** v5 P1-4: misafir destek asistanı (oturum gerekir). */
export default function SupportPage() {
  const t = useTranslations("support.chat");
  return (
    <PageShell title={t("pageTitle")} intro={t("pageIntro")}>
      <RoleGate>{() => <SupportChat />}</RoleGate>
    </PageShell>
  );
}
