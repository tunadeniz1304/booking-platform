import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/ui/ui";
import NoticeForm from "@/components/compliance/NoticeForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("compliance.report");
  return { title: t("title"), description: t("intro") };
}

/** Herkese açık DSA bildirim formu (P1-13b, md. 16). `?propertyId=` ile ilan önceden seçilir. */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("compliance.report");
  const sp = await searchParams;
  const propertyId = typeof sp.propertyId === "string" ? sp.propertyId.slice(0, 64) : undefined;
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <NoticeForm propertyId={propertyId} />
    </PageShell>
  );
}
