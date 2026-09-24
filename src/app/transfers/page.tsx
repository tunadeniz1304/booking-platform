"use client";

import TransferMarket from "@/components/transfers/TransferMarket";
import { PageShell } from "@/components/ui/ui";

/** Rezervasyon devri (P1-8): public keşif listesi + kendi onaylı rezervasyonunu devretme. */
export default function TransfersPage() {
  return (
    <PageShell
      title="Rezervasyon devri"
      intro="Gidemeyeceğiniz onaylı rezervasyonu devredin ya da başkasının ilanını inceleyin."
    >
      <TransferMarket />
    </PageShell>
  );
}
