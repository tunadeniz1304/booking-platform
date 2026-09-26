import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type https from "node:https";

/**
 * v4#11 — iCal SSRF ve yavaş besleme: IPv4 gömen IPv6 biçimleri (NAT64, 6to4),
 * TEST-NET aralıkları; toplam süre sınırı (slow-drip); yoklamada eşzamanlılık sınırı.
 * Ağa çıkılmaz: `https.request` sahte, Prisma mock.
 */

const prismaMock = vi.hoisted(() => ({
  icalSubscription: {
    findMany: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { assertFetchableUrl, isPrivateAddress, parseIpv6 } from "@/lib/security/url";
import {
  createIcalFetcher,
  pollDueSubscriptions,
  type FetchOutcome,
  type IcalFetcher,
} from "@/lib/channel/ical-poller";
import { resetConfigForTests } from "@/lib/config/app-config";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ICAL_POLL_CONCURRENCY;
  resetConfigForTests();
});

describe("regression: v4#11 SSRF: gömülü IPv4 ve ayrılmış aralıklar", () => {
  it.each([
    "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254 (bulut metadata)
    "64:ff9b::10.0.0.1", // NAT64 noktalı biçim
    "64:ff9b:1::1", // yerel NAT64 önekı
    "2002:7f00:1::", // 6to4 → 127.0.0.1
    "2002:c0a8:0101::1", // 6to4 → 192.168.1.1
    "2002:0a00:0001::", // 6to4 → 10.0.0.1
    "::ffff:7f00:1", // v4-mapped (onaltılık)
    "::ffff:127.0.0.1",
    "::127.0.0.1", // v4-compatible
    "2001:0:4136:e378::1", // Teredo
    "2001:db8::1", // dokümantasyon
    "100::1", // discard
    "fec0::1",
    "fd00::1",
    "fe80::1%eth0",
    "::",
    "::1",
    "192.0.2.10", // TEST-NET-1
    "198.51.100.7", // TEST-NET-2
    "203.0.113.99", // TEST-NET-3
    "192.88.99.1", // 6to4 relay
    "not-an-ip",
    "1:2:3", // bozuk v6
  ])("%s özel/ayrılmış sayılır", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "64:ff9b::808:808", "2002:0808:0808::1", "2606:4700:4700::1111"])(
    "%s genel adres",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  it("IPv6 çözümleyici: kısaltma, noktalı v4, geçersiz biçimler", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("64:ff9b::1.2.3.4")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x102, 0x304]);
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6("1::2::3")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:8::")).toBeNull();
    expect(parseIpv6("12345::")).toBeNull();
    expect(parseIpv6("::1.2.3.999")).toBeNull();
    expect(parseIpv6("1.2.3.4")).toBeNull();
  });

  it("assertFetchableUrl IP-literal NAT64/6to4/TEST-NET URL'lerini reddeder", () => {
    for (const url of [
      "https://[64:ff9b::7f00:1]/cal.ics",
      "https://[2002:a9fe:a9fe::]/cal.ics",
      "https://[::ffff:127.0.0.1]/cal.ics",
      "https://203.0.113.5/cal.ics",
      "https://2130706433/cal.ics", // 127.0.0.1 ondalık
    ]) {
      expect(() => assertFetchableUrl(url), url).toThrow(/İç ağ/);
    }
    expect(assertFetchableUrl("https://calendar.example.com/a.ics").hostname).toBe(
      "calendar.example.com"
    );
  });
});

/** Veriyi sonsuza dek damla damla gönderen sahte https.request. */
function slowDripRequest(intervalMs: number) {
  const state = { destroyed: null as Error | null, timer: null as NodeJS.Timeout | null };
  const request = ((_url: unknown, _opts: unknown, onResponse: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (e?: Error) => void;
    };
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      resume: () => undefined,
    });
    req.destroy = (e?: Error) => {
      if (state.timer) clearInterval(state.timer);
      state.destroyed = e ?? new Error("destroyed");
      req.emit("error", state.destroyed);
      req.emit("close");
    };
    req.end = () => {
      onResponse(res);
      state.timer = setInterval(() => res.emit("data", Buffer.from("B")), intervalMs);
    };
    return req;
  }) as unknown as typeof https.request;
  return { request, state };
}

describe("regression: v4#11 iCal toplam süre sınırı (slow-drip)", () => {
  it("boşta kalmayan ama bitmeyen gövde deadline'da kesilir", async () => {
    const { request, state } = slowDripRequest(5);
    const fetcher = createIcalFetcher({ request, deadlineMs: 60 });
    const started = Date.now();
    await expect(fetcher("https://calendar.example.com/a.ics", {})).rejects.toThrow(
      /toplam süre sınırını aştı/
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(state.destroyed).not.toBeNull();
  });

  it("SSRF kontrolü istekten önce: iç adres hiç istenmez", async () => {
    const request = vi.fn() as unknown as typeof https.request;
    const fetcher = createIcalFetcher({ request, deadlineMs: 1_000 });
    await expect(async () => fetcher("https://[64:ff9b::a00:1]/x.ics", {})).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("regression: v4#11 pollDueSubscriptions eşzamanlı (ICAL_POLL_CONCURRENCY)", () => {
  it("tur, sınır kadar paralel yoklar; tek yavaş besleme turu kilitlemez", async () => {
    process.env.ICAL_POLL_CONCURRENCY = "3";
    resetConfigForTests();
    const subs = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`,
      roomTypeId: "r1",
      source: `src${i}`,
      url: `https://cal${i}.example.com/a.ics`,
      etag: null,
      lastModified: null,
    }));
    prismaMock.icalSubscription.findMany.mockResolvedValueOnce(subs as never);
    let active = 0;
    let peak = 0;
    const fetcher: IcalFetcher = async (url): Promise<FetchOutcome> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, url.includes("cal0") ? 40 : 5));
      active -= 1;
      if (url.includes("cal6")) throw new Error("boom");
      return { status: "not_modified" };
    };
    const summary = await pollDueSubscriptions(fetcher);
    expect(summary).toEqual({ polled: 7, ok: 0, notModified: 6, failed: 1 });
    expect(peak).toBe(3);
    expect(prismaMock.icalSubscription.update).toHaveBeenCalledTimes(7);
  });
});
