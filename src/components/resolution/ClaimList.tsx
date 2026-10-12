"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { focusRing } from "@/components/ui/ui";
import { ClaimStatusBadge, ClaimStatusHelp, usePartyLabel, type ClaimSummary } from "./shared";

const HOUR_MS = 3_600_000;

/** Kalan süre metni için dakikada bir güncellenen saat (sunucuda ve ilk çizimde yok). */
function subscribeMinute(onChange: () => void) {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const noMinute = () => null;

/** Yönetici satırı: kısa rezervasyon kimliği (tam değer `title`da); düğme tam değeri kopyalar. */
function BookingIdCopy({ id }: { id: string }) {
  const t = useTranslations("resolution");
  const ta = useTranslations("admin");
  const [copied, setCopied] = useState(false);
  const label = t("list.bookingRef", { id: id.slice(-8) });
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano erişimi yok: tam değer `title` ipucunda duruyor.
    }
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-gray-600">
      <span title={id} className="min-w-0 [overflow-wrap:anywhere]">
        {label}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={ta("ids.copyLabel", { name: label })}
        className={`inline-flex min-h-[24px] items-center rounded text-xs font-semibold text-[#003580] underline ${focusRing}`}
      >
        {copied ? ta("ids.copied") : ta("ids.copy")}
      </button>
      <span role="status" className="sr-only">
        {copied ? ta("ids.copied") : ""}
      </span>
    </p>
  );
}

/**
 * Talep listesi. `onSelect` verilirse (yönetici) her satırda seçim düğmesi ve kopyalanabilir
 * rezervasyon kimliği, verilmezse `/resolution/<id>` bağlantısı gösterilir. Satır başlıkları
 * (talep türü) `headingLevel` düzeyindedir; liste bir h3 bölümündeyse 4 verin.
 */
export default function ClaimList({
  claims,
  onSelect,
  selectedId,
  showRole = true,
  headingLevel = 3,
}: {
  claims: ClaimSummary[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  showRole?: boolean;
  headingLevel?: 3 | 4;
}) {
  const t = useTranslations("resolution");
  const partyLabel = usePartyLabel();
  const RowHeading = headingLevel === 4 ? "h4" : "h3";
  const f = useFormat();
  const now = useSyncExternalStore<number | null>(subscribeMinute, currentMinute, noMinute);
  const linkClass = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`;
  const timeLeft = (due: string) => {
    const ms = now === null ? NaN : new Date(due).getTime() - now;
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return t("list.deadlinePassed");
    if (ms < HOUR_MS) return t("list.timeLeftUnderHour");
    if (ms < 48 * HOUR_MS) return t("list.timeLeftHours", { count: Math.floor(ms / HOUR_MS) });
    return t("list.timeLeftDays", { count: Math.floor(ms / (24 * HOUR_MS)) });
  };
  return (
    <ul className="space-y-3">
      {claims.map((c) => {
        const selected = selectedId === c.id;
        // Mülk adı yoksa ham kimlik yerine kısa rezervasyon referansı (son 8 karakter).
        const subject = c.propertyTitle ?? t("list.bookingRef", { id: c.bookingId.slice(-8) });
        const typeLabel = t(`type.${c.type}`);
        // Satırlarda tekrar eden bağlantı/düğme adlarını ekran okuyucu için ayırt eder.
        const context = (
          <span className="sr-only"> {t("list.rowContext", { type: typeLabel, subject })}</span>
        );
        const left = c.slaDueAt ? timeLeft(c.slaDueAt) : null;
        return (
          <li
            key={c.id}
            aria-current={selected ? "true" : undefined}
            className={`min-w-0 rounded-md border p-3 text-sm ${
              selected ? "border-[#003580] bg-blue-50" : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <RowHeading className="font-medium text-gray-900">{typeLabel}</RowHeading>
              <ClaimStatusBadge status={c.status} />
              {selected && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#003580] px-2 py-0.5 text-xs font-semibold text-[#003580]">
                  <span aria-hidden="true">{"\u2713"}</span>
                  {t("admin.selectedBadge")}
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-gray-700 [overflow-wrap:anywhere]">
              {/* Yöneticide kimlik aşağıda ayrı satırda; başlık yoksa burada tekrarlanmaz. */}
              {(c.propertyTitle !== null || !onSelect) && `${subject} · `}
              {t("list.requested", { amount: f.money(c.amountRequestedMinor, c.currency) })}
              {c.awardedMinor !== null &&
                ` · ${t("list.awarded", { amount: f.money(c.awardedMinor, c.currency) })}`}
            </p>
            <p className="text-gray-600">
              {t("list.created", { date: f.dateTime(c.createdAt) })}
              {showRole && ` · ${t("list.yourRole", { role: partyLabel(c.type, c.role) })}`}
            </p>
            {onSelect && <BookingIdCopy id={c.bookingId} />}
            {c.status === "AWAITING_RESPONSE" && c.slaDueAt ? (
              <p className="font-medium text-amber-800">
                {left && <span className="font-semibold">{left} · </span>}
                {c.role === "RESPONDENT"
                  ? t("list.respondCta", { date: f.dateTime(c.slaDueAt) })
                  : c.role === "OPENER"
                    ? t("list.awaitingOther", { date: f.dateTime(c.slaDueAt) })
                    : t("list.slaDue", { date: f.dateTime(c.slaDueAt) })}
              </p>
            ) : (
              // Yanıt süresi satırı yoksa durumun ne anlama geldiği ve sizden bir şey beklenip
              // beklenmediği yazılır.
              <ClaimStatusHelp status={c.status} role={c.role} type={c.type} />
            )}
            <div className="mt-2">
              {onSelect ? (
                // Seçim toggle değil: durum li'deki aria-current ve "Seçili" rozetiyle
                // verilir; seçiliyken düğme odağı ayrıntıya geri götürür.
                <button type="button" className={linkClass} onClick={() => onSelect(c.id)}>
                  {selected ? t("admin.goToDetail") : t("admin.select")}
                  {context}
                </button>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href={`/resolution/${encodeURIComponent(c.id)}`} className={linkClass}>
                    {t("list.open")}
                    {context}
                  </Link>
                  {c.role === "RESPONDENT" &&
                    c.status === "AWAITING_RESPONSE" &&
                    c.type !== "CHARGEBACK" && (
                      <Link
                        href={`/resolution/${encodeURIComponent(c.id)}#claim-msg-${encodeURIComponent(c.id)}`}
                        className={linkClass}
                      >
                        {t("list.respondNow")}
                        {context}
                      </Link>
                    )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
