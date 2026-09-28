"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, PageShell } from "@/components/ui/ui";

/** Kaynak depo; CI artefaktları (SBOM, SLSA provenance) ve güvenlik politikası burada. */
const REPO_URL = "https://github.com/tunadeniz1304/booking-platform";
/** `.github/workflows/security.yml` — `sbom-cyclonedx` artefaktını üreten iş akışı. */
const SECURITY_WORKFLOW_URL = `${REPO_URL}/actions/workflows/security.yml`;
const SECURITY_POLICY_URL = `${REPO_URL}/blob/main/SECURITY.md`;

const linkClass = "font-semibold text-brand underline underline-offset-2 hover:no-underline";

interface Item {
  key: string;
  href: string;
  external?: boolean;
  /** Kullanıcıya indirme/erişim koşulunu açıklayan ek not anahtarı. */
  note?: string;
}

interface Section {
  key: string;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    key: "supplyChain",
    items: [
      { key: "sbom", href: SECURITY_WORKFLOW_URL, external: true, note: "sbomNote" },
      { key: "provenance", href: SECURITY_WORKFLOW_URL, external: true, note: "provenanceNote" },
      { key: "scorecard", href: SECURITY_WORKFLOW_URL, external: true, note: "scorecardNote" },
    ],
  },
  {
    key: "apis",
    items: [
      { key: "jwks", href: "/.well-known/jwks.json", note: "jwksNote" },
      { key: "openapi", href: "/api/openapi.json", note: "openapiNote" },
    ],
  },
  {
    key: "policies",
    items: [
      { key: "securityPolicy", href: SECURITY_POLICY_URL, external: true, note: "securityNote" },
      { key: "transparency", href: "/admin/compliance", note: "transparencyNote" },
      { key: "ranking", href: "/ranking" },
      { key: "report", href: "/report" },
      { key: "privacy", href: "/privacy" },
    ],
  },
];

/**
 * v5 P2-1 güven merkezi: tedarik zinciri (SBOM, provenance, Scorecard), herkese açık
 * doğrulama uçları (JWKS, OpenAPI) ve politika/şeffaflık bağlantıları tek sayfada.
 * Oturum gerektirmez; yalnız kamuya açık bilgi içerir.
 */
export default function TrustCenterPage() {
  const t = useTranslations("trustCenter");
  return (
    <PageShell title={t("pageTitle")} intro={t("pageIntro")}>
      {SECTIONS.map((section) => (
        <Card key={section.key} id={`trust-${section.key}`} title={t(`${section.key}.title`)}>
          <ul className="space-y-4">
            {section.items.map((item) => (
              <li key={item.key} data-testid={`trust-${item.key}`}>
                {item.external ? (
                  <a href={item.href} className={linkClass} rel="noopener noreferrer">
                    {t(`${section.key}.${item.key}`)}
                  </a>
                ) : item.href.startsWith("/api/") || item.href.startsWith("/.well-known/") ? (
                  // JSON uçları: istemci yönlendirmesi değil, tam sayfa isteği.
                  <a href={item.href} className={linkClass}>
                    {t(`${section.key}.${item.key}`)}
                  </a>
                ) : (
                  <Link href={item.href} className={linkClass}>
                    {t(`${section.key}.${item.key}`)}
                  </Link>
                )}
                {item.note && (
                  <p className="mt-1 text-sm text-gray-700">{t(`${section.key}.${item.note}`)}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <p className="text-xs text-gray-600">{t("footnote")}</p>
    </PageShell>
  );
}
