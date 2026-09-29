import { describe, expect, it } from "vitest";
import { createMemorySupportRepo, sampleSupportBooking } from "@/lib/support/memory-repo";
import type { NewSupportTicket, PropertyView } from "@/lib/support/repo";

/** Bellek-içi destek deposu: sahiplik filtresi, en yakın rezervasyon, mülk arama, bilet id'leri. */

describe("createMemorySupportRepo", () => {
  const early = sampleSupportBooking({
    id: "bk_early",
    checkIn: new Date("2026-10-05T00:00:00Z"),
  });
  const late = sampleSupportBooking({
    id: "bk_late",
    checkIn: new Date("2026-12-01T00:00:00Z"),
  });
  const foreign = sampleSupportBooking({
    id: "bk_foreign",
    userId: "u_other",
    checkIn: new Date("2026-01-01T00:00:00Z"),
    property: { ...sampleSupportBooking().property, id: "pr_other" },
  });

  it("id verilince yalnız kullanıcının kendi rezervasyonunu döndürür", async () => {
    const repo = createMemorySupportRepo([late, early, foreign]);

    expect((await repo.findBookingForUser("u_guest", "bk_late"))?.id).toBe("bk_late");
    expect(await repo.findBookingForUser("u_guest", "bk_foreign")).toBeNull();
    expect(await repo.findBookingForUser("u_guest", "bk_missing")).toBeNull();
  });

  it("id verilmezse en erken girişli kendi rezervasyonunu seçer", async () => {
    const repo = createMemorySupportRepo([late, foreign, early]);

    expect((await repo.findBookingForUser("u_guest"))?.id).toBe("bk_early");
    expect(await repo.findBookingForUser("u_nobody")).toBeNull();
  });

  it("mülkü önce açık listeden, sonra rezervasyonlardan bulur; yoksa null", async () => {
    const standalone: PropertyView = {
      id: "pr_standalone",
      title: "Tek Başına",
      timeZone: "Europe/Istanbul",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      policy: null,
    };
    const repo = createMemorySupportRepo([early, foreign], [standalone]);

    expect(await repo.findProperty("pr_standalone")).toBe(standalone);
    expect((await repo.findProperty("pr_other"))?.id).toBe("pr_other");
    expect((await repo.findProperty("pr_demo1"))?.title).toBe("Moda Sahil Evi");
    expect(await repo.findProperty("pr_missing")).toBeNull();
  });

  it("biletleri sıralı id'lerle kaydeder", async () => {
    const repo = createMemorySupportRepo([]);
    const input: NewSupportTicket = {
      userId: "u_guest",
      bookingId: "bk_early",
      reason: "USER_REQUEST",
      intent: "human",
      confidence: 0.9,
      summary: "Temsilci istiyor",
      locale: "tr",
    };

    expect(await repo.createTicket(input)).toEqual({ id: "tkt_0001" });
    expect(await repo.createTicket(input)).toEqual({ id: "tkt_0002" });
    expect(repo.tickets.map((t) => t.id)).toEqual(["tkt_0001", "tkt_0002"]);
    expect(repo.tickets[0]).toEqual({ ...input, id: "tkt_0001" });
  });
});
