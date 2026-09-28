"use client";

import { useTranslations } from "next-intl";
import SupportAdmin from "@/components/admin/SupportAdmin";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** v5 P1-4: AI destek asistanının insana devrettiği talepler (yalnız ADMIN). */
export default function AdminSupportPage() {
  const t = useTranslations("support.admin");
  return (
    <PageShell title={t("pageTitle")} intro={t("pageIntro")}>
      <RoleGate roles={["ADMIN"]}>{() => <SupportAdmin />}</RoleGate>
    </PageShell>
  );
}
