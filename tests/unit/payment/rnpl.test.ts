import { describe, expect, it } from "vitest";
import { DEFAULT_POLICIES } from "@/lib/booking/cancellation";
import { freeCancellationDeadline, rnplTerms } from "@/lib/payment/rnpl-terms";
import { MockPsp } from "@/lib/payment/mock-psp";
import { withChaos } from "@/lib/payment/chaos-psp";
import { money } from "@/lib/money/money";
import type { IsoDate } from "@/lib/time/nights";

const clock = { timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" };
const CFG = { RNPL_ENABLED: true, RNPL_CHARGE_DAYS_BEFORE_DEADLINE: 2, RNPL_MIN_LEAD_HOURS: 24 };
const NOW = new Date("2026-09-28T12:00:00Z");
const checkIn = "2026-10-20" as IsoDate;

describe("P1-3 RNPL uygunluk ve vade", () => {
  it("ücretsiz iptal bitişi = girişten %100 basamağı kadar önce (MODERATE 120 sa)", () => {
    expect(freeCancellationDeadline(DEFAULT_POLICIES.MODERATE, checkIn, clock)?.toISOString()).toBe(
      "2026-10-15T14:00:00.000Z"
    );
    expect(freeCancellationDeadline(DEFAULT_POLICIES.NON_REFUNDABLE, checkIn, clock)).toBeNull();
  });

  it("vade = bitişten RNPL_CHARGE_DAYS_BEFORE_DEADLINE gün önce", () => {
    const t = rnplTerms(
      { refundable: true, snapshot: DEFAULT_POLICIES.MODERATE, checkIn, clock },
      NOW,
      CFG
    );
    expect(t).toMatchObject({ available: true });
    if (t.available) expect(t.dueAt.toISOString()).toBe("2026-10-13T14:00:00.000Z");
  });

  it.each([
    [{ ...CFG, RNPL_ENABLED: false }, true, "MODERATE", checkIn, "DISABLED"],
    [CFG, false, "MODERATE", checkIn, "NON_REFUNDABLE"],
    [CFG, true, "NON_REFUNDABLE", checkIn, "NON_REFUNDABLE"],
    // Vade 24 saatten yakın → sunulmaz.
    [CFG, true, "MODERATE", "2026-10-05", "TOO_LATE"],
  ] as const)("uygun değil: %# → %s", (cfg, refundable, kind, day, reason) => {
    const t = rnplTerms(
      { refundable, snapshot: DEFAULT_POLICIES[kind], checkIn: day as IsoDate, clock },
      NOW,
      cfg
    );
    expect(t).toEqual({ available: false, reason });
  });
});

describe("MockPsp kart kaydı + off-session tahsilat", () => {
  const psp = new MockPsp();

  it("kaydeder, aynı anahtarla deterministik tahsil eder", async () => {
    const setup = await psp.setupCard({
      cardToken: "tok_mock_ok_424242_4242",
      idempotencyKey: "k",
    });
    expect(setup.status).toBe("succeeded");
    if (setup.status !== "succeeded") return;
    const input = {
      amount: money(10_000, "TRY"),
      paymentMethodRef: setup.paymentMethodRef,
      idempotencyKey: "rnpl:s:1",
    };
    const a = await psp.chargeSaved(input);
    const b = await psp.chargeSaved(input);
    expect(a).toEqual(b);
    expect(a.status).toBe("captured");
  });

  it("ret ve 3DS kartı kaydedilmez", async () => {
    await expect(
      psp.setupCard({ cardToken: "tok_mock_decline_400000_0002", idempotencyKey: "k" })
    ).resolves.toEqual({ status: "declined", declineCode: "card_declined" });
    await expect(
      psp.setupCard({ cardToken: "tok_mock_3ds_400000_3220", idempotencyKey: "k" })
    ).resolves.toEqual({ status: "declined", declineCode: "authentication_required" });
  });

  it("kaos sarmalayıcısı yeni metotları korur ve bozabilir", async () => {
    const chaotic = withChaos(psp, {
      latencyMs: 0,
      jitterMs: 0,
      failureRate: 1,
      failureOps: new Set(["chargeSaved"]),
    });
    await expect(
      chaotic.chargeSaved!({
        amount: money(1, "TRY"),
        paymentMethodRef: "pm_mock_x",
        idempotencyKey: "x",
      })
    ).rejects.toMatchObject({ code: "psp_unavailable" });
    expect(chaotic.setupCard).toBeTypeOf("function");
  });
});
