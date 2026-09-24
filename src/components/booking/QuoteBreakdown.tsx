"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatMoney, money } from "@/lib/money/money";
import { convert } from "@/lib/money/fx";
import type { QuoteView } from "./useQuote";

function fmt(amount: number, currency: string): string {
  return formatMoney(money(amount, currency));
}

/**
 * Şeffaf, vergi dahil ("all-in") fiyat kırılımı. Tüm tutarlar sunucudaki teklifin
 * birebir kopyasıdır; burada hesaplama yapılmaz.
 */
export default function QuoteBreakdown({ quote }: { quote: QuoteView }) {
  const t = useTranslations("quote");
  const locale = useLocale();
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
            ? `${fmt(quote.nights[0].amount, quote.currency)} × ${n} gece`
            : `${n} gece (gecelik fiyatlar değişken)`}
        </dt>
        <dd>{fmt(quote.subtotal, quote.currency)}</dd>
      </div>
      {quote.fees.map((f) => (
        <div key={f.code} className="flex justify-between text-gray-600">
          <dt>{f.label}</dt>
          <dd>{fmt(f.amount, quote.currency)}</dd>
        </div>
      ))}
      {quote.taxes.map((t) => (
        <div key={t.code} className="flex justify-between text-gray-600">
          <dt>
            {t.label} (%{Math.round(t.rate * 10000) / 100})
          </dt>
          <dd>{fmt(t.amount, quote.currency)}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-semibold text-gray-900">
        <dt>{t("total")}</dt>
        <dd data-testid="quote-total">{fmt(quote.total, quote.currency)}</dd>
      </div>
      {approx && (
        <p className="text-xs text-gray-500" data-testid="quote-fx">
          {t("approx", { amount: approx, currency: quote.currency })}
        </p>
      )}
    </dl>
  );
}
