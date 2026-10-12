import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageShell, focusRing } from "@/components/ui/ui";

// F916: kaldırılmış ya da yayında olmayan ilan için yerelleştirilmiş, çıkış yollu 404.
const linkClass =
  "inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2 text-sm font-semibold";

export default async function PropertyNotFound() {
  const [t, tc] = await Promise.all([getTranslations("property"), getTranslations("common")]);
  return (
    <PageShell title={t("notFoundTitle")} intro={t("notFoundDescription")}>
      <nav aria-label={tc("notFound.navLabel")} className="flex flex-wrap gap-3">
        <Link
          href="/search"
          className={`${linkClass} bg-[#003580] text-white hover:bg-[#002b66] ${focusRing}`}
        >
          {tc("notFound.search")}
        </Link>
        <Link
          href="/"
          className={`${linkClass} border border-[#003580] bg-white text-[#003580] hover:bg-blue-50 ${focusRing}`}
        >
          {tc("notFound.home")}
        </Link>
      </nav>
    </PageShell>
  );
}
