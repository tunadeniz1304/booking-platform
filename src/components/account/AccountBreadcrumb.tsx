"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";

/** Hesap alt sayfalarında konum yolu: Hesabım › geçerli sayfa (F1083/F1174). */
export default function AccountBreadcrumb({
  current,
  className = "",
}: {
  /** Geçerli sayfanın adı (sayfa başlığıyla aynı). */
  current: string;
  className?: string;
}) {
  const t = useTranslations("account");
  return (
    <nav aria-label={t("breadcrumb")} className={`text-sm text-gray-700 ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-2">
        <li>
          <Link
            href="/account"
            className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`}
          >
            {t("title")}
          </Link>
        </li>
        <li className="flex min-w-0 items-center gap-x-2">
          <span aria-hidden="true">›</span>
          <span aria-current="page" className="text-gray-900">
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}
