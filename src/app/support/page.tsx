"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import SupportChat from "@/components/support/SupportChat";
import SupportHelpTopics from "@/components/support/SupportHelpTopics";
import { Card, PageShell, RoleGate, focusRing, loginHref, useSession } from "@/components/ui/ui";

/** v5 P1-4: misafir destek asistanı (oturum gerekir); sık sorular ve politikalar herkese açık. */
export default function SupportPage() {
  const t = useTranslations("support.chat");
  const session = useSession();
  // F2-39: anonim kullanıcı sayfayı görür; sohbet kartında yalnız giriş çağrısı çıkar.
  const anonymous = session.status !== "loading" && !session.user;
  return (
    <PageShell title={t("pageTitle")} intro={t("pageIntro")}>
      {anonymous ? (
        <Card id="support-chat">
          <p className="text-sm text-gray-800">
            {t.rich("loginToChat", {
              link: (chunks) => (
                <Link
                  href={loginHref()}
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </Card>
      ) : (
        <RoleGate>{() => <SupportChat />}</RoleGate>
      )}
      <SupportHelpTopics />
    </PageShell>
  );
}
