"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { focusRing } from "@/components/ui/ui";
import { formatMoney, money } from "@/lib/money/money";
import { convert } from "@/lib/money/fx";
import type { QuoteView } from "./useQuote";

/** Arayüz dilinde adı bilinen vergi/ücret kodları; bilinmeyen kodda sunucu etiketi kullanılır. */
const KNOWN_CHARGE_CODES = new Set(["VAT", "ACCOMMODATION_TAX", "SERVICE_FEE"]);

/**
 * Şeffaf, vergi dahil ("all-in") fiyat kırılımı. Tüm tutarlar sunucudaki teklifin
 * birebir kopyasıdır; burada hesaplama yapılmaz.
 */
export default function QuoteBreakdown({
  quote,
  heading,
  onExpire,
}: {
  quote: QuoteView;
  /** Verilirse dökümün önüne ekran okuyucu için görünmez bir başlık konur (ör. "h3"). */
  heading?: "h2" | "h3" | "h4";
  /** Teklifin geçerlilik süresi dolunca çağrılır (ör. teklifi yeniden almak için). */
  onExpire?: () => void;
}) {
  const t = useTranslations("quote");
  const locale = useLocale();
  const f = useFormat();
  const fmt = (amount: number, currency: string) => f.money(amount, currency);
  // Süresi dolan teklifin expiresAt'i; yeni teklif gelince durum kendiliğinden sıfırlanır.
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const expired = expiredAt === quote.expiresAt;
  useEffect(() => {
    const ms = Math.max(0, new Date(quote.expiresAt).getTime() - Date.now());
    // setTimeout üst sınırını (~24,8 gün) aşan ya da geçersiz süre için zamanlayıcı kurulmaz.
    if (!Number.isFinite(ms) || ms > 2_147_483_647) return;
    const timer = setTimeout(() => {
      setExpiredAt(quote.expiresAt);
      onExpire?.();
    }, ms);
    return () => clearTimeout(timer);
  }, [quote.expiresAt, onExpire]);
  // Oran Intl ile yerel biçimde ("%8,5" / "8.5%"); ICU'ya hazır metin verilir.
  const pct = (bps: number) =>
    f.number(bps / 10_000, { style: "percent", maximumFractionDigits: 2 });
  const rate = (bps: number | undefined) =>
    bps !== undefined ? t("rate", { rate: pct(bps) }) : "";
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
  const chargeLabel = (x: { code: string; label: string }) =>
    KNOWN_CHARGE_CODES.has(x.code) ? t(`taxKind.${x.code}`) : x.label;
  // Hariç yüzde vergilerin matrahı dahil vergilerden (ör. KDV) arındırılmış tutardır
  // (src/lib/pricing/tax.ts); oranın yanında taban açıkça yazılır.
  const included = quote.taxes.filter((x) => x.inclusive && x.amount > 0);
  const excluded =
    included.length > 0
      ? new Intl.ListFormat(f.locale, { type: "conjunction" }).format(included.map(chargeLabel))
      : null;
  const addOnRate = (bps: number | undefined) =>
    bps !== undefined && excluded ? t("rateNet", { rate: pct(bps), excluded }) : rate(bps);
  const uniform = quote.nights.every((x) => x.amount === quote.nights[0].amount);
  const Heading = heading;
  return (
    <div className="space-y-2 text-sm">
      {Heading && <Heading className="sr-only">{t("priceDetails")}</Heading>}
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
            <dt>{chargeLabel(f)}</dt>
            <dd>{fmt(f.amount, quote.currency)}</dd>
          </div>
        ))}
        {quote.taxes
          .filter((x) => !x.inclusive)
          .map((x) => (
            <div key={x.code} className="flex justify-between text-gray-600">
              <dt>
                {chargeLabel(x)}
                {addOnRate(x.rateBps)}
              </dt>
              <dd>{fmt(x.amount, quote.currency)}</dd>
            </div>
          ))}
        <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-semibold text-gray-900">
          <dt>{t("total")}</dt>
          <dd>
            {/* Omnibus: üstü çizili referans yalnız son N günün en düşüğü toplamdan yüksekse.
                Referans, tahsil edilecek toplamın KARDEŞİ; quote-total yalnız toplamı sarar
                (kart toplamı = PDP toplamı karşılaştırması, v3#9). */}
            {strike && (
              <>
                <span className="sr-only">{t("previousPrice")}</span>
                <s className="mr-2 text-sm font-normal text-gray-500" data-testid="quote-reference">
                  {fmt(reference!, quote.currency)}
                </s>
              </>
            )}
            <span data-testid="quote-total">{fmt(quote.total, quote.currency)}</span>
          </dd>
        </div>
      </dl>
      {!uniform && (
        <details className="text-xs text-gray-600" data-testid="quote-nights">
          <summary className={`cursor-pointer underline ${focusRing}`}>{t("nightsShow")}</summary>
          <ul className="mt-1 space-y-0.5">
            {quote.nights.map((x) => (
              <li key={x.date} className="flex justify-between">
                <span>{f.date(x.date, "medium")}</span>
                <span>{fmt(x.amount, quote.currency)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
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
              label: chargeLabel(x),
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
      <p className="text-xs text-gray-500" data-testid="quote-valid-until">
        {expired ? t("expired") : t("validUntil", { time: f.time(quote.expiresAt) })}
      </p>
    </div>
  );
}
