import { describe, it, expect } from "vitest";
import {
  MockTrMinistryRegistry,
  MockEuStrRegistry,
  registryForCountry,
  verifyLicense,
  euCountryCode,
  isLicenseFormatValid,
} from "@/lib/compliance/license-registry";
import {
  SDEP_HEADER,
  sdepRowSchema,
  monthRange,
  nightsInRange,
  toSdepCsv,
  previousPeriod,
} from "@/lib/compliance/sdep";

describe("P1-10 lisans kayıtları (mock)", () => {
  const tr = new MockTrMinistryRegistry();
  const eu = new MockEuStrRegistry();
  it("TR (7565): geçerli → VERIFIED, sıfır sıra → NOT_FOUND, bozuk → FORMAT_INVALID", async () => {
    expect(await tr.verify("34-12345")).toMatchObject({ status: "VERIFIED", reason: "OK" });
    expect(await tr.verify("34-00000")).toMatchObject({
      status: "REJECTED",
      reason: "NOT_FOUND",
    });
    expect(await tr.verify("ABC")).toMatchObject({
      status: "REJECTED",
      reason: "FORMAT_INVALID",
    });
  });
  it("AB STR (2024/1028): ülke öneki, format ve kayıt kontrolü", async () => {
    expect(await eu.verify("FR-75056ABC123", "FR")).toMatchObject({ status: "VERIFIED" });
    expect(await eu.verify("FR-75056ABC123", "DE")).toMatchObject({ reason: "COUNTRY_MISMATCH" });
    expect(await eu.verify("FR-000000", "FR")).toMatchObject({ reason: "NOT_FOUND" });
    expect(await eu.verify("34-12345", "FR")).toMatchObject({ reason: "FORMAT_INVALID" });
  });
  it("ülkeye göre kayıt seçimi (ISO kodu, İngilizce ve Türkçe ad)", async () => {
    expect(euCountryCode("France")).toBe("FR");
    expect(euCountryCode("Almanya")).toBe("DE");
    expect(euCountryCode("Türkiye")).toBeNull();
    expect(registryForCountry("Türkiye").id).toBe(tr.id);
    expect(registryForCountry("FR").id).toBe(eu.id);
    expect((await verifyLicense("34-12345", "France")).status).toBe("REJECTED");
    expect((await verifyLicense("34-12345", "Türkiye")).status).toBe("VERIFIED");
  });
  it("format ön kontrolü iki biçimi de kabul eder", () => {
    expect(isLicenseFormatValid("34-12345")).toBe(true);
    expect(isLicenseFormatValid("NL-ABC12345")).toBe(true);
    expect(isLicenseFormatValid("hello")).toBe(false);
  });
});

describe("P1-10 SDEP dışa aktarım şeması", () => {
  it("başlık sabit ve şema alanlarıyla birebir", () => {
    expect([...SDEP_HEADER]).toEqual(Object.keys(sdepRowSchema.shape));
  });
  it("dönem aralığı ve ay sınırında gece hesabı", () => {
    const { start, end } = monthRange("2026-02");
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(nightsInRange(d("2026-01-30"), d("2026-02-03"), start, end)).toBe(2);
    expect(nightsInRange(d("2026-02-27"), d("2026-03-04"), start, end)).toBe(2);
    expect(nightsInRange(d("2026-03-01"), d("2026-03-04"), start, end)).toBe(0);
    expect(() => monthRange("2026-13")).toThrow();
    expect(previousPeriod(new Date("2026-01-15T00:00:00Z"))).toBe("2025-12");
  });
  it("CSV: şemaya uyan satırlar, kaçış ve formül enjeksiyonu koruması", () => {
    const row = {
      period: "2026-08",
      registration_number: "34-12345",
      country: "Türkiye",
      city: '=HYPERLINK("x")',
      stays: 2,
      nights: 5,
      guests: 4,
    };
    expect(sdepRowSchema.parse(row)).toEqual(row);
    const csv = toSdepCsv([row]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(SDEP_HEADER.join(","));
    expect(lines[1]).toBe(`2026-08,34-12345,Türkiye,"'=HYPERLINK(""x"")",2,5,4`);
    expect(sdepRowSchema.safeParse({ ...row, nights: 0 }).success).toBe(false);
  });
});
