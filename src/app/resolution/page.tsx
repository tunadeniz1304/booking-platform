"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Card, PageShell, RoleGate, Status, focusRing, useLoader } from "@/components/ui/ui";
import ClaimList from "@/components/resolution/ClaimList";
import { CLAIM_GUEST_WINDOW_DAYS, type ClaimSummary } from "@/components/resolution/shared";

/** Çözüm merkezi (P1-5): kullanıcının açtığı veya kendisine yöneltilen talepler. */
export default function ResolutionPage() {
  const t = useTranslations("resolution");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <RoleGate>{() => <MyClaims />}</RoleGate>
    </PageShell>
  );
}

function MyClaims() {
  const t = useTranslations("resolution");
  const { data, error } = useLoader(() => apiFetch<{ claims: ClaimSummary[] }>("/api/claims"));
  return (
    <Card title={t("list.title")} id="my-claims">
      <Status error={error} />
      {!data && !error && (
        <p aria-live="polite" className="text-sm text-gray-600">
          {t("loading")}
        </p>
      )}
      {data &&
        (data.claims.length === 0 ? (
          <div className="space-y-2 text-sm text-gray-700">
            <p>{t("list.empty")}</p>
            <p>{t("list.emptyHow", { days: CLAIM_GUEST_WINDOW_DAYS })}</p>
            <p>
              <Link
                href="/trips"
                className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
              >
                {t("list.goToTrips")}
              </Link>
            </p>
          </div>
        ) : (
          <ClaimList claims={data.claims} />
        ))}
    </Card>
  );
}
