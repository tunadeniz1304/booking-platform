import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

const link =
  "font-semibold text-[#003580] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

/** KVKK aydınlatma metni (P2-5) — demo içerik, hukuki görüş değildir. */
export default async function PrivacyPage() {
  const t = await getTranslations("privacy.notice");
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <article className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 text-sm leading-6 text-gray-900 shadow-sm">
          <header>
            <h1 className="text-2xl font-bold">{t("title")}</h1>
            <p
              role="note"
              className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950"
            >
              {t.rich("disclaimer", { strong: (c) => <strong>{c}</strong> })}
            </p>
          </header>

          <section aria-labelledby="p-controller">
            <h2 id="p-controller" className="text-lg font-semibold">
              {t("controller.title")}
            </h2>
            <p>{t("controller.body")}</p>
          </section>

          <section aria-labelledby="p-data">
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

          <section aria-labelledby="p-purpose">
            <h2 id="p-purpose" className="text-lg font-semibold">
              {t("purpose.title")}
            </h2>
            <p>{t("purpose.body")}</p>
          </section>

          <section aria-labelledby="p-transfer">
            <h2 id="p-transfer" className="text-lg font-semibold">
              {t("transfer.title")}
            </h2>
            <p>{t("transfer.body")}</p>
          </section>

          <section aria-labelledby="p-retention">
            <h2 id="p-retention" className="text-lg font-semibold">
              {t("retention.title")}
            </h2>
            <p>{t("retention.body")}</p>
          </section>

          <section aria-labelledby="p-cookies">
            <h2 id="p-cookies" className="text-lg font-semibold">
              {t("cookies.title")}
            </h2>
            <p>
              {t.rich("cookies.body", {
                strong: (c) => <strong>{c}</strong>,
                code: (c) => <code>{c}</code>,
              })}
            </p>
          </section>

          <section aria-labelledby="p-rights">
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
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
