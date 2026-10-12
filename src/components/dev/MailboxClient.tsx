"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, RoleGate, Status, buttonClass, focusRing, useErrorText } from "@/components/ui/ui";

interface Mail {
  id: string;
  to: string;
  subject: string;
  text: string;
  status: string;
  transport: string;
  createdAt: string;
}

/** API'nin döndürdüğü en fazla e-posta sayısı (api/dev/mailbox `take`). */
const MAILBOX_LIMIT = 50;

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** E-posta bağlantıları uygulamanın adresiyle üretilir (auth-notifications `appBaseUrl`). */
const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  } catch {
    return null;
  }
})();

/** Yalnız bu uygulamaya ait bağlantılar tıklanır; geçerli adreste açılsın diye yol döner. */
function internalPath(raw: string): string | null {
  try {
    const url = new URL(raw);
    const own = typeof window === "undefined" ? null : window.location.origin;
    if (url.origin !== own && url.origin !== APP_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Düz metindeki uygulama bağlantılarını tıklanabilir `<a>` öğelerine çevirir. */
function linkify(text: string, focusClass: string) {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) return part;
    const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    const href = internalPath(url);
    if (!href) return part;
    return (
      <span key={i}>
        <a href={href} className={`break-all underline ${focusClass}`}>
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}

/** Doğrulama/sıfırlama e-postasındaki ana bağlantı (konu altında düğme olarak gösterilir). */
function primaryAction(text: string): { href: string; kind: "verify" | "reset" } | null {
  for (const match of text.matchAll(URL_PATTERN)) {
    const href = internalPath(match[0].replace(TRAILING_PUNCTUATION, ""));
    if (href?.startsWith("/verify-email")) return { href, kind: "verify" };
    if (href?.startsWith("/reset-password")) return { href, kind: "reset" };
  }
  return null;
}

/** Geliştirme posta kutusu: oturum sahibine gönderilen e-postalar (demo ortamı). */
export default function MailboxClient() {
  const t = useTranslations("mailbox");

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-600">{t("subtitle")}</p>
        <div className="mt-4">
          <RoleGate>{() => <MailboxList />}</RoleGate>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function MailboxList() {
  const t = useTranslations("mailbox");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const errorText = useErrorText();
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch<Mail[]>("/api/dev/mailbox")
      .then((m) => {
        if (!active) return;
        setMails(m);
        setFailure(null);
        setUpdatedAt(new Date());
      })
      .catch((e: unknown) => {
        if (active) setFailure({ error: e });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  const refresh = () => {
    if (loading) return;
    setLoading(true);
    setVersion((v) => v + 1);
  };

  const delivery = (m: Mail) => {
    if (m.status === "SENT") {
      return m.transport === "smtp" ? t("delivery.sentSmtp") : t("delivery.sentMailbox");
    }
    if (m.status === "PENDING") return t("delivery.pending");
    if (m.status === "FAILED") return t("delivery.failed");
    return t("delivery.unknown");
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" busy={loading} onClick={refresh}>
          {t("refresh")}
        </Button>
        <p role="status" className="text-sm text-gray-600">
          {loading ? tc("loading") : updatedAt && t("lastUpdated", { time: fmt.time(updatedAt) })}
        </p>
      </div>
      {failure && (
        <div className="mt-4">
          <Status error={errorText(failure.error)} />
        </div>
      )}
      {mails?.length === 0 && <p className="mt-6 text-gray-500">{t("empty")}</p>}
      {mails && mails.length >= MAILBOX_LIMIT && (
        <p className="mt-4 text-sm text-gray-600">{t("limitNote", { count: MAILBOX_LIMIT })}</p>
      )}
      <ul className="mt-6 space-y-4" aria-busy={loading || undefined}>
        {mails?.map((m) => {
          const action = primaryAction(m.text);
          return (
            <li
              key={m.id}
              className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <p className="break-all text-xs text-gray-500">
                {fmt.dateTime(m.createdAt)} · {t("to", { email: m.to })} · {delivery(m)}
              </p>
              <h2 className="mt-1 font-semibold text-gray-900">{m.subject}</h2>
              {action && (
                <a href={action.href} className={`mt-2 ${buttonClass()}`}>
                  {action.kind === "verify" ? t("actions.verify") : t("actions.reset")}
                </a>
              )}
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-gray-700 [overflow-wrap:anywhere]">
                {linkify(m.text, focusRing)}
              </pre>
            </li>
          );
        })}
      </ul>
    </>
  );
}
