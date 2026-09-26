"use client";

import { useTranslations } from "next-intl";
import ComplianceDashboard from "@/components/compliance/ComplianceDashboard";
import AppealQueue from "@/components/compliance/AppealQueue";
import AccessibilityReviewQueue from "@/components/compliance/AccessibilityReviewQueue";
import { PageShell, RoleGate } from "@/components/ui/ui";

/**
 * Uyum paneli (P1-13 + P2-1a): 7565 kaldırma talepleri, DSA bildirimleri, md. 20 itirazları,
 * erişilebilirlik doğrulama kuyruğu ve şeffaflık raporu.
 */
export default function AdminCompliancePage() {
  const t = useTranslations("compliance.admin");
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <RoleGate roles={["ADMIN"]}>
        {() => (
          <div className="space-y-6">
            <ComplianceDashboard />
            <AppealQueue />
            <AccessibilityReviewQueue />
          </div>
        )}
      </RoleGate>
    </PageShell>
  );
}
