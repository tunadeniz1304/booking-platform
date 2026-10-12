"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, PageShell, focusRing } from "@/components/ui/ui";

/** Kaynak depo (şu an özel): CI artefaktları (SBOM, SLSA provenance) ve güvenlik politikası. */
const REPO_URL = "https://github.com/tunadeniz1304/booking-platform";
/** `.github/workflows/security.yml`: `sbom-cyclonedx` ve provenance artefaktlarını üretir. */
const SECURITY_WORKFLOW_URL = `${REPO_URL}/actions/workflows/security.yml`;
const SECURITY_POLICY_URL = `${REPO_URL}/blob/main/SECURITY.md`;

const linkClass = `inline-block py-0.5 font-semibold text-brand underline underline-offset-2 hover:no-underline ${focusRing}`;
// WCAG 1.4.8: uzun açıklamalarda satır uzunluğu ~65 karakterle sınırlı.
const noteClass = "mt-1 max-w-prose text-sm text-gray-700";
const statusClass =
  "ml-2 inline-block rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700";

/**
 * `page`: uygulama içi sayfa; `json`: ham JSON uç (tam sayfa isteği); `github`: özel depoya giden
 * dış bağlantı; `admin`: yalnız yöneticilere açık sayfa. Türü olmayan öğe düz metindir.
 */
type LinkKind = "page" | "json" | "github" | "admin";

interface Item {
  /** data-testid ve not kimliği için kısa ad. */
  key: string;
  /** Etiket anahtarı; <sbom>, <slsa>, <jwks> kısaltma etiketleri desteklenir. */
  label: string;
  href?: string;
  kind?: LinkKind;
  /** Öğeyi sade dille açıklayan not; bağlantıya aria-describedby ile bağlanır. */
  note?: string;
  /** Bağlantı olmayan öğenin durum rozeti (ör. yayınlanmadı). */
  status?: string;
}

interface Section {
  key: string;
  items: Item[];
}

/** Bağlantı metninde görünen hedef/erişim ibaresi (WCAG 2.4.4). */
const KIND_BADGE: Partial<Record<LinkKind, string>> = {
  json: "badges.json",
  github: "badges.github",
  admin: "badges.adminOnly",
};

/** Misafiri ilgilendiren bölümler önce gelir. */
const SECTIONS: Section[] = [
  {
    key: "rights",
    items: [
      {
        key: "report",
        label: "policies.report",
        href: "/report",
        kind: "page",
        note: "rights.reportNote",
      },
      { key: "appeal", label: "rights.appeal", note: "rights.appealNote" },
      {
        key: "ranking",
        label: "policies.ranking",
        href: "/ranking",
        kind: "page",
        note: "rights.rankingNote",
      },
      {
        key: "privacy",
        label: "policies.privacy",
        href: "/privacy",
        kind: "page",
        note: "rights.privacyNote",
      },
      { key: "payment", label: "rights.payment", note: "rights.paymentNote" },
    ],
  },
  {
    key: "policies",
    items: [
      {
        key: "securityPolicy",
        label: "policies.securityPolicy",
        href: SECURITY_POLICY_URL,
        kind: "github",
        note: "policies.securityNote",
      },
      {
        key: "transparency",
        label: "policies.transparency",
        href: "/admin/compliance",
        kind: "admin",
        note: "policies.transparencyNote",
      },
    ],
  },
];

/** "Geliştiriciler ve denetçiler için" başlığı altında, sayfanın sonunda. */
const DEVELOPER_SECTIONS: Section[] = [
  {
    key: "supplyChain",
    items: [
      {
        key: "sbom",
        label: "supplyChain.sbom",
        href: SECURITY_WORKFLOW_URL,
        kind: "github",
        note: "supplyChain.sbomNote",
      },
      // Aynı iş akışının artefaktı: ayrı bir hedefi olmadığı için bağlantı değil.
      { key: "provenance", label: "supplyChain.provenance", note: "supplyChain.provenanceNote" },
      {
        key: "scorecard",
        label: "supplyChain.scorecard",
        note: "supplyChain.scorecardNote",
        status: "badges.notPublished",
      },
    ],
  },
  {
    key: "apis",
    items: [
      {
        key: "jwks",
        label: "apis.jwks",
        href: "/.well-known/jwks.json",
        kind: "json",
        note: "apis.jwksNote",
      },
      {
        key: "openapi",
        label: "apis.openapi",
        href: "/api/openapi.json",
        kind: "json",
        note: "apis.openapiNote",
      },
    ],
  },
];

function ExternalIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="ml-1 inline-block h-3.5 w-3.5 align-[-2px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 4h5v5M16 4l-7 7M14 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V6a4 4 0 1 1 8 0v3M4 9h12v8H4z" />
    </svg>
  );
}

/**
 * v5 P2-1 güven merkezi: önce misafirin güvenliği ve hakları (bildirim, itiraz, sıralama,
 * gizlilik, ödeme), sonra politikalar; tedarik zinciri ve doğrulama uçları en sonda
 * "geliştiriciler ve denetçiler için" başlığı altında. Oturum gerektirmez.
 */
export default function TrustCenterPage() {
  const t = useTranslations("trustCenter");
  // WCAG 3.1.4: kısaltmalar ilk geçtikleri bağlantıda açılımlarıyla.
  const abbr = (title: string) =>
    function AbbrChunks(chunks: ReactNode) {
      return <abbr title={title}>{chunks}</abbr>;
    };
  const abbrTags = {
    sbom: abbr(t("glossary.sbom")),
    slsa: abbr(t("glossary.slsa")),
    jwks: abbr(t("glossary.jwks")),
  };

  const renderItem = (item: Item) => {
    const noteId = item.note ? `trust-${item.key}-note` : undefined;
    const label = t.rich(item.label, abbrTags);
    const badge = item.kind ? KIND_BADGE[item.kind] : undefined;
    const content = (
      <>
        {item.kind === "admin" && <LockIcon />}
        {label}
        {badge && <span className="ml-1 text-sm font-normal">({t(badge)})</span>}
        {item.kind === "github" && <ExternalIcon />}
      </>
    );
    let head: ReactNode;
    if (!item.href) {
      head = (
        <>
          <span className="font-semibold text-gray-900">{label}</span>
          {item.status && <span className={statusClass}>{t(item.status)}</span>}
        </>
      );
    } else if (item.kind === "page" || item.kind === "admin") {
      head = (
        <Link href={item.href} className={linkClass} aria-describedby={noteId}>
          {content}
        </Link>
      );
    } else {
      // Dış bağlantılar ve JSON uçları: istemci yönlendirmesi değil, tam sayfa isteği.
      head = (
        <a
          href={item.href}
          className={linkClass}
          rel={item.kind === "github" ? "noopener noreferrer" : undefined}
          aria-describedby={noteId}
        >
          {content}
        </a>
      );
    }
    return (
      <li key={item.key} data-testid={`trust-${item.key}`}>
        {head}
        {item.note && (
          <p id={noteId} className={noteClass}>
            {t(item.note)}
          </p>
        )}
      </li>
    );
  };

  return (
    <PageShell title={t("pageTitle")} intro={<p className="max-w-prose">{t("pageIntro")}</p>}>
      {SECTIONS.map((section) => (
        <Card key={section.key} id={`trust-${section.key}`} title={t(`${section.key}.title`)}>
          <ul className="space-y-4">{section.items.map(renderItem)}</ul>
        </Card>
      ))}
      <Card id="trust-developers" title={t("developers.title")}>
        <p className="max-w-prose text-sm text-gray-700">{t("developers.intro")}</p>
        {DEVELOPER_SECTIONS.map((section) => (
          <section
            key={section.key}
            id={`trust-${section.key}`}
            aria-labelledby={`trust-${section.key}-title`}
            className="mt-5"
          >
            <h3 id={`trust-${section.key}-title`} className="mb-3 font-semibold text-gray-900">
              {t(`${section.key}.title`)}
            </h3>
            <ul className="space-y-4">{section.items.map(renderItem)}</ul>
          </section>
        ))}
      </Card>
      <p className="max-w-prose text-xs text-gray-600">{t("footnote")}</p>
    </PageShell>
  );
}
