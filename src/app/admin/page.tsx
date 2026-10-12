"use client";

import { useTranslations } from "next-intl";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminQueuePagesNav from "@/components/admin/AdminQueuePagesNav";
import { PageShell, RoleGate, useSession } from "@/components/ui/ui";

/** Yönetim paneli (P2-4): outbox, olay sinyali kuyruğu, fraud kuyruğu, LLM durumu, rol yönetimi. */
export default function AdminPage() {
  const t = useTranslations("admin");
  const session = useSession();
  // Görev açıklaması yalnızca yöneticiye (F564); yetkisiz rolde yalnız RoleGate mesajı görünür.
  const isAdmin = session.status === "ready" && session.user?.role === "ADMIN";
  return (
    <PageShell title={t("page.title")} intro={isAdmin ? t("page.intro") : undefined} width="wide">
      <RoleGate roles={["ADMIN"]}>
        {() => (
          <>
            {/* Alt sayfalar yalnızca yöneticiye, bekleyen iş sayılarıyla (F1193/F460/F1066). */}
            <AdminQueuePagesNav />
            <AdminDashboard />
          </>
        )}
      </RoleGate>
    </PageShell>
  );
}
