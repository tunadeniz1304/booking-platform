import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { TierBadge } from "@/components/account/WalletPanel";
import walletTr from "../../../messages/tr/wallet.json";
import walletEn from "../../../messages/en/wallet.json";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

function render(locale: "tr" | "en", tier: number): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: { wallet: locale === "tr" ? walletTr : walletEn },
        timeZone: "UTC",
      } as unknown as ProviderProps,
      createElement(TierBadge, { tier })
    )
  );
}

describe("P1-7 seviye rozeti", () => {
  it("TR/EN seviye adları ve erişilebilir etiket", () => {
    expect(render("tr", 2)).toContain("Altın seviye");
    expect(render("tr", 2)).toContain('aria-label="Sadakat seviyesi: Altın"');
    expect(render("en", 3)).toContain("Platinum tier");
  });

  it("aralık dışı seviye sınırlanır", () => {
    expect(render("tr", 9)).toContain("Platin seviye");
    expect(render("en", -1)).toContain("Member tier");
  });
});
