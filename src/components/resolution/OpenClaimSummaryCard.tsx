"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { ButtonLink, focusRing } from "@/components/ui/ui";
import { ClaimStatusBadge, type ClaimSummary } from "./shared";

/**
 * Rezervasyonda kullanıcının açtığı aktif talebin özeti (form yerine gösterilir): durum,
 * yanıt için son tarih ve sonraki adım olan "Kanıt ekle". `justCreated` ise başarı metni
 * gösterilir ve odak "Kanıt ekle" bağlantısına taşınır (metin bağlantının açıklamasıdır).
 */
export default function OpenClaimSummaryCard({
  claim,
  justCreated = false,
}: {
  claim: Pick<
    ClaimSummary,
    "id" | "type" | "status" | "amountRequestedMinor" | "currency" | "slaDueAt"
  >;
  justCreated?: boolean;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const evidenceRef = useRef<HTMLAnchorElement>(null);
  const baseId = `open-claim-${claim.id}`;
  const href = `/resolution/${encodeURIComponent(claim.id)}`;

  useEffect(() => {
    if (justCreated) evidenceRef.current?.focus();
  }, [justCreated]);

  let amount: string;
  try {
    amount = f.money(claim.amountRequestedMinor, claim.currency);
  } catch {
    amount = String(claim.amountRequestedMinor);
  }

  return (
    <div
      className="space-y-2 rounded-md border border-gray-200 bg-white p-4"
      aria-labelledby={`${baseId}-title`}
      role="group"
    >
      {justCreated && (
        <p id={`${baseId}-created`} className="text-sm font-semibold text-gray-900">
          {t("open.created", { amount })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${baseId}-title`} className="text-base font-semibold text-gray-900">
          {t("open.summaryTitle")}
        </h3>
        <ClaimStatusBadge status={claim.status} />
      </div>
      <p className="text-sm text-gray-700">
        {t(`type.${claim.type}`)} · {t("list.requested", { amount })}
      </p>
      {claim.slaDueAt && (
        <p className="text-sm text-gray-700">
          {t("list.slaDue", { date: f.dateTime(claim.slaDueAt) })}
        </p>
      )}
      <p id={`${baseId}-next`} className="text-sm text-gray-700">
        {t("open.summaryNext")}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ButtonLink
          ref={evidenceRef}
          href={`${href}#claim-evidence`}
          aria-describedby={justCreated ? `${baseId}-created ${baseId}-next` : `${baseId}-next`}
        >
          {t("open.addEvidence")}
        </ButtonLink>
        <Link
          href={href}
          className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
        >
          {t("open.viewClaim")}
        </Link>
      </div>
    </div>
  );
}
