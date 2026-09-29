import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RnplChargeFailedPayload } from "@/lib/events/events";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/notifications/notifier", () => ({ sendEmail: vi.fn(async () => "sent") }));

import { notifyRnplChargeFailed } from "@/lib/notifications/rnpl-notifications";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications/notifier";

const payload: RnplChargeFailedPayload = {
  scheduleId: "sch1",
  bookingId: "b/1",
  userId: "u1",
  attempt: 2,
  amountMinor: 123450,
  currency: "TRY",
  retryAt: "2026-10-01T00:00:00.000Z",
  cancelAt: "2026-10-03T00:00:00.000Z",
};

const findUnique = () => vi.mocked(prisma.user.findUnique);
type Sent = { dedupeKey: string; userId: string; to: string; content: Record<string, string> };
const lastSent = () => vi.mocked(sendEmail).mock.calls.at(-1)![0] as unknown as Sent;

describe("P1-3 RNPL tahsilat başarısız bildirimi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("kullanıcı yoksa ya da silinmişse e-posta gönderilmez", async () => {
    findUnique().mockResolvedValueOnce(null);
    await expect(notifyRnplChargeFailed(payload)).resolves.toBe("missing");
    findUnique().mockResolvedValueOnce({ id: "u1", deletedAt: new Date() } as never);
    await expect(notifyRnplChargeFailed(payload)).resolves.toBe("missing");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("TR e-postası deneme başına dedupe anahtarı ve rezervasyon bağlantısı içerir", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test//");
    findUnique().mockResolvedValueOnce({
      id: "u1",
      email: "a@example.test",
      locale: "tr",
      deletedAt: null,
    } as never);
    await expect(notifyRnplChargeFailed(payload)).resolves.toBe("sent");
    const sent = lastSent();
    expect(sent.dedupeKey).toBe("rnpl.charge_failed:sch1:2");
    expect(sent.to).toBe("a@example.test");
    expect(sent.content.subject).toBe("Rezervasyonunuzun ödemesi alınamadı");
    expect(sent.content.text).toContain("Rezervasyon: https://app.example.test/booking/b%2F1");
    expect(sent.content.html).toContain('lang="tr"');
    expect(sent.content.html).toContain('href="https://app.example.test/booking/b%2F1"');
  });

  it("EN yerel ayarında İngilizce metin, env yoksa localhost tabanı kullanılır", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    findUnique().mockResolvedValueOnce({
      id: "u1",
      email: "b@example.test",
      locale: "en",
      deletedAt: null,
    } as never);
    await notifyRnplChargeFailed(payload);
    const { content } = lastSent();
    expect(content.subject).toBe("We could not charge your booking");
    expect(content.text).toContain("We could not charge");
    expect(content.text).toContain("Booking: http://localhost:3000/booking/b%2F1");
    expect(content.html).toContain('lang="en"');
  });
});
