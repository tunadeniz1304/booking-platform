import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

// WCAG 2.4.2: rotaya özgü sayfa başlığı (kök şablon: "%s — booking-platform").
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("titles");
  return { title: t("adminSupport") };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
