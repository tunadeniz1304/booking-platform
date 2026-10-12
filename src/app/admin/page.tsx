"use client";

import { useTranslations } from "next-intl";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminPagesNav from "@/components/admin/AdminPagesNav";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Yönetim paneli (P2-4): outbox, olay sinyali kuyruğu, fraud kuyruğu, LLM durumu, rol yönetimi. */
export default function AdminPage() {
  const t = useTranslations("admin");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <RoleGate roles={["ADMIN"]}>
        {() => (
          <>
            {/* Yönetim alt sayfaları yalnızca yöneticiye, gezinme bölgesi olarak (F1193/F460). */}
            <AdminPagesNav />
            <AdminDashboard />
          </>
        )}
      </RoleGate>
    </PageShell>
  );
}
