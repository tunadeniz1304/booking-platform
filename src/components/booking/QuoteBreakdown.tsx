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
  // P1-8 Omnibus: indirim gösteriliyorsa referans fiyat son N günün en düşüğüdür (sunucudan).
  const discounted = (quote.discountTotal ?? 0) > 0;
  const reference = quote.lowestPrice30dMinor ?? null;
  const omnibusDays = quote.omnibusDays ?? 30;
  const strike = discounted && reference !== null && reference > quote.total;
  const uniform = quote.nights.every((x) => x.amount === quote.nights[0].amount);
  return (
    <div className="space-y-2 text-sm">
      <dl className="space-y-2">
        <div className="flex justify-between text-gray-600">
          <dt>
            {uniform
              ? t("nightsUniform", { price: fmt(quote.nights[0].amount, quote.currency), count: n })
              : t("nightsVariable", { count: n })}
          </dt>
          <dd>{fmt(quote.subtotal, quote.currency)}</dd>
        </div>
        {(quote.discounts ?? []).map((d) => (
          <div
            key={d.promotionId}
            className="flex justify-between text-green-800"
            data-testid="quote-discount"
          >
            <dt>
              {d.couponCode
                ? t("coupon", { code: d.couponCode })
                : t("promotion", { name: d.name })}
            </dt>
            <dd>−{fmt(d.amount, quote.currency)}</dd>
          </div>
        ))}
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
          <dd data-testid="quote-total">
            {/* Omnibus: üstü çizili referans yalnız son N günün en düşüğü toplamdan yüksekse. */}
            {strike && (
              <s className="mr-2 text-sm font-normal text-gray-500" data-testid="quote-reference">
                {fmt(reference!, quote.currency)}
              </s>
            )}
            {fmt(quote.total, quote.currency)}
          </dd>
        </div>
      </dl>
      {discounted && reference !== null && (
        <p className="text-xs text-gray-600" data-testid="quote-lowest-30d">
          {t("lowest30d", { days: omnibusDays, amount: fmt(reference, quote.currency) })}
          {strike && <span className="sr-only"> {t("lowest30dHint", { days: omnibusDays })}</span>}
        </p>
      )}
      {/* <dl> yalnızca dt/dd grupları içerebilir (axe definition-list); notlar listenin dışında. */}
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
    </div>
  );
}
