"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

interface Mail {
  id: string;
  to: string;
  subject: string;
  text: string;
  status: string;
  transport: string;
  createdAt: string;
}

/** Geliştirme posta kutusu (SMTP yokken gönderilen Türkçe e-postalar). */
export default function MailboxClient() {
  const t = useTranslations("mailbox");
  const fmt = useFormat();
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<Mail[]>("/api/dev/mailbox")
      .then((m) => active && setMails(m))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-600">{t("subtitle")}</p>
        {error && (
          <p role="alert" className="mt-4 text-red-700">
            {error}
          </p>
        )}
        {mails?.length === 0 && <p className="mt-6 text-gray-500">{t("empty")}</p>}
        <ul className="mt-6 space-y-4">
          {mails?.map((m) => (
            <li key={m.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">
                {fmt.dateTime(m.createdAt)} · {m.to} · {m.transport}/{m.status}
              </p>
              <h2 className="mt-1 font-semibold text-gray-900">{m.subject}</h2>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-700">
                {m.text}
              </pre>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </div>
  );
}
