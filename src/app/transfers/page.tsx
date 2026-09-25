"use client";

import { useTranslations } from "next-intl";
import TransferMarket from "@/components/transfers/TransferMarket";
import { PageShell } from "@/components/ui/ui";

/** Rezervasyon devri (P1-8): public keşif listesi + kendi onaylı rezervasyonunu devretme. */
export default function TransfersPage() {
  const t = useTranslations("transfers");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <TransferMarket />
    </PageShell>
  );
}
