"use client";

import { useTranslations } from "next-intl";
import AdminPagesNav from "@/components/admin/AdminPagesNav";
import ComplianceDashboard from "@/components/compliance/ComplianceDashboard";
import AppealQueue from "@/components/compliance/AppealQueue";
import AccessibilityReviewQueue from "@/components/compliance/AccessibilityReviewQueue";
import { PageShell, RoleGate, focusRing } from "@/components/ui/ui";

/**
 * Uyum paneli (P1-13 + P2-1a): 7565 kaldırma talepleri, DSA bildirimleri, md. 20 itirazları,
 * erişilebilirlik doğrulama kuyruğu ve şeffaflık raporu.
 */
export default function AdminCompliancePage() {
  const t = useTranslations("compliance.admin");
  const tAppeal = useTranslations("compliance.appeal.admin");
  const tAccessibility = useTranslations("compliance.accessibility.admin");
  // Bölümler sayfadaki sırayla; uzun kuyrukları geçmeden doğrudan atlama (F772).
  const sections = [
    { id: "takedowns", label: t("takedowns") },
    { id: "notices", label: t("notices") },
    { id: "transparency", label: t("transparency") },
    { id: "appeals", label: tAppeal("title") },
    { id: "accessibility-review", label: tAccessibility("title") },
  ];
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <RoleGate roles={["ADMIN"]}>
        {() => (
          <div className="space-y-6">
            <AdminPagesNav />
            <nav
              aria-label={t("sectionsNav")}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`inline-flex min-h-[44px] items-center rounded font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`}
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <ComplianceDashboard />
            <AppealQueue />
            <AccessibilityReviewQueue />
          </div>
        )}
      </RoleGate>
    </PageShell>
  );
}
