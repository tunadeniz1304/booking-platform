"use client";

import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Card, PageShell, RoleGate, Status, useLoader } from "@/components/ui/ui";
import ClaimList from "@/components/resolution/ClaimList";
import type { ClaimSummary } from "@/components/resolution/shared";

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
          <p className="text-sm text-gray-700">{t("list.empty")}</p>
        ) : (
          <ClaimList claims={data.claims} />
        ))}
    </Card>
  );
}
