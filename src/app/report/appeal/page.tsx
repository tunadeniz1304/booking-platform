import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ButtonLink, Card, PageShell, focusRing } from "@/components/ui/ui";
import AppealForm from "@/components/compliance/AppealForm";
import {
  appealRoleSchema,
  getAppealContext,
  type AppealContext,
} from "@/lib/compliance/dsa-appeal";
import {
  getAppealDecisionDetails,
  type AppealDecisionDetails,
} from "@/lib/compliance/dsa-appeal-details";
import { HttpError } from "@/lib/http/errors";
import { getFormat } from "@/i18n/server-format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("compliance.appeal");
  return { title: t("title"), description: t("intro") };
}

export const dynamic = "force-dynamic";

/** Son tarih ve saat platformun saat diliminde (TSİ) gösterilir. */
const TIME_ZONE = "Europe/Istanbul";
const DAY_MS = 86_400_000;

/** Pencere kapanana kadar kalan gün (kısmi gün yukarı yuvarlanır). */
function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS));
}

const linkClass =
  "font-semibold text-[#003580] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

type LoadError = "invalidLink" | "notDecided" | "loadFailed";

/**
 * DSA md. 20 itiraz sayfası (P2-1a): karar e-postasındaki imzalı bağlantı
 * (`?notice=&role=&token=`) ile açılır; karar özeti + gerekçeli karar bildirimi + itiraz formu.
 */
export default async function AppealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("compliance.appeal");
  const tAdmin = await getTranslations("compliance.admin");
  const f = await getFormat();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : "");
  const role = appealRoleSchema.safeParse(str("role"));
  let ctx: AppealContext | null = null;
  let details: AppealDecisionDetails | null = null;
  let loadError: LoadError = "invalidLink";
  if (role.success && str("notice") && str("token")) {
    try {
      ctx = await getAppealContext(str("notice"), role.data, str("token"));
      details = await getAppealDecisionDetails(ctx).catch(() => null);
    } catch (err) {
      // 403: imza tutmuyor (bozuk/kırpılmış bağlantı); 404: karar yok ya da bu rolle itiraz edilemez.
      if (!(err instanceof HttpError)) loadError = "loadFailed";
      else if (err.status === 404) loadError = "notDecided";
    }
  }

  return (
    <PageShell title={t("title")} intro={ctx ? t("intro") : undefined}>
      {!ctx ? (
        <Card>
          <p role="alert" className="text-sm text-red-700">
            {t(loadError)}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href="/support">{t("contactSupport")}</ButtonLink>
            <ButtonLink href="/report" variant="secondary">
              {t("newReport")}
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <>
          <Card title={t("decisionTitle")} id="appeal-decision">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-600">{t("decision")}</dt>
                <dd className="font-semibold text-gray-900">{t(`decisions.${ctx.decision}`)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">{t("decidedAt")}</dt>
                <dd className="font-semibold text-gray-900">
                  {f.date(ctx.decidedAt, "long", TIME_ZONE)}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600">{t("windowEnds")}</dt>
                <dd className="font-semibold text-gray-900">
                  {t("windowEndsAt", {
                    date: f.date(ctx.windowEndsAt, "long", TIME_ZONE),
                    time: f.time(ctx.windowEndsAt, TIME_ZONE),
                  })}
                  {ctx.windowOpen && !ctx.appeal && (
                    <span className="block font-normal text-gray-700">
                      {t("daysLeft", { days: daysUntil(ctx.windowEndsAt) })}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {details && (details.ground || details.legalReference || details.facts) && (
              <dl className="mt-4 space-y-3 border-t border-gray-200 pt-4 text-sm">
                {details.ground && (
                  <div>
                    <dt className="text-gray-600">{tAdmin("ground")}</dt>
                    <dd className="text-gray-900">{tAdmin(`grounds.${details.ground}`)}</dd>
                  </div>
                )}
                {details.legalReference && (
                  <div>
                    <dt className="text-gray-600">{tAdmin("legalReference")}</dt>
                    <dd className="text-gray-900">{details.legalReference}</dd>
                  </div>
                )}
                {details.facts && (
                  <div>
                    <dt className="text-gray-600">{tAdmin("facts")}</dt>
                    <dd className="whitespace-pre-wrap text-gray-900">{details.facts}</dd>
                  </div>
                )}
              </dl>
            )}
            <details className="mt-3">
              <summary
                className={`cursor-pointer rounded text-sm font-medium text-gray-900 ${focusRing}`}
              >
                {t("statementRaw")}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-gray-800">
                {ctx.statementOfReasons}
              </pre>
            </details>
          </Card>
          {ctx.appeal ? (
            <Card>
              <p role="status" className="text-sm text-gray-900">
                {t(`existing.${ctx.appeal.status}`, { reference: ctx.appeal.id })}
              </p>
              {details?.appealDecidedAt && (
                <dl className="mt-3 space-y-3 text-sm">
                  <div>
                    <dt className="text-gray-600">{t("appealDecidedAt")}</dt>
                    <dd className="text-gray-900">
                      {f.date(details.appealDecidedAt, "long", TIME_ZONE)}
                    </dd>
                  </div>
                  {details.appealResponse && (
                    <div>
                      <dt className="text-gray-600">{tAdmin("reason")}</dt>
                      <dd className="whitespace-pre-wrap text-gray-900">
                        {details.appealResponse}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {ctx.appeal.status === "REJECTED" && (
                <p className="mt-3 text-sm">
                  <Link href="/support" className={linkClass}>
                    {t("disputeHelp")}
                  </Link>
                </p>
              )}
            </Card>
          ) : !ctx.windowOpen ? (
            <Card>
              <p role="alert" className="text-sm text-red-700">
                {t("windowClosed")}
              </p>
            </Card>
          ) : (
            <AppealForm noticeId={ctx.noticeId} role={ctx.role} token={str("token")} />
          )}
        </>
      )}
    </PageShell>
  );
}
