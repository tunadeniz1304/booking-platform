"use client";

import AdminDashboard from "@/components/admin/AdminDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Yönetim paneli (P2-4): outbox, olay sinyali kuyruğu, fraud kuyruğu, LLM durumu, rol yönetimi. */
export default function AdminPage() {
  return (
    <PageShell
      title="Yönetim paneli"
      intro="Kuyrukları izleyin, olay sinyallerini onaylayın ve kullanıcı rollerini yönetin."
    >
      <RoleGate roles={["ADMIN"]}>{() => <AdminDashboard />}</RoleGate>
    </PageShell>
  );
}
