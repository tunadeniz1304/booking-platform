import { getTranslations } from "next-intl/server";
import type { PublicAccessibilityFeature } from "@/lib/compliance/accessibility";

/**
 * P1-13(e) ilan sayfası erişilebilirlik bölümü (ADA 36.302(e)(1)(ii) açıklama gerekliliği):
 * yalnız kanıtla doğrulanmış özellikler, ilan/oda düzeyinde gruplu ve "doğrulanmış" rozetli.
 */
export default async function AccessibilitySection({
  features,
}: {
  features: PublicAccessibilityFeature[];
}) {
  const t = await getTranslations("compliance.accessibility");
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
      <p className="mt-1 text-sm text-gray-600">{t("disclosure")}</p>
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
                <span
                  className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800"
                  title={t("verifiedHint")}
                >
                  <span aria-hidden="true">✓&nbsp;</span>
                  {t("verified")}
                </span>
                {feature.evidencePhotoUrl && (
                  <a
                    href={feature.evidencePhotoUrl}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-[#003580] underline"
                  >
                    {t("evidence")}
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
