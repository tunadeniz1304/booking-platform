"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, focusRing } from "@/components/ui/ui";

const linkClass = `font-semibold text-[#003580] underline underline-offset-2 ${focusRing}`;

/** Oturum gerektirmeyen sık sorular; her yanıt ilgili sayfaya bağlanır. */
const TOPICS = [
  { key: "cancellation", href: "/account#account-bookings" },
  { key: "refund", href: "/resolution" },
  { key: "payment", href: "/trust#trust-rights" },
  { key: "accessibility", href: "/search" },
] as const;

/** Yardım merkezi: sık sorular ve politika/bildirim bağlantıları (herkese açık). */
export default function SupportHelpTopics() {
  const t = useTranslations("support.help");
  const tTrust = useTranslations("trustCenter");
  const link = (href: string) =>
    function HelpLink(chunks: ReactNode) {
      return (
        <Link href={href} className={linkClass}>
          {chunks}
        </Link>
      );
    };

  return (
    <>
      <Card id="support-faq" title={t("title")}>
        <ul className="space-y-4">
          {TOPICS.map((topic) => (
            <li key={topic.key} data-testid={`support-faq-${topic.key}`}>
              <h3 className="font-semibold text-gray-900">{t(`${topic.key}.question`)}</h3>
              <p className="mt-1 max-w-prose text-sm text-gray-700">
                {t.rich(`${topic.key}.answer`, { link: link(topic.href) })}
              </p>
            </li>
          ))}
        </ul>
      </Card>
      <Card id="support-policies" title={t("policiesTitle")}>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/report" className={linkClass}>
              {t("report")}
            </Link>
          </li>
          <li>
            <Link href="/trust" className={linkClass}>
              {tTrust("pageTitle")}
            </Link>
          </li>
          <li>
            <Link href="/privacy" className={linkClass}>
              {tTrust("policies.privacy")}
            </Link>
          </li>
        </ul>
      </Card>
    </>
  );
}
