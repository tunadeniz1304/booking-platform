"use client";

import HostDashboard from "@/components/host/HostDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Host extranet (P1-7): mülk düzenleme, oda ekleme, toplu takvim, rezervasyonlar, ilan metni önerisi. */
export default function HostPage() {
  return (
    <PageShell
      title="Ev sahibi paneli"
      intro="Mülklerinizi düzenleyin, oda ekleyin, takvimi toplu güncelleyin ve rezervasyonları izleyin."
    >
      <RoleGate roles={["HOST", "ADMIN"]}>{() => <HostDashboard />}</RoleGate>
    </PageShell>
  );
}
