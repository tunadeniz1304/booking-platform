"use client";

import { useLocale, useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { formatMoney, money } from "@/lib/money/money";
import { convert } from "@/lib/money/fx";
import type { QuoteView } from "./useQuote";

/**
 * Şeffaf, vergi dahil ("all-in") fiyat kırılımı. Tüm tutarlar sunucudaki teklifin
 * birebir kopyasıdır; burada hesaplama yapılmaz.
 */
export default function QuoteBreakdown({ quote }: { quote: QuoteView }) {
  const t = useTranslations("quote");
  const locale = useLocale();
  const f = useFormat();
  const fmt = (amount: number, currency: string) => f.money(amount, currency);
  // Oran metni dile göre ("%8" / "8%"); sayı string verilir ki ICU yeniden biçimlemesin.
  const rate = (bps: number | undefined) =>
    bps !== undefined ? t("rate", { rate: String(bps / 100) }) : "";
  // İngilizce arayüzde bilgi amaçlı USD karşılığı (tahsilat mülkün para biriminde).
  const approx =
    locale === "en" && quote.currency !== "USD"
      ? formatMoney(convert(money(quote.total, quote.currency), "USD"), "en-US")
      : null;
  const n = quote.nights.length;
  const uniform = quote.nights.every((x) => x.amount === quote.nights[0].amount);
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between text-gray-600">
        <dt>
          {uniform
            ? t("nightsUniform", { price: fmt(quote.nights[0].amount, quote.currency), count: n })
            : t("nightsVariable", { count: n })}
        </dt>
        <dd>{fmt(quote.subtotal, quote.currency)}</dd>
      </div>
      {quote.fees.map((f) => (
        <div key={f.code} className="flex justify-between text-gray-600">
          <dt>{f.label}</dt>
          <dd>{fmt(f.amount, quote.currency)}</dd>
        </div>
      ))}
      {quote.taxes
        .filter((x) => !x.inclusive)
        .map((x) => (
          <div key={x.code} className="flex justify-between text-gray-600">
            <dt>
              {x.label}
              {rate(x.rateBps)}
            </dt>
            <dd>{fmt(x.amount, quote.currency)}</dd>
          </div>
        ))}
      <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-semibold text-gray-900">
        <dt>{t("total")}</dt>
        <dd data-testid="quote-total">{fmt(quote.total, quote.currency)}</dd>
      </div>
      {/* Dahil vergiler toplamı değiştirmez; yalnızca bilgi amaçlı (fiyatın içindedir). */}
      {quote.taxes
        .filter((x) => x.inclusive)
        .map((x) => (
          <p key={x.code} className="text-xs text-gray-500" data-testid="quote-included-tax">
            {t("includedTax", {
              label: x.label,
              rate: rate(x.rateBps),
              amount: fmt(x.amount, quote.currency),
            })}
          </p>
        ))}
      {approx && (
        <p className="text-xs text-gray-500" data-testid="quote-fx">
          {t("approx", { amount: approx, currency: quote.currency })}
        </p>
      )}
    </dl>
  );
}
