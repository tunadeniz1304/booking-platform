"use client";

import { formatMoney, money } from "@/lib/money/money";
import type { QuoteView } from "./useQuote";

function fmt(amount: number, currency: string): string {
  return formatMoney(money(amount, currency));
}

/**
 * Şeffaf, vergi dahil ("all-in") fiyat kırılımı. Tüm tutarlar sunucudaki teklifin
 * birebir kopyasıdır; burada hesaplama yapılmaz.
 */
export default function QuoteBreakdown({ quote }: { quote: QuoteView }) {
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
        <dt>Toplam (vergiler dahil)</dt>
        <dd data-testid="quote-total">{fmt(quote.total, quote.currency)}</dd>
      </div>
    </dl>
  );
}
