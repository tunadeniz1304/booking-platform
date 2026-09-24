"use client";

import ClaimForm from "@/components/transfers/ClaimForm";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** Devir linkini açan alıcı: kart istemcide token'lanır, POST /api/transfers/claim. */
export default function ClaimPage() {
  return (
    <PageShell
      title="Rezervasyonu devral"
      intro="Ödeme onaylanmadan sahiplik değişmez. Ödeme reddedilirse devir gerçekleşmez."
    >
      <RoleGate>{() => <ClaimForm />}</RoleGate>
    </PageShell>
  );
}
