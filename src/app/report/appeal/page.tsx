import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, PageShell } from "@/components/ui/ui";
import AppealForm from "@/components/compliance/AppealForm";
import {
  appealRoleSchema,
  getAppealContext,
  type AppealContext,
} from "@/lib/compliance/dsa-appeal";
import { getFormat } from "@/i18n/server-format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("compliance.appeal");
  return { title: t("title"), description: t("intro") };
}

export const dynamic = "force-dynamic";

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
  const f = await getFormat();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : "");
  const role = appealRoleSchema.safeParse(str("role"));
  let ctx: AppealContext | null = null;
  if (role.success && str("notice") && str("token")) {
    ctx = await getAppealContext(str("notice"), role.data, str("token")).catch(() => null);
  }

  return (
    <PageShell title={t("title")} intro={t("intro")}>
      {!ctx ? (
        <Card>
          <p role="alert" className="text-sm text-red-700">
            {t("invalidLink")}
          </p>
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
                <dd className="font-semibold text-gray-900">{f.date(ctx.decidedAt, "long")}</dd>
              </div>
              <div>
                <dt className="text-gray-600">{t("windowEnds")}</dt>
                <dd className="font-semibold text-gray-900">{f.date(ctx.windowEndsAt, "long")}</dd>
              </div>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-900">
                {t("statement")}
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
