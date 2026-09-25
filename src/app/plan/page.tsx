"use client";

import { useTranslations } from "next-intl";
import TripPlanner from "@/components/plan/TripPlanner";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Çok şehirli gezi planlayıcı (P1-6): rota + durak başına konaklama teklifi + "Tut". */
export default function PlanPage() {
  const t = useTranslations("plan");
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <RoleGate>{() => <TripPlanner />}</RoleGate>
    </PageShell>
  );
}
