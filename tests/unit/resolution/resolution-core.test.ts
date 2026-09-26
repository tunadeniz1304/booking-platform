// P1-5 çekirdek (DB'siz): kanıt temizliği (EXIF/GPS), MIME sniff + sınırlar, depozito zaman
// penceresi, iade kurtarma bölüşümü (property), jurnal şablonları, PSP depozito provizyonu,
// Stripe itiraz eşlemesi.
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import sharp from "sharp";
import Stripe from "stripe";
import { sanitizeEvidence, sniffType } from "@/lib/resolution/evidence";
import { depositAuthValid, depositWindow } from "@/lib/resolution/deposit";
import { closedStatusFor } from "@/lib/resolution/disputes";
import { assertBalanced, depositCaptured, refundIssued, splitHostRecovery } from "@/lib/ledger";
import { MockPsp, parseMockHoldRef } from "@/lib/payment/mock-psp";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { mapStripeEvent, verifyStripeWebhook } from "@/lib/payment/stripe-webhook";
import { PaymentProviderError } from "@/lib/payment/provider";
import { verifyWebhook } from "@/lib/payment/webhook";
import { money } from "@/lib/money/money";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";
import { mockDisputeWebhook } from "@/lib/resolution/disputes";
import { gpsEntryCount, jpegWithGps } from "../../helpers/exif";
import { intent, stripeFake } from "../../support/stripe-fake";

afterEach(() => {
  delete process.env.CLAIM_EVIDENCE_MAX_PIXELS;
  delete process.env.CLAIM_EVIDENCE_PDF_MAX_BYTES;
  resetConfigForTests();
});

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");

describe("P1-5 kanıt temizliği", () => {
  it("GPS'li JPEG → WebP'ye yeniden kodlanır; EXIF/GPS dahil metadata kalmaz", async () => {
    const input = await jpegWithGps();
    const before = await sharp(input).metadata();
    expect(gpsEntryCount(before.exif)).toBeGreaterThan(0);

    const out = await sanitizeEvidence(input);
    expect(out.contentType).toBe("image/webp");
    expect(sniffType(out.data)).toBe("webp");
    const after = await sharp(out.data).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(gpsEntryCount(after.exif)).toBe(0);
    expect(out.data.includes(Buffer.from("TestCam"))).toBe(false);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect([out.width, out.height]).toEqual([96, 64]);
  });

  it("tür imzadan belirlenir: metin/HTML/uzantı hilesi reddedilir; PDF yalnız imza + sonla", async () => {
    await expect(sanitizeEvidence(Buffer.from("<svg onload=alert(1)>"))).rejects.toThrow(
      /Desteklenmeyen/
    );
    await expect(sanitizeEvidence(Buffer.alloc(0))).rejects.toThrow(/Boş/);
    // JPEG imzası ama bozuk gövde.
    await expect(
      sanitizeEvidence(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]))
    ).rejects.toThrow(/okunamadı|işlenemedi/);
    const pdf = await sanitizeEvidence(PDF);
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.data.equals(PDF)).toBe(true);
    await expect(sanitizeEvidence(Buffer.from("%PDF-1.4 kesik"))).rejects.toThrow(/bozuk/);
    process.env.CLAIM_EVIDENCE_PDF_MAX_BYTES = "1024";
    resetConfigForTests();
    await expect(
      sanitizeEvidence(
        Buffer.concat([PDF.subarray(0, 9), Buffer.alloc(2048, 32), Buffer.from("%%EOF")])
      )
    ).rejects.toThrow(/büyük/);
  });

  it("piksel sınırı (sıkıştırma bombası) aşılırsa reddedilir; büyük görsel kenara küçültülür", async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const out = await sanitizeEvidence(big);
    expect(Math.max(out.width!, out.height!)).toBe(getConfig().CLAIM_EVIDENCE_MAX_EDGE_PX);
    process.env.CLAIM_EVIDENCE_MAX_PIXELS = "10000";
    resetConfigForTests();
    await expect(sanitizeEvidence(big)).rejects.toThrow(/piksel|okunamadı/);
  });

  it("sniffType bilinen imzaları tanır", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
    expect(sniffType(png)).toBe("png");
    expect(sniffType(gif)).toBe("gif");
    expect(sniffType(PDF)).toBe("pdf");
    expect(sniffType(Buffer.from("hello"))).toBeNull();
  });
});

describe("P1-5 depozito zaman penceresi", () => {
  it("ön provizyon yerel girişten N saat önce; void yerel çıkış + N gün sonra; provizyon süresi", () => {
    const cfg = getConfig();
    const w = depositWindow(
      { checkIn: new Date("2026-10-10T00:00:00Z"), checkOut: new Date("2026-10-12T00:00:00Z") },
      { timeZone: "Europe/Istanbul", checkInTime: "15:00", checkOutTime: "11:00" }
    );
    // 15:00 İstanbul = 12:00Z; 24 saat önce.
    expect(w.authorizeAfter.toISOString()).toBe(
      new Date(
        Date.UTC(2026, 9, 10, 12) - cfg.DEPOSIT_PREAUTH_HOURS_BEFORE * 3_600_000
      ).toISOString()
    );
    expect(w.voidAfter.toISOString()).toBe(
      new Date(Date.UTC(2026, 9, 12, 8) + cfg.DEPOSIT_HOLD_DAYS * 86_400_000).toISOString()
    );
    const authorizedAt = new Date("2026-10-09T12:00:00Z");
    expect(depositAuthValid({ authorizedAt }, new Date("2026-10-12T00:00:00Z"))).toBe(true);
    expect(
      depositAuthValid(
        { authorizedAt },
        new Date(authorizedAt.getTime() + cfg.DEPOSIT_AUTH_VALID_DAYS * 86_400_000)
      )
    ).toBe(false);
    expect(depositAuthValid({ authorizedAt: null }, new Date())).toBe(false);
  });
});

describe("P1-5 serbest bırakma sonrası iade: kaynak bölüşümü", () => {
  it("önce rezerv, sonra kullanılabilir bakiye, kalan platform; toplam korunur, eksi yok", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: -1_000n, max: 10_000_000n }),
        fc.bigInt({ min: -5_000_000n, max: 10_000_000n }),
        (need, reserve, available) => {
          const s = splitHostRecovery(need, reserve, available);
          expect(s.reserveMinor + s.payableMinor + s.platformCoverMinor).toBe(need);
          expect(s.reserveMinor).toBeGreaterThanOrEqual(0n);
          expect(s.payableMinor).toBeGreaterThanOrEqual(0n);
          expect(s.platformCoverMinor).toBeGreaterThanOrEqual(0n);
          expect(s.reserveMinor <= (reserve > 0n ? reserve : 0n)).toBe(true);
          expect(s.payableMinor <= (available > 0n ? available : 0n)).toBe(true);
          // Platform ancak rezerv + bakiye tükendiyse üstlenir.
          if (s.platformCoverMinor > 0n) {
            expect(s.reserveMinor).toBe(reserve > 0n ? reserve : 0n);
            expect(s.payableMinor).toBe(available > 0n ? available : 0n);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it("refundIssued(released) rezerv + platform karşılığıyla dengeli; depositCaptured dengeli", () => {
    const entry = refundIssued({
      refundRef: "claim:c1",
      bookingId: "b1",
      guestId: "g1",
      currency: "TRY",
      amountMinor: 10_000n,
      taxMinor: 100n,
      from: "released",
      hostId: "h1",
      platformFeeMinor: 1_500n,
      hostReserveMinor: 3_000n,
      platformCoverMinor: 2_000n,
    });
    expect(() => assertBalanced(entry.lines)).not.toThrow();
    const byCode = Object.fromEntries(
      entry.lines.map((l) => [`${l.side}:${l.account.kind}`, l.amountMinor])
    );
    expect(byCode["DEBIT:HOST_RESERVE"]).toBe(3_000n);
    expect(byCode["DEBIT:HOST_PAYABLE"]).toBe(3_400n);
    expect(byCode["DEBIT:PLATFORM_REVENUE"]).toBe(3_500n);
    expect(byCode["CREDIT:PSP_CLEARING"]).toBe(10_000n);
    expect(() =>
      refundIssued({
        refundRef: "x",
        bookingId: "b1",
        guestId: "g1",
        currency: "TRY",
        amountMinor: 100n,
        from: "released",
        hostId: "h1",
        hostReserveMinor: 200n,
      })
    ).toThrow(/aşıyor/);

    const dep = depositCaptured({
      depositId: "d1",
      bookingId: "b1",
      hostId: "h1",
      currency: "TRY",
      amountMinor: 30_000n,
    });
    expect(dep.idempotencyKey).toBe("deposit-captured:d1");
    expect(() => assertBalanced(dep.lines)).not.toThrow();
    expect(dep.lines.map((l) => `${l.side}:${l.account.kind}`).sort()).toEqual([
      "CREDIT:HOST_PAYABLE",
      "DEBIT:PSP_CLEARING",
    ]);
    expect(() =>
      depositCaptured({
        depositId: "d",
        bookingId: "b",
        hostId: "h",
        currency: "TRY",
        amountMinor: 0n,
      })
    ).toThrow();
  });
});

describe("P1-5 PSP depozito provizyonu", () => {
  it("MockPsp: deterministik hold ref; capture ön provizyonu aşamaz; kaynak ret", async () => {
    const psp = new MockPsp();
    const a = await psp.authorizeHold({
      amount: money(30_000, "TRY"),
      sourceProviderRef: "pi_mock_abc",
      idempotencyKey: "deposit:d1",
    });
    const b = await psp.authorizeHold({
      amount: money(30_000, "TRY"),
      sourceProviderRef: "pi_mock_abc",
      idempotencyKey: "deposit:d1",
    });
    expect(a).toEqual(b);
    expect(a.status).toBe("authorized");
    expect(parseMockHoldRef(a.providerRef)).toBe(30_000);
    await expect(psp.capture(a.providerRef, money(30_001, "TRY"))).rejects.toMatchObject({
      code: "amount_too_large",
    });
    await expect(psp.capture(a.providerRef, money(12_000, "TRY"))).resolves.toEqual({
      status: "captured",
    });
    expect(parseMockHoldRef("pi_mock_x")).toBeNull();
    const declined = await psp.authorizeHold({
      amount: money(100, "TRY"),
      sourceProviderRef: "pi_mock_decline_1",
      idempotencyKey: "deposit:d2",
    });
    expect(declined.status).toBe("declined");
    await expect(
      psp.authorizeHold({ amount: money(0, "TRY"), sourceProviderRef: "p", idempotencyKey: "k" })
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it("Stripe: kaynak PI'nin kartı + müşterisiyle off-session manuel capture; kart yoksa hata", async () => {
    const { fetchImpl, calls } = stripeFake((call) => {
      if (call.method === "GET" && call.path === "/v1/payment_intents/pi_src")
        return intent("pi_src", "succeeded", { payment_method: "pm_1", customer: "cus_1" });
      if (call.method === "GET" && call.path === "/v1/payment_intents/pi_nocust")
        return intent("pi_nocust", "succeeded", { payment_method: "pm_1", customer: null });
      if (call.method === "POST" && call.path === "/v1/payment_intents")
        return intent("pi_hold", "requires_capture");
      return undefined;
    });
    const stripe = new StripeProvider("sk_test_x", fetchImpl);
    const res = await stripe.authorizeHold({
      amount: money(30_000, "TRY"),
      sourceProviderRef: "pi_src",
      idempotencyKey: "deposit:d1",
      metadata: { bookingId: "b1" },
    });
    expect(res).toEqual({ status: "authorized", providerRef: "pi_hold" });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.body.get("off_session")).toBe("true");
    expect(create.body.get("capture_method")).toBe("manual");
    expect(create.body.get("customer")).toBe("cus_1");
    expect(create.body.get("payment_method")).toBe("pm_1");
    expect(create.body.get("metadata[purpose]")).toBe("damage_deposit");
    expect(create.idempotencyKey).toBe("deposit:d1");
    await expect(
      stripe.authorizeHold({
        amount: money(1, "TRY"),
        sourceProviderRef: "pi_nocust",
        idempotencyKey: "deposit:d2",
      })
    ).rejects.toMatchObject({ code: "payment_method_not_reusable" });
  });

  it("Stripe: off-session 3DS gerekirse ret sayılır", async () => {
    const { fetchImpl } = stripeFake((call) =>
      call.method === "GET"
        ? intent("pi_src", "succeeded", { payment_method: "pm_1", customer: "cus_1" })
        : intent("pi_hold3ds", "requires_action")
    );
    const res = await new StripeProvider("sk_test_x", fetchImpl).authorizeHold({
      amount: money(500, "TRY"),
      sourceProviderRef: "pi_src",
      idempotencyKey: "deposit:d3",
    });
    expect(res).toMatchObject({ status: "declined", declineCode: "authentication_required" });
  });
});

describe("P1-5 itiraz (chargeback) olayları", () => {
  it("Stripe charge.dispute.* → dispute.* iç olayı (imza doğrulamalı)", () => {
    const secret = "whsec_unit_dispute";
    const event = {
      id: "evt_dp1",
      object: "event",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_1",
          object: "dispute",
          amount: 12_500,
          currency: "try",
          payment_intent: "pi_9",
          status: "needs_response",
          reason: "fraudulent",
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyStripeWebhook(payload, header, secret)).toEqual({
      id: "evt_dp1",
      type: "dispute.created",
      data: {
        providerRef: "pi_9",
        amount: 12_500,
        currency: "TRY",
        disputeId: "dp_1",
        disputeStatus: "needs_response",
        reason: "fraudulent",
      },
    });
    const closed = { ...event, type: "charge.dispute.closed" };
    expect(mapStripeEvent(closed as never)?.type).toBe("dispute.closed");
    const noPi = {
      ...event,
      data: { object: { ...event.data.object, payment_intent: null } },
    };
    expect(mapStripeEvent(noPi as never)).toBeNull();
  });

  it("mock imzalı itiraz olayı doğrulanır; kapanış eşlemesi", () => {
    const { body, headers } = mockDisputeWebhook({
      eventId: "evt_m1",
      type: "dispute.closed",
      providerRef: "pi_mock_1",
      disputeId: "dp_mock_1",
      amountMinor: 1000,
      currency: "TRY",
      status: "lost",
    });
    expect(verifyWebhook(body, headers["x-psp-signature"]).data.disputeStatus).toBe("lost");
    expect(closedStatusFor("won")).toBe("RESOLVED_REJECTED");
    expect(closedStatusFor("lost")).toBe("RESOLVED_APPROVED");
    expect(closedStatusFor("warning_closed")).toBe("CLOSED");
    expect(closedStatusFor(undefined)).toBe("CLOSED");
  });
});
