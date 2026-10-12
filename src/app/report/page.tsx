import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/ui/ui";
import NoticeForm from "@/components/compliance/NoticeForm";
import { prisma } from "@/lib/prisma";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("compliance.report");
  return { title: t("title"), description: t("intro") };
}

/** dsa-appeal.ts ile aynı kök adres: bildirilen ilanın URL'si sunucuda kurulur. */
function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
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
  // Bilinmeyen ilan: form bağlantısız açılır. Sorgu hatasında eski davranış (istemcide URL).
  const property = propertyId
    ? await prisma.property
        .findUnique({
          where: { id: propertyId },
          select: { id: true, title: true, images: true, location: { select: { city: true } } },
        })
        .catch(() => undefined)
    : null;
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      {/* key: /report?propertyId=x → /report geçişinde eski istemci durumu taşınmaz. */}
      {propertyId && property ? (
        <NoticeForm
          key={propertyId}
          propertyId={propertyId}
          contentUrl={`${appBaseUrl()}/property/${encodeURIComponent(propertyId)}`}
          property={{
            title: property.title,
            city: property.location.city,
            imageUrl: property.images[0] ?? null,
          }}
        />
      ) : propertyId && property === undefined ? (
        <NoticeForm key={propertyId} propertyId={propertyId} />
      ) : (
        <NoticeForm key="none" />
      )}
    </PageShell>
  );
}
