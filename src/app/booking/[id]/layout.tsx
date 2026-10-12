import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

// WCAG 2.4.2: rotaya özgü sayfa başlığı. F2-45: düz dize kök şablonu alt rotalar için
// sıfırlar; şablonu yeniden vererek alt sayfalar da "%s — booking-platform" ekini alır.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("titles");
  const common = await getTranslations("common");
  return { title: { default: t("booking"), template: `%s — ${common("brand")}` } };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
