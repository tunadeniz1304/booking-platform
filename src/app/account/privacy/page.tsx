"use client";

import PrivacyCenter from "@/components/privacy/PrivacyCenter";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** KVKK/GDPR self-servis (P2-5). */
export default function AccountPrivacyPage() {
  return (
    <PageShell
      title="Gizlilik ve verilerim"
      intro="KVKK md. 11 kapsamındaki haklarınızı buradan kullanabilirsiniz."
    >
      <RoleGate>{() => <PrivacyCenter />}</RoleGate>
    </PageShell>
  );
}
