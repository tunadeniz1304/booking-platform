import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/search", () => ({ invalidatePropertySearchCache: vi.fn() }));

import { checkRateParity, feedToken, parseIcsNights, type ParityRate } from "@/lib/channel/channel";
import { parseIsoDate } from "@/lib/time/nights";
import { assertFetchableUrl, isPrivateAddress } from "@/lib/security/url";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "../../fixtures/ical", name), "utf8");
const TZ = "Europe/Istanbul";

describe("regression: v3#21 iCal fikstürleri (UTC / TZID / tam gün)", () => {
  it("UTC DATE-TIME tesisin yerel gününe çevrilir", () => {
    // 22:00Z = 01:00 İstanbul (ertesi gün); çıkış 12:00 yerel → tek gece.
    expect(parseIcsNights(fixture("utc.ics"), TZ)).toEqual([
      { uid: "utc-1@ota", date: "2027-03-11" },
    ]);
  });

  it("TZID DATE-TIME kaynak saat diliminden tesisin gününe çevrilir", () => {
    const nights = parseIcsNights(fixture("tzid.ics"), TZ).map((n) => n.date);
    expect(nights).toEqual(["2027-04-05", "2027-04-06"]);
  });

  it("tam gün (VALUE=DATE) olaylar takvim günüdür; DTEND yoksa tek gece", () => {
    const nights = parseIcsNights(fixture("allday.ics"), "Asia/Tokyo");
    expect(nights.filter((n) => n.uid === "allday-1@ota").map((n) => n.date)).toEqual([
      "2027-05-01",
      "2027-05-02",
      "2027-05-03",
    ]);
    expect(nights.filter((n) => n.uid === "allday-2@ota").map((n) => n.date)).toEqual([
      "2027-06-01",
    ]);
  });
});

describe("regression: v3#21 akış tokenı sürümlü", () => {
  beforeEach(() => vi.stubEnv("CHANNEL_FEED_SECRET", "k".repeat(40)));
  afterEach(() => vi.unstubAllEnvs());

  it("sürüm 0 eski biçimle aynı; her sürüm farklı token üretir", () => {
    const v0 = feedToken("room-1");
    expect(feedToken("room-1", 0)).toBe(v0);
    expect(feedToken("room-1", 1)).not.toBe(v0);
    expect(feedToken("room-1", 2)).not.toBe(feedToken("room-1", 1));
  });
});

describe("regression: v3#21 SSRF koruması", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("%s özel adres", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])("%s genel adres", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false)
  );

  it("http, kimlik bilgili, localhost ve iç IP-literal URL'ler reddedilir", () => {
    expect(() => assertFetchableUrl("http://example.com/a.ics")).toThrow();
    expect(() => assertFetchableUrl("https://u:p@example.com/a.ics")).toThrow();
    expect(() => assertFetchableUrl("https://localhost/a.ics")).toThrow();
    expect(() => assertFetchableUrl("https://169.254.169.254/latest")).toThrow();
    expect(() => assertFetchableUrl("https://[::1]/a.ics")).toThrow();
    expect(assertFetchableUrl("https://www.airbnb.com/calendar/ical/1.ics").hostname).toBe(
      "www.airbnb.com"
    );
  });
});

describe("P1-9 parite kontrolü yalnızca uyarır", () => {
  const rate = (date: string, amount: number): ParityRate => ({ date: parseIsoDate(date), amount });
  const ours = [
    rate("2027-05-01", 100_000),
    rate("2027-05-02", 100_000),
    rate("2027-05-03", 100_000),
  ];

  it("tolerans dışındaki farklar yönüyle raporlanır, içindekiler sessiz", () => {
    const warnings = checkRateParity(
      ours,
      [
        rate("2027-05-03", 120_000),
        rate("2027-05-01", 90_000),
        rate("2027-05-02", 100_500),
        rate("2027-06-01", 1),
      ],
      100
    );
    expect(warnings).toEqual([
      {
        date: "2027-05-01",
        ours: 100_000,
        theirs: 90_000,
        diffBps: -1000,
        direction: "cheaper_elsewhere",
      },
      {
        date: "2027-05-03",
        ours: 100_000,
        theirs: 120_000,
        diffBps: 2000,
        direction: "pricier_elsewhere",
      },
    ]);
  });

  it("girdileri değiştirmez", () => {
    const copy = structuredClone(ours);
    checkRateParity(ours, [rate("2027-05-01", 1)], 0);
    expect(ours).toEqual(copy);
  });
});
