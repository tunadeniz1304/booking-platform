"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import {
  freeCancellation,
  type PolicySnapshotView,
} from "@/lib/booking/free-cancellation-deadline";

/** Rezervasyon anında saklanan fiyat kırılımı (`Booking.priceBreakdown`, minor-unit). */
export interface BookingPriceBreakdown {
  currency: string;
  nights: Array<{ date: string; amount: number }>;
  subtotal: number;
  fees: Array<{ code: string; label: string; amount: number; inclusive: boolean }>;
  taxes: Array<{ code: string; label: string; amount: number; inclusive: boolean }>;
  total: number;
  discounts?: Array<{
    promotionId: string;
    name: string;
    couponCode: string | null;
    amount: number;
  }>;
}

/** Arayüz dilinde adı bilinen vergi/ücret kodları (QuoteBreakdown ile aynı). */
const KNOWN_CHARGE_CODES = new Set(["VAT", "ACCOMMODATION_TAX", "SERVICE_FEE"]);
const POLICY_KINDS = new Set(["FLEXIBLE", "MODERATE", "STRICT", "NON_REFUNDABLE"]);
/** Tesis saat dilimi bilinmiyorsa (freeCancellation ile aynı varsayılan). */
const DEFAULT_TIME_ZONE = "Europe/Istanbul";

function isBreakdown(value: unknown): value is BookingPriceBreakdown {
  const v = value as Partial<BookingPriceBreakdown> | null;
  return (
    !!v &&
    typeof v.currency === "string" &&
    Array.isArray(v.nights) &&
    v.nights.length > 0 &&
    typeof v.subtotal === "number" &&
    typeof v.total === "number" &&
    Array.isArray(v.fees) &&
    Array.isArray(v.taxes)
  );
}

/**
 * Rezervasyon anındaki fiyat dökümü: gece × fiyat, indirimler, ücretler ve hariç vergiler.
 * Toplam satırı sayfada kalır; kırılım tahsilattan farklı para birimindeyse kendi toplamı da
 * gösterilir (`showTotal` ya da `chargeCurrency` farklıysa). Tutarlar sunucudaki anlık
 * görüntüdür, burada hesaplama yapılmaz.
 */
export default function BookingPriceSnapshot({
  breakdown,
  showTotal = false,
  chargeCurrency,
}: {
  breakdown: unknown;
  showTotal?: boolean;
  /** Tahsilat para birimi; kırılımınkinden farklıysa kırılımın kendi toplamı da gösterilir. */
  chargeCurrency?: string;
}) {
  const t = useTranslations("booking");
  const tq = useTranslations("quote");
  const f = useFormat();
  const headingId = useId();
  if (!isBreakdown(breakdown)) return null;
  const { currency, nights } = breakdown;
  const withTotal = showTotal || (chargeCurrency !== undefined && chargeCurrency !== currency);
  const fmt = (amount: number) => f.money(amount, currency);
  const label = (x: { code: string; label: string }) =>
    KNOWN_CHARGE_CODES.has(x.code) ? tq(`taxKind.${x.code}`) : x.label;
  const uniform = nights.every((x) => x.amount === nights[0].amount);
  return (
    <section aria-labelledby={headingId} className="space-y-2 text-sm">
      <h2 id={headingId} className="font-semibold text-gray-900">
        {t("detail.priceTitle")}
      </h2>
      <dl className="space-y-2">
        <div className="flex justify-between gap-4 text-gray-600">
          <dt>
            {uniform
              ? tq("nightsUniform", { price: fmt(nights[0].amount), count: nights.length })
              : tq("nightsVariable", { count: nights.length })}
          </dt>
          <dd>{fmt(breakdown.subtotal)}</dd>
        </div>
        {(breakdown.discounts ?? []).map((d) => (
          <div key={d.promotionId} className="flex justify-between gap-4 text-green-800">
            <dt>
              {d.couponCode
                ? tq("coupon", { code: d.couponCode })
                : tq("promotion", { name: d.name })}
            </dt>
            <dd>−{fmt(d.amount)}</dd>
          </div>
        ))}
        {breakdown.fees.map((x) => (
          <div key={x.code} className="flex justify-between gap-4 text-gray-600">
            <dt>{label(x)}</dt>
            <dd>{fmt(x.amount)}</dd>
          </div>
        ))}
        {breakdown.taxes
          .filter((x) => !x.inclusive)
          .map((x) => (
            <div key={x.code} className="flex justify-between gap-4 text-gray-600">
              <dt>{label(x)}</dt>
              <dd>{fmt(x.amount)}</dd>
            </div>
          ))}
        {withTotal && (
          <div className="flex justify-between gap-4 font-semibold text-gray-900">
            <dt>{tq("total")}</dt>
            <dd>{fmt(breakdown.total)}</dd>
          </div>
        )}
      </dl>
      {/* Dahil vergiler toplamı değiştirmez; bilgi amaçlı (<dl> dışında, axe definition-list). */}
      {breakdown.taxes
        .filter((x) => x.inclusive && x.amount > 0)
        .map((x) => (
          <p key={x.code} className="text-xs text-gray-500">
            {tq("includedTax", { label: label(x), rate: "", amount: fmt(x.amount) })}
          </p>
        ))}
    </section>
  );
}

/**
 * Rezervasyon anındaki iptal politikası ve ücretsiz iptal son anı (tesisin yerel saatiyle).
 * Politika okunamazsa hiçbir şey göstermez.
 */
export function CancellationDeadlineNote({
  policy,
  checkIn,
  createdAt,
  timeZone,
  checkInTime,
}: {
  policy: unknown;
  checkIn: string;
  createdAt?: string | null;
  timeZone?: string | null;
  checkInTime?: string | null;
}) {
  const t = useTranslations("booking");
  const tp = useTranslations("property");
  const f = useFormat();
  const snapshot = policy && typeof policy === "object" ? (policy as PolicySnapshotView) : null;
  const state = freeCancellation(snapshot, { checkIn, createdAt, timeZone, checkInTime });
  if (!state) return null;
  // Son an tesisin yerel saatiyle hesaplanır; gösterim de aynı saat diliminde olmalı.
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const when =
    state.kind === "none"
      ? null
      : { date: f.date(state.deadline, "long", zone), time: f.time(state.deadline, zone) };
  const kind = snapshot?.kind && POLICY_KINDS.has(snapshot.kind) ? snapshot.kind : null;
  return (
    <div className="space-y-1 text-sm text-gray-700" data-testid="booking-free-cancellation">
      {kind && (
        <p className="font-semibold text-gray-900">
          {tp("policies.cancellationTitle", { kind: tp(`policies.kinds.${kind}`) })}
        </p>
      )}
      <p>
        {when === null
          ? t("detail.cancellation.none")
          : state.kind === "until"
            ? t("detail.cancellation.until", when)
            : t("detail.cancellation.ended", when)}
      </p>
    </div>
  );
}
