"use client";

import { useTranslations } from "next-intl";
import AdminPagesNav from "@/components/admin/AdminPagesNav";
import SupportAdmin from "@/components/admin/SupportAdmin";
import { PageShell, RoleGate } from "@/components/ui/ui";

/** v5 P1-4: AI destek asistanının insana devrettiği talepler (yalnız ADMIN). */
export default function AdminSupportPage() {
  const t = useTranslations("support.admin");
  return (
    <PageShell title={t("pageTitle")} intro={t("pageIntro")}>
      <RoleGate roles={["ADMIN"]}>
        {(user) => (
          <>
            {/* Panoya dönüş ve kardeş kuyruklar (F1192). */}
            <AdminPagesNav />
            {/* Kendi üstlendiği talepler "Size atandı" olarak işaretlenir (F667). */}
            <SupportAdmin currentUserId={user.id} />
          </>
        )}
      </RoleGate>
    </PageShell>
  );
}
