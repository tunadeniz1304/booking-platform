import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTests } from "@/lib/config/app-config";
import { FxParseError, parseEcbXml, parseTcmbXml } from "@/lib/fx/sources";
import { chargeAmount, fetchLatestRates, resolveChargeCurrency } from "@/lib/fx/store";
import { money } from "@/lib/money/money";

const TCMB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="25.09.2026" Date="09/25/2026" Bulten_No="2026/180">
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
    <Unit>1</Unit><Isim>ABD DOLARI</Isim>
    <ForexBuying>39.90</ForexBuying><ForexSelling>40.00</ForexSelling>
  </Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR">
    <Unit>1</Unit><ForexSelling>50.00</ForexSelling>
  </Currency>
  <Currency CrossOrder="12" Kod="JPY" CurrencyCode="JPY">
    <Unit>100</Unit><ForexSelling>27.00</ForexSelling>
  </Currency>
</Tarih_Date>`;

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <Cube><Cube time='2026-09-24'>
    <Cube currency='USD' rate='1.25'/>
    <Cube currency='GBP' rate='0.8'/>
    <Cube currency='TRY' rate='50'/>
  </Cube></Cube>
</gesmes:Envelope>`;

function res(body: string, status = 200): Response {
  return new Response(body, { status });
}

afterEach(() => {
  delete process.env.FX_SOURCES;
  delete process.env.FX_CHARGE_CURRENCIES;
  resetConfigForTests();
});

describe("kur ayrıştırıcıları", () => {
  it("TCMB: döviz satış kuru → 1 TRY = x; desteklenmeyen birim atlanır", () => {
    const parsed = parseTcmbXml(TCMB_XML);
    expect(parsed.source).toBe("tcmb");
    expect(parsed.asOf).toBe("2026-09-25");
    expect(parsed.rates.TRY).toBe(1);
    expect(parsed.rates.USD).toBeCloseTo(0.025, 10);
    expect(parsed.rates.EUR).toBeCloseTo(0.02, 10);
    expect(parsed).not.toHaveProperty("rates.JPY");
  });

  it("ECB: EUR tabanlı liste TRY tabanına çapraz kurla çevrilir", () => {
    const parsed = parseEcbXml(ECB_XML);
    expect(parsed.asOf).toBe("2026-09-24");
    expect(parsed.rates.EUR).toBeCloseTo(0.02, 10);
    expect(parsed.rates.USD).toBeCloseTo(0.025, 10);
    expect(parsed.rates.GBP).toBeCloseTo(0.016, 10);
  });

  it("bozuk içerik FxParseError", () => {
    expect(() => parseTcmbXml("<html/>")).toThrow(FxParseError);
    expect(() =>
      parseEcbXml("<Cube time='2026-09-24'><Cube currency='USD' rate='1.2'/></Cube>")
    ).toThrow(/TRY/);
  });
});

describe("fetchLatestRates", () => {
  it("ilk kaynak başarısız → ikinci kaynak", async () => {
    process.env.FX_SOURCES = "tcmb,ecb";
    resetConfigForTests();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ağ yok"))
      .mockResolvedValueOnce(res(ECB_XML));
    const parsed = await fetchLatestRates(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(parsed?.source).toBe("ecb");
  });

  it("HTTP hatası ve bozuk gövde → sıradaki kaynak; hepsi başarısız → null", async () => {
    process.env.FX_SOURCES = "tcmb,ecb";
    resetConfigForTests();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res("", 503))
      .mockResolvedValueOnce(res("<bozuk/>"));
    expect(await fetchLatestRates(fetchImpl)).toBeNull();
  });

  it("kaynak listesi boş → ağ çağrısı yok", async () => {
    process.env.FX_SOURCES = "none";
    resetConfigForTests();
    const fetchImpl = vi.fn();
    expect(await fetchLatestRates(fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("TCMB başarılı → ilk kaynak kullanılır", async () => {
    process.env.FX_SOURCES = "tcmb,ecb";
    resetConfigForTests();
    const fetchImpl = vi.fn().mockResolvedValue(res(TCMB_XML));
    expect((await fetchLatestRates(fetchImpl))?.source).toBe("tcmb");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("tahsilat para birimi", () => {
  it("varsayılan: tesisin para birimi; aynı birim istenirse de öyle", () => {
    expect(resolveChargeCurrency("TRY")).toBe("TRY");
    expect(resolveChargeCurrency("TRY", "try")).toBe("TRY");
  });

  it("izinli olmayan birim reddedilir, izinli olan kabul edilir", () => {
    expect(() => resolveChargeCurrency("TRY", "USD")).toThrow(/tahsilat/);
    process.env.FX_CHARGE_CURRENCIES = "USD, eur";
    resetConfigForTests();
    expect(resolveChargeCurrency("TRY", "usd")).toBe("USD");
    expect(resolveChargeCurrency("TRY", "EUR")).toBe("EUR");
  });

  it("chargeAmount verilen tabloyla çevirir ve tablo kimliğini taşır", () => {
    const table = {
      id: "fx1",
      base: "TRY" as const,
      asOf: "2026-09-25",
      rates: { TRY: 1, USD: 0.025 },
      source: "tcmb" as const,
      stale: false,
    };
    expect(chargeAmount(money(100_000, "TRY"), "USD", table)).toEqual({
      currency: "USD",
      total: 2_500,
      fxSnapshotId: "fx1",
    });
    expect(chargeAmount(money(100_000, "TRY"), "TRY", table).total).toBe(100_000);
  });
});

describe("fx-refresh işi", () => {
  it("FX_REFRESH_CRON deseniyle UTC'de idempotent scheduler kaydeder", async () => {
    const { scheduleFxRefresh, FX_REFRESH_JOB } = await import("@/worker/jobs/fx-refresh");
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await scheduleFxRefresh({ upsertJobScheduler } as never);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      FX_REFRESH_JOB,
      { pattern: "45 12 * * *", tz: "UTC" },
      expect.objectContaining({ name: FX_REFRESH_JOB })
    );
  });
});
