"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell, RoleGate, focusRing } from "@/components/ui/ui";
import ClaimDetail, { type ClaimDetailResult } from "@/components/resolution/ClaimDetail";
import type { ClaimSummary } from "@/components/resolution/shared";

const linkClass = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`;

/**
 * Talebin rezervasyonu, görüntüleyen tarafın sayfasında açılır: misafir rezervasyon ayrıntısına,
 * ev sahibi rezervasyonun yazışma ve talep paneline gider. Yöneticiye bağlantı verilmez.
 */
function bookingHref(claim: ClaimSummary): string | null {
  const id = encodeURIComponent(claim.bookingId);
  const guest =
    (claim.type === "GUEST_REFUND" && claim.role === "OPENER") ||
    (claim.type === "HOST_DAMAGE" && claim.role === "RESPONDENT");
  if (guest) return `/booking/${id}`;
  if (claim.role === "ADMIN") return null;
  return `/host/messages/${id}`;
}

/** Talep ayrıntısı (P1-5): yazışma, kanıt, geri çekme ve karar sonucu. */
export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("resolution");
  const [loaded, setLoaded] = useState<{ id: string; result: ClaimDetailResult } | null>(null);
  const result = loaded && loaded.id === id ? loaded.result : null;
  const claim = result?.status === "found" ? result.detail.claim : null;
  const href = claim ? bookingHref(claim) : null;
  // Yenilemede gelen 404 eldeki ayrıntıyı silmez (ClaimDetail eski veriyi gösterir); başlık da kalır.
  const onResult = (next: ClaimDetailResult) =>
    setLoaded((prev) =>
      next.status === "notFound" && prev?.id === id && prev.result.status === "found"
        ? prev
        : { id, result: next }
    );

  const title =
    result?.status === "notFound"
      ? t("detail.notFound.title")
      : claim
        ? t("detailPage.titleWithType", { type: t(`type.${claim.type}`) })
        : t("detailPage.title");

  return (
    <PageShell
      title={title}
      intro={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/resolution" className={linkClass}>
            {t("detailPage.back")}
          </Link>
          {claim && (
            <span className="whitespace-nowrap">
              {t("detailPage.reference", { ref: claim.id.slice(-8) })}
            </span>
          )}
          {href && (
            <Link href={href} className={linkClass}>
              {t("detailPage.viewBooking")}
            </Link>
          )}
        </div>
      }
    >
      <RoleGate>{() => (id ? <ClaimDetail claimId={id} onResult={onResult} /> : null)}</RoleGate>
    </PageShell>
  );
}
