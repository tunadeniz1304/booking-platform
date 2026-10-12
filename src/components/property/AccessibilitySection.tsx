import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PublicAccessibilityFeature } from "@/lib/compliance/accessibility";

// ui.tsx "use client" modülü; sunucu bileşeninde aynı focusRing sınıfları yerel kopya.
const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

/**
 * P1-13(e) ilan sayfası erişilebilirlik bölümü (ADA 36.302(e)(1)(ii) açıklama gerekliliği):
 * yalnız kanıtla doğrulanmış özellikler, ilan/oda düzeyinde gruplu ve "doğrulanmış" rozetli.
 */
export default async function AccessibilitySection({
  features,
  propertyId,
  propertyTitle,
}: {
  features: PublicAccessibilityFeature[];
  /** Verilirse Destek bağlantısı konuyu ve ilanı ön doldurur. */
  propertyId?: string;
  propertyTitle?: string;
}) {
  const t = await getTranslations("compliance.accessibility");
  const supportQuery = new URLSearchParams({ topic: "accessibility" });
  if (propertyId) supportQuery.set("propertyId", propertyId);
  if (propertyTitle) supportQuery.set("propertyTitle", propertyTitle);
  const supportHref =
    propertyId || propertyTitle ? `/support?${supportQuery.toString()}` : "/support";
  const groups = new Map<string, { label: string; items: PublicAccessibilityFeature[] }>();
  for (const feature of features) {
    const key = feature.roomTypeId ?? "";
    const label = feature.roomTypeName
      ? t("roomType", { name: feature.roomTypeName })
      : t("wholeProperty");
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(feature);
    groups.set(key, group);
  }

  return (
    <section className="mt-8" aria-labelledby="accessibility-title">
      <h2 id="accessibility-title" className="text-xl font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        {t("disclosure")}{" "}
        <Link
          href={supportHref}
          className={`inline-flex min-h-[44px] items-center text-[#003580] underline sm:min-h-0 ${focusRing}`}
        >
          {t("askSupport")}
        </Link>
      </p>
      <p className="mt-1 text-sm text-gray-600">{t("verifiedExplainer")}</p>
      {[...groups.entries()].map(([key, group]) => (
        <div key={key || "property"} className="mt-4">
          <h3 className="text-sm font-medium text-gray-800">{group.label}</h3>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.items.map((feature) => (
              <li
                key={`${key}-${feature.code}`}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800"
              >
                <span>{t(`codes.${feature.code}`)}</span>
                {feature.widthCm !== null && (
                  <span className="text-gray-600">({t("width", { width: feature.widthCm })})</span>
                )}
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                  <span aria-hidden="true">✓&nbsp;</span>
                  {t("verified")}
                </span>
                {feature.evidencePhotoUrl && (
                  <a
                    href={feature.evidencePhotoUrl}
                    target="_blank"
                    rel="noopener"
                    aria-label={t("evidenceLabel", { feature: t(`codes.${feature.code}`) })}
                    className={`inline-flex min-h-[44px] items-center gap-1 text-xs text-[#003580] underline sm:min-h-0 ${focusRing}`}
                  >
                    {t("evidence")}
                    {/* Yeni sekme simgesi; ekran okuyucu için aria-label'da söylenir. */}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M9 2h5v5M14 2 7 9M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" />
                    </svg>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
