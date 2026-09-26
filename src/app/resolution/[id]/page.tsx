"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell, RoleGate, focusRing } from "@/components/ui/ui";
import ClaimDetail from "@/components/resolution/ClaimDetail";

/** Talep ayrıntısı (P1-5): yazışma, kanıt, geri çekme ve karar sonucu. */
export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("resolution");
  return (
    <PageShell
      title={t("detailPage.title")}
      intro={
        <Link href="/resolution" className={`font-semibold text-[#003580] underline ${focusRing}`}>
          {t("detailPage.back")}
        </Link>
      }
    >
      <RoleGate>{() => (id ? <ClaimDetail claimId={id} /> : null)}</RoleGate>
    </PageShell>
  );
}
