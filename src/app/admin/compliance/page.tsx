"use client";

import { useTranslations } from "next-intl";
import ComplianceDashboard from "@/components/compliance/ComplianceDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Uyum paneli (P1-13): 7565 kaldırma talepleri, DSA bildirimleri, şeffaflık raporu. */
export default function AdminCompliancePage() {
  const t = useTranslations("compliance.admin");
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <RoleGate roles={["ADMIN"]}>{() => <ComplianceDashboard />}</RoleGate>
    </PageShell>
  );
}
