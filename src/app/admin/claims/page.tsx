"use client";

import { useTranslations } from "next-intl";
import ClaimAdmin from "@/components/admin/ClaimAdmin";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Yönetici talep incelemesi (P1-5): filtrele, incele, onayla / kısmi onayla / reddet. */
export default function AdminClaimsPage() {
  const t = useTranslations("resolution");
  return (
    <PageShell title={t("admin.pageTitle")} intro={t("admin.pageIntro")}>
      <RoleGate roles={["ADMIN"]}>{() => <ClaimAdmin />}</RoleGate>
    </PageShell>
  );
}
