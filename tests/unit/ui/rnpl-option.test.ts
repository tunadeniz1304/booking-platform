import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { RnplChoice, type RnplOffer } from "@/components/booking/RnplOption";
import RnplPlanCard, { type RnplPlan } from "@/components/booking/RnplPlan";
import paymentTr from "../../../messages/tr/payment.json";
import paymentEn from "../../../messages/en/payment.json";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const offer: RnplOffer = {
  available: true,
  dueTodayMinor: 0,
  amountMinor: 250_000,
  currency: "TRY",
  dueAt: "2026-10-20T12:00:00.000Z",
  freeCancellationUntil: "2026-10-22T12:00:00.000Z",
};

function render(o: RnplOffer | null, selected: boolean, locale: "tr" | "en" = "tr"): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: { payment: locale === "tr" ? paymentTr : paymentEn },
        timeZone: "UTC",
      } as unknown as ProviderProps,
      createElement(RnplChoice, { offer: o, selected, onChange: () => undefined })
    )
  );
}

describe("P1-3 RNPL checkout seçeneği", () => {
  it("bugün 0 ve vade tarihinde toplamı gösterir", () => {
    const html = render(offer, false);
    expect(html).toContain('data-testid="rnpl-option"');
    expect(html).toMatch(/bugün ₺?0/);
    expect(html).toContain("2.500");
    expect(html).not.toContain("rnpl-timeline");
  });

  it("seçilince iptal zaman çizelgesi görünür (en)", () => {
    const html = render(offer, true, "en");
    expect(html).toContain('data-testid="rnpl-timeline"');
    expect(html).toContain("Free cancellation until");
  });

  it("uygun değilse (ör. RNPL_ENABLED=false → DISABLED) hiçbir şey çizilmez", () => {
    expect(render({ ...offer, available: false, reason: "DISABLED" }, false)).toBe("");
    expect(render(null, false)).toBe("");
  });
});

function renderPlan(plan: RnplPlan | null, locale: "tr" | "en" = "tr"): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: { payment: locale === "tr" ? paymentTr : paymentEn },
        timeZone: "UTC",
      } as unknown as ProviderProps,
      createElement(RnplPlanCard, { plan })
    )
  );
}

const plan: RnplPlan = {
  status: "SCHEDULED",
  paidTodayMinor: 0,
  amountMinor: 250_000,
  currency: "TRY",
  dueAt: "2026-10-20T12:00:00.000Z",
  freeCancellationUntil: "2026-10-22T12:00:00.000Z",
  nextAttemptAt: null,
  capturedAt: null,
};

describe("P2-1 rezervasyon detayında RNPL planı", () => {
  it("bugün 0, vade tarihinde toplam ve iptal zaman çizelgesi", () => {
    const html = renderPlan(plan);
    expect(html).toContain('data-testid="rnpl-plan"');
    expect(html).toMatch(/Bugün ₺?0/);
    expect(html).toContain("2.500");
    expect(html).toContain("20 Ekim 2026");
    expect(html).toContain('data-testid="rnpl-plan-timeline"');
    expect(html).toContain("Planlandı");
  });

  it("başarısız tahsilat: durum ve sonraki deneme (en)", () => {
    const html = renderPlan(
      { ...plan, status: "RETRYING", nextAttemptAt: "2026-10-20T18:00:00.000Z" },
      "en"
    );
    expect(html).toContain("Retrying");
    expect(html).toContain("next attempt");
  });

  it("plan yoksa hiçbir şey çizilmez", () => {
    expect(renderPlan(null)).toBe("");
  });
});
