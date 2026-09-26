"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { focusRing } from "@/components/ui/ui";
import { ClaimStatusBadge, type ClaimSummary } from "./shared";

/**
 * Talep listesi. `onSelect` verilirse (yönetici) her satırda seçim düğmesi, verilmezse
 * `/resolution/<id>` bağlantısı gösterilir.
 */
export default function ClaimList({
  claims,
  onSelect,
  selectedId,
  showRole = true,
}: {
  claims: ClaimSummary[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  showRole?: boolean;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const linkClass = `font-semibold text-[#003580] underline ${focusRing}`;
  return (
    <ul className="space-y-3">
      {claims.map((c) => (
        <li
          key={c.id}
          className={`rounded-md border p-3 text-sm ${
            selectedId === c.id ? "border-[#003580] bg-blue-50" : "border-gray-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{t(`type.${c.type}`)}</span>
            <ClaimStatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-gray-700">
            {c.propertyTitle ?? t("list.bookingRef", { id: c.bookingId })} ·{" "}
            {t("list.requested", { amount: f.money(c.amountRequestedMinor, c.currency) })}
            {c.awardedMinor !== null &&
              ` · ${t("list.awarded", { amount: f.money(c.awardedMinor, c.currency) })}`}
          </p>
          <p className="text-gray-600">
            {t("list.created", { date: f.dateTime(c.createdAt) })}
            {showRole && ` · ${t("list.yourRole", { role: t(`role.${c.role}`) })}`}
          </p>
          {c.status === "AWAITING_RESPONSE" && c.slaDueAt && (
            <p className="font-medium text-amber-800">
              {t("list.slaDue", { date: f.dateTime(c.slaDueAt) })}
            </p>
          )}
          <div className="mt-2">
            {onSelect ? (
              <button
                type="button"
                className={linkClass}
                aria-pressed={selectedId === c.id}
                onClick={() => onSelect(c.id)}
              >
                {t("admin.select")}
              </button>
            ) : (
              <Link href={`/resolution/${encodeURIComponent(c.id)}`} className={linkClass}>
                {t("list.open")}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
