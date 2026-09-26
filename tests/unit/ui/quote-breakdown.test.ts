import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import QuoteBreakdown from "@/components/booking/QuoteBreakdown";
import type { QuoteView } from "@/components/booking/useQuote";
import quoteTr from "../../../messages/tr/quote.json";

function render(quote: QuoteView): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: "tr",
      messages: { quote: quoteTr },
      timeZone: "UTC",
      children: createElement(QuoteBreakdown, { quote }),
    })
  );
}

const base: QuoteView = {
  quoteId: "q",
  propertyId: "p",
  roomId: "r",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  guests: 1,
  currency: "TRY",
  nights: [
    { date: "2026-10-10", amount: 100_000 },
    { date: "2026-10-11", amount: 100_000 },
  ],
  subtotal: 200_000,
  fees: [],
  taxes: [],
  total: 180_000,
  expiresAt: "2026-10-01T00:00:00Z",
  discounts: [
    {
      promotionId: "a",
      name: "Erken rezervasyon",
      type: "EARLY_BIRD",
      couponCode: null,
      amount: 20_000,
    },
  ],
  discountTotal: 20_000,
  lowestPrice30dMinor: 190_000,
  omnibusDays: 30,
};

describe("P1-8 QuoteBreakdown: promosyon satırı + Omnibus referansı", () => {
  it("indirim satırı ve üstü çizili referans = son 30 günün en düşüğü", () => {
    const html = render(base);
    expect(html).toContain('data-testid="quote-discount"');
    expect(html).toContain("Erken rezervasyon");
    expect(html).toMatch(/<s [^>]*data-testid="quote-reference"[^>]*>[^<]*1\.900,00/);
    expect(html).toContain("Son 30 günün en düşük fiyatı");
  });

  it("referans toplamdan yüksek değilse üstü çizilmez; indirim yoksa etiket yok", () => {
    expect(render({ ...base, lowestPrice30dMinor: 170_000 })).not.toContain("quote-reference");
    const plain = render({ ...base, discounts: [], discountTotal: 0, total: 200_000 });
    expect(plain).not.toContain("quote-lowest-30d");
    expect(plain).not.toContain("quote-reference");
  });
});
