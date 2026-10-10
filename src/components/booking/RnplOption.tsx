"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

export interface RnplOffer {
  available: boolean;
  reason?: string;
  dueTodayMinor: number;
  amountMinor: number;
  currency: string;
  dueAt?: string;
  freeCancellationUntil?: string;
  /** Tesisin IANA saat dilimi (sunucu verirse); yoksa ziyaretçinin saat dilimi kullanılır. */
  timeZone?: string;
}

interface Props {
  bookingId: string;
  disabled?: boolean;
  selected: boolean;
  onChange: (rnpl: boolean) => void;
}

/**
 * P1-3 "Şimdi rezerve et, sonra öde" seçimi. Teklif sunucudan gelir; uygun değilse (ya da
 * RNPL_ENABLED=false) hiçbir şey gösterilmez. Seçildiğinde iptal zaman çizelgesi görünür.
 */
export default function RnplOption({ bookingId, disabled, selected, onChange }: Props) {
  const [offer, setOffer] = useState<RnplOffer | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<RnplOffer>(`/api/bookings/${bookingId}/rnpl`)
      .then((o) => alive && setOffer(o))
      .catch(() => undefined); // Teklif okunamazsa seçenek görünmez; ödeme "şimdi öde" kalır.
    return () => {
      alive = false;
    };
  }, [bookingId]);

  return <RnplChoice offer={offer} disabled={disabled} selected={selected} onChange={onChange} />;
}

/** Sunum: teklif uygun değilse hiçbir şey; seçiliyse iptal zaman çizelgesi (test edilebilir). */
export function RnplChoice({
  offer,
  disabled,
  selected,
  onChange,
}: Omit<Props, "bookingId"> & { offer: RnplOffer | null }) {
  const t = useTranslations("payment.rnpl");
  const f = useFormat();
  if (!offer?.available || !offer.dueAt || !offer.freeCancellationUntil) return null;
  const amount = f.money(offer.amountMinor, offer.currency);
  const today = f.money(0, offer.currency);
  // Son tarih bir andır (tesis yerel saatiyle giriş saatine bağlı): tarih + saat + saat dilimi.
  const tz = offer.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const moment = (iso: string) => {
    const tzName =
      new Intl.DateTimeFormat(f.locale, { timeZone: tz, timeZoneName: "short" })
        .formatToParts(new Date(iso))
        .find((p) => p.type === "timeZoneName")?.value ?? tz;
    return t("moment", { date: f.date(iso, "long", tz), time: f.time(iso, tz), tz: tzName });
  };
  const due = moment(offer.dueAt);
  const freeUntil = moment(offer.freeCancellationUntil);

  return (
    <fieldset className="space-y-2" disabled={disabled} data-testid="rnpl-option">
      <legend className="text-sm font-semibold text-gray-900">{t("legend")}</legend>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="radio"
          name="payment-option"
          className="mt-1"
          checked={!selected}
          onChange={() => onChange(false)}
        />
        <span>{t("payNow", { amount })}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="radio"
          name="payment-option"
          className="mt-1"
          checked={selected}
          onChange={() => onChange(true)}
        />
        <span>{t("payLater", { today, amount, date: due })}</span>
      </label>
      {selected && (
        <ol
          className="ml-6 list-disc space-y-1 text-xs text-gray-600"
          aria-label={t("timeline")}
          data-testid="rnpl-timeline"
        >
          <li>{t("stepToday", { today })}</li>
          <li>{t("stepCharge", { date: due, amount })}</li>
          <li>{t("stepFreeCancel", { date: freeUntil })}</li>
          <li>{t("stepFailure")}</li>
        </ol>
      )}
    </fieldset>
  );
}
