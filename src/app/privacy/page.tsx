import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageShell, focusRing } from "@/components/ui/ui";
import { CookiePreferencesButton } from "@/components/privacy/PrivacyCenter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

const link = `font-semibold text-[#003580] underline ${focusRing}`;

/** KVKK aydınlatma metni (P2-5) — demo içerik, hukuki görüş değildir. */
// F1358: ortak PageShell kabuğu. F1175: bölümler adsız (h2 ile gezilir), yer imi şişmez.
export default async function PrivacyPage() {
  const t = await getTranslations("privacy.notice");
  // F612: düzeltme, itiraz ve bilgi talepleri için başvuru kanalı (insan destek ekibi).
  const supportLink = (c: ReactNode) => (
    <Link href="/support" className={link}>
      {c}
    </Link>
  );
  return (
    <PageShell title={t("title")}>
      <article className="max-w-3xl space-y-5 rounded-xl border border-gray-200 bg-white p-6 text-sm leading-6 text-gray-900 shadow-sm">
        <p
          role="note"
          className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950"
        >
          {t.rich("disclaimer", { strong: (c) => <strong>{c}</strong> })}
        </p>

        <section>
          <h2 id="p-controller" className="text-lg font-semibold">
            {t("controller.title")}
          </h2>
          <p>{t("controller.body")}</p>
          <p className="mt-2">{t.rich("controller.contact", { link: supportLink })}</p>
        </section>

        <section>
          <h2 id="p-data" className="text-lg font-semibold">
            {t("data.title")}
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("data.identity")}</li>
            <li>{t("data.transactions")}</li>
            <li>{t("data.finance")}</li>
            <li>{t("data.security")}</li>
          </ul>
        </section>

        <section>
          <h2 id="p-purpose" className="text-lg font-semibold">
            {t("purpose.title")}
          </h2>
          <p>{t("purpose.body")}</p>
        </section>

        <section>
          <h2 id="p-transfer" className="text-lg font-semibold">
            {t("transfer.title")}
          </h2>
          <p>{t("transfer.body")}</p>
        </section>

        <section>
          <h2 id="p-retention" className="text-lg font-semibold">
            {t("retention.title")}
          </h2>
          <p>{t("retention.body")}</p>
        </section>

        <section>
          <h2 id="p-cookies" className="text-lg font-semibold">
            {t("cookies.title")}
          </h2>
          <p>
            {t.rich("cookies.body", {
              strong: (c) => <strong>{c}</strong>,
              code: (c) => <code>{c}</code>,
            })}
          </p>
          <CookiePreferencesButton />
        </section>

        <section>
          <h2 id="p-rights" className="text-lg font-semibold">
            {t("rights.title")}
          </h2>
          <p>
            {t.rich("rights.body", {
              link: (c) => (
                <Link href="/account/privacy" className={link}>
                  {c}
                </Link>
              ),
            })}
          </p>
          <p className="mt-2">{t.rich("rights.requests", { link: supportLink })}</p>
        </section>
      </article>
    </PageShell>
  );
}
