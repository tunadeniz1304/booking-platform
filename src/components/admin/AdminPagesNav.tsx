"use client";

import { useTranslations } from "next-intl";
import SectionPagesNav from "@/components/layout/SectionPagesNav";

/**
 * Yönetim sayfaları arasında gezinme: pano ve alt kuyruklar (F460/F1192/F1193). Geçerli sayfa
 * `aria-current="page"` taşır. Yalnızca RoleGate içinde (ADMIN) gösterilmelidir.
 */
export default function AdminPagesNav({ className }: { className?: string }) {
  const t = useTranslations("admin");
  const tc = useTranslations("compliance.admin");
  const tp = useTranslations("payouts");
  const tr = useTranslations("resolution");
  const ts = useTranslations("support.admin");
  return (
    <SectionPagesNav
      label={t("page.sectionsNav")}
      className={className}
      items={[
        { href: "/admin", label: t("page.title") },
        { href: "/admin/compliance", label: tc("open") },
        { href: "/admin/payouts", label: tp("admin.link") },
        { href: "/admin/claims", label: tr("adminLink") },
        { href: "/admin/support", label: ts("link") },
      ]}
    />
  );
}
