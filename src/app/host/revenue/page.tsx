"use client";

import RevenueDashboard from "@/components/host/RevenueDashboard";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Host gelir paneli (P1-5): doluluk, ADR, RevPAR, pickup ve sınırlı fiyat önerileri. */
export default function HostRevenuePage() {
  return (
    <PageShell
      title="Gelir paneli"
      intro="Doluluk, ADR ve RevPAR'ı izleyin; fiyat önerilerini katkı tablosuyla inceleyip kabul edin veya reddedin."
    >
      <RoleGate roles={["HOST", "ADMIN"]}>{() => <RevenueDashboard />}</RoleGate>
    </PageShell>
  );
}
