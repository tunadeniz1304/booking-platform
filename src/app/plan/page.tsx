"use client";

import TripPlanner from "@/components/plan/TripPlanner";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Çok şehirli gezi planlayıcı (P1-6): rota + durak başına konaklama teklifi + "Tut". */
export default function PlanPage() {
  return (
    <PageShell
      title="Gezi planlayıcı"
      intro="Şehirleri ve gün sayısını girin; en kısa rotayı ve her durak için uygun konaklamayı önerelim."
    >
      <RoleGate>{() => <TripPlanner />}</RoleGate>
    </PageShell>
  );
}
