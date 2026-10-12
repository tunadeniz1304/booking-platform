"use client";

import { useTranslations } from "next-intl";
import SectionPagesNav from "@/components/layout/SectionPagesNav";

/** Ev sahibi sayfaları arasında gezinme: panel, gelir paneli, ödemeler (F821/F1294). */
export default function HostPagesNav({ className }: { className?: string }) {
  const t = useTranslations("host");
  const tNav = useTranslations("nav");
  const tRevenue = useTranslations("revenue");
  const tPayouts = useTranslations("payouts");
  return (
    <SectionPagesNav
      label={t("pagesNav")}
      className={className}
      items={[
        { href: "/host", label: tNav("host") },
        { href: "/host/revenue", label: tRevenue("page.title") },
        { href: "/host/payouts", label: tPayouts("page.title") },
      ]}
    />
  );
}
