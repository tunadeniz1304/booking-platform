import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageShell, focusRing } from "@/components/ui/ui";

// Yerelleştirilmiş 404: menü (Header/Footer), #main ve çıkış yolları (F51, F146).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("notFound.title") };
}

const linkClass = `inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2 text-sm font-semibold`;

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <PageShell title={t("notFound.title")} intro={t("notFound.description")}>
      <nav aria-label={t("notFound.navLabel")} className="flex flex-wrap gap-3">
        <Link
          href="/"
          className={`${linkClass} bg-[#003580] text-white hover:bg-[#002b66] ${focusRing}`}
        >
          {t("notFound.home")}
        </Link>
        <Link
          href="/search"
          className={`${linkClass} border border-[#003580] bg-white text-[#003580] hover:bg-blue-50 ${focusRing}`}
        >
          {t("notFound.search")}
        </Link>
      </nav>
    </PageShell>
  );
}
