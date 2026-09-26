"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Yönetim paneli (P2-4): outbox, olay sinyali kuyruğu, fraud kuyruğu, LLM durumu, rol yönetimi. */
export default function AdminPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("compliance.admin");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <p className="text-sm">
        <Link href="/admin/compliance" className="font-semibold text-[#003580] underline">
          {tc("open")}
        </Link>
      </p>
      <RoleGate roles={["ADMIN"]}>{() => <AdminDashboard />}</RoleGate>
    </PageShell>
  );
}
