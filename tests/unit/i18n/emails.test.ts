import { describe, expect, it } from "vitest";
import {
  authLinkEmail,
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingExpiredEmail,
  emailLocale,
  priceDropEmail,
  ttlLabel,
} from "@/lib/notifications/templates";

const booking = {
  guestName: "Ayşe",
  propertyTitle: "Boğaz Evi",
  city: "İstanbul",
  checkIn: "2026-09-24",
  checkOut: "2026-09-27",
  bookingId: "bk_1",
};

describe("iki dilli e-posta şablonları (P1-12)", () => {
  it("varsayılan Türkçe metin değişmez", () => {
    const mail = bookingConfirmedEmail({ ...booking, totalMinor: 123450, currency: "TRY" });
    expect(mail.subject).toBe("Rezervasyonunuz onaylandı — Boğaz Evi");
    expect(mail.text).toContain("Giriş: 24 Eylül 2026 · Çıkış: 27 Eylül 2026");
    expect(mail.html).toContain('<html lang="tr">');
  });

  it("İngilizce şablon İngilizce metin ve en-US biçimi kullanır", () => {
    const mail = bookingConfirmedEmail({ ...booking, totalMinor: 150000, currency: "EUR" }, "en");
    expect(mail.subject).toBe("Your booking is confirmed — Boğaz Evi");
    expect(mail.text).toContain("Check-in: September 24, 2026");
    expect(mail.text).toContain("€1,500.00");
    expect(mail.html).toContain('<html lang="en">');
  });

  it("iptal/süre dolumu/fiyat düşüşü iki dilde üretilir", () => {
    for (const locale of ["tr", "en"] as const) {
      const c = bookingCancelledEmail({ ...booking, refundMinor: 0, currency: "TRY" }, locale);
      const e = bookingExpiredEmail(booking, locale);
      const p = priceDropEmail(
        {
          name: "A",
          propertyTitle: "X",
          roomName: "Y",
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          currency: "TRY",
          previousMinor: 200000,
          currentMinor: 150000,
          omnibusDays: 30,
          link: "http://x",
        },
        locale
      );
      for (const m of [c, e, p]) expect(m.subject.length).toBeGreaterThan(0);
    }
    expect(bookingExpiredEmail(booking, "en").subject).toMatch(/^Payment window expired/);
  });

  it("doğrulama bağlantısı süresi dile göre yazılır; bilinmeyen dil Türkçeye düşer", () => {
    expect(ttlLabel("tr", "hours", 24)).toBe("24 saat");
    expect(ttlLabel("en", "minutes", 1)).toBe("1 minute");
    expect(ttlLabel("en", "hours", 24)).toBe("24 hours");
    const m = authLinkEmail(
      { kind: "PASSWORD_RESET", name: "Bob", link: "http://l", ttlLabel: "30 minutes" },
      "en"
    );
    expect(m.subject).toBe("Your password reset link");
    expect(emailLocale("de")).toBe("tr");
    expect(emailLocale(null)).toBe("tr");
    expect(emailLocale("en")).toBe("en");
  });
});
