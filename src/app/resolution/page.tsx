"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Card, LoadError, PageShell, RoleGate, focusRing, useLoader } from "@/components/ui/ui";
import ClaimList from "@/components/resolution/ClaimList";
import {
  ACTIVE_STATUSES,
  CLAIM_GUEST_WINDOW_DAYS,
  type ClaimSummary,
} from "@/components/resolution/shared";

const linkClass = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`;

type ClaimGroup = "action" | "active" | "resolved";
type ClaimFilter = "all" | ClaimGroup;
const FILTERS: readonly ClaimFilter[] = ["all", "action", "active", "resolved"];
const GROUP_ORDER: Record<ClaimGroup, number> = { action: 0, active: 1, resolved: 2 };
const LOADING_ANNOUNCE_DELAY_MS = 400;
const skeletonBlock = "rounded-md bg-gray-100 motion-safe:animate-pulse";

/** Yanıt sırası kullanıcıdaysa "işlem bekleyen", sonuçlanmamışsa "devam eden". */
function claimGroup(claim: ClaimSummary): ClaimGroup {
  if (claim.role === "RESPONDENT" && claim.status === "AWAITING_RESPONSE") return "action";
  return ACTIVE_STATUSES.includes(claim.status) ? "active" : "resolved";
}

const dueTime = (claim: ClaimSummary) =>
  claim.slaDueAt ? new Date(claim.slaDueAt).getTime() : Infinity;

/** İşlem bekleyenler en üstte (son tarihi en yakın önce); diğerleri sunucu sırasında. */
function sortClaims(claims: ClaimSummary[]): ClaimSummary[] {
  return [...claims].sort((a, b) => {
    const ga = claimGroup(a);
    const gb = claimGroup(b);
    if (ga !== gb) return GROUP_ORDER[ga] - GROUP_ORDER[gb];
    return ga === "action" ? dueTime(a) - dueTime(b) || 0 : 0;
  });
}

/** Çözüm merkezi (P1-5): kullanıcının açtığı veya kendisine yöneltilen talepler. */
export default function ResolutionPage() {
  const t = useTranslations("resolution");
  return (
    <PageShell title={t("page.title")} intro={t("page.intro")}>
      <RoleGate>
        {(user) => (
          <>
            <MyClaims />
            {user.role === "HOST" && <HostOpenClaimCard />}
          </>
        )}
      </RoleGate>
    </PageShell>
  );
}

function MyClaims() {
  const t = useTranslations("resolution");
  const { data, error, loading, reload } = useLoader(() =>
    apiFetch<{ claims: ClaimSummary[] }>("/api/claims")
  );
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const [announceLoading, setAnnounceLoading] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounceLoading(true), LOADING_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const initialLoading = !data && !error;
  const claims = data ? sortClaims(data.claims) : [];
  const showFilter = claims.length > 1;
  const active = showFilter ? filter : "all";
  const inFilter = (key: ClaimFilter) =>
    key === "all" ? claims : claims.filter((c) => claimGroup(c) === key);
  const shown = inFilter(active);
  return (
    <Card
      title={data ? t("list.titleCount", { count: data.claims.length }) : t("list.title")}
      id="my-claims"
    >
      {/* Bölge metinsiz bağlanır, metin gecikmeyle yazılır; böylece duyurulur (F1347). */}
      <p role="status" className="sr-only">
        {initialLoading && announceLoading ? t("loading") : null}
      </p>
      {error && <LoadError error={error} onRetry={reload} busy={loading} />}
      {initialLoading && (
        <ul aria-hidden="true" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-24 space-y-2 rounded-md border border-gray-200 p-3">
              <div className={`h-5 w-40 ${skeletonBlock}`} />
              <div className={`h-4 w-full ${skeletonBlock}`} />
              <div className={`h-4 w-1/2 ${skeletonBlock}`} />
            </li>
          ))}
        </ul>
      )}
      {data && (
        <div className="space-y-4">
          {claims.length === 0 ? (
            <p className="text-sm text-gray-700">{t("list.empty")}</p>
          ) : (
            <>
              {showFilter && (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium text-gray-800">
                    {t("list.filter.legend")}
                  </legend>
                  <div className="inline-flex flex-wrap rounded-md border border-gray-500 p-0.5">
                    {FILTERS.map((key) => (
                      <label
                        key={key}
                        className="relative inline-flex min-h-[44px] cursor-pointer items-center rounded px-3 text-sm text-gray-800 has-[:checked]:bg-blue-50 has-[:checked]:font-semibold has-[:checked]:text-[#003580] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#003580]"
                      >
                        <input
                          type="radio"
                          name="my-claims-filter"
                          value={key}
                          checked={active === key}
                          onChange={() => setFilter(key)}
                          className="sr-only"
                        />
                        {active === key && <span aria-hidden="true">{"✓ "}</span>}
                        {t(`list.filter.${key}`, { count: inFilter(key).length })}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {shown.length === 0 ? (
                <p className="text-sm text-gray-700">{t("list.filter.empty")}</p>
              ) : (
                <ClaimList claims={shown} />
              )}
            </>
          )}
          <div className="space-y-2 text-sm text-gray-700">
            <p>{t("list.emptyHow", { days: CLAIM_GUEST_WINDOW_DAYS })}</p>
            <p>
              <Link href="/trips" className={linkClass}>
                {t("list.goToTrips")}
              </Link>
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Ev sahibi hasar talebini rezervasyonun mesajlar sayfasındaki panelden açar. */
function HostOpenClaimCard() {
  const t = useTranslations("resolution.hostOpen");
  return (
    <Card title={t("title")} id="host-open-claim">
      <p className="text-sm text-gray-700">{t("body")}</p>
      <p className="mt-2 text-sm">
        <Link href="/host#host-bookings" className={linkClass}>
          {t("link")}
        </Link>
      </p>
    </Card>
  );
}
