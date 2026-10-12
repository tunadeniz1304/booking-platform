"use client";

import { useTranslations } from "next-intl";
import SectionPagesNav from "@/components/layout/SectionPagesNav";
import { useLoader } from "@/components/ui/ui";
import { apiFetch } from "@/lib/api-client";

interface QueueCounts {
  claims: number;
  support: number;
  compliance: number;
}

/**
 * Yönetim panosundaki sayaçlı AdminPagesNav: kuyruk bağlantılarında yönetici işlemi bekleyen
 * kayıt sayısı (F642/F1066). Öğeler ve etiketler AdminPagesNav ile aynı sırada; sayaçlar
 * yüklenemezse bağlantılar sayısız kalır. Yalnızca RoleGate içinde (ADMIN) gösterilmelidir.
 */
export default function AdminQueuePagesNav({ className }: { className?: string }) {
  const t = useTranslations("admin");
  const tc = useTranslations("compliance.admin");
  const tp = useTranslations("payouts");
  const tr = useTranslations("resolution");
  const ts = useTranslations("support.admin");
  const { data } = useLoader(() => apiFetch<QueueCounts>("/api/admin/queue-counts"));
  const counted = (label: string, count: number | undefined) =>
    count === undefined ? label : t("nav.pending", { label, count });
  return (
    <SectionPagesNav
      label={t("page.sectionsNav")}
      className={className}
      items={[
        { href: "/admin", label: t("page.title") },
        { href: "/admin/compliance", label: counted(tc("open"), data?.compliance) },
        { href: "/admin/payouts", label: tp("admin.link") },
        { href: "/admin/claims", label: counted(tr("adminLink"), data?.claims) },
        { href: "/admin/support", label: counted(ts("link"), data?.support) },
      ]}
    />
  );
}
