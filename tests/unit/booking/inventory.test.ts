import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { IsoDate } from "@/lib/time/nights";
import {
  commitHeld,
  holdUnits,
  InventoryUnavailableError,
  releaseForStatus,
  releaseHeld,
  releaseSold,
  remaining,
} from "@/lib/booking/inventory";

/** `$executeRaw` etkilenen satır sayısını döndüren sahte işlem istemcisi. */
function fakeTx(affected: number) {
  const executeRaw = vi.fn(async () => affected);
  return { tx: { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient, executeRaw };
}

const stay = {
  roomTypeId: "rt1",
  checkIn: "2030-01-10" as IsoDate,
  checkOut: "2030-01-13" as IsoDate,
  units: 1,
};

describe("envanter sayaç yardımcıları", () => {
  it("remaining: total − sold − held, negatife düşmez", () => {
    expect(remaining({ total: 3, sold: 1, held: 1 })).toBe(1);
    expect(remaining({ total: 2, sold: 2, held: 0 })).toBe(0);
    expect(remaining({ total: 1, sold: 2, held: 1 })).toBe(0);
  });

  it.each([
    ["holdUnits", holdUnits],
    ["commitHeld", commitHeld],
    ["releaseHeld", releaseHeld],
    ["releaseSold", releaseSold],
  ] as const)(
    "%s: tüm geceler güncellenirse başarılı, eksikse InventoryUnavailableError",
    async (_n, fn) => {
      await expect(fn(fakeTx(3).tx, stay)).resolves.toBeUndefined();
      const err = await fn(fakeTx(2).tx, stay).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InventoryUnavailableError);
      expect(err).toMatchObject({ nightsUpdated: 2, nightsWanted: 3 });
    }
  );

  it("Date sınırları da gece sayısını doğru hesaplar", async () => {
    const dated = {
      roomTypeId: "rt1",
      checkIn: new Date("2030-01-10T00:00:00Z"),
      checkOut: new Date("2030-01-12T00:00:00Z"),
      units: 2,
    };
    await expect(holdUnits(fakeTx(2).tx, dated)).resolves.toBeUndefined();
    await expect(holdUnits(fakeTx(1).tx, dated)).rejects.toBeInstanceOf(InventoryUnavailableError);
  });

  it("releaseForStatus: HELD/PENDING → held, CONFIRMED → sold, diğerleri hiçbir şey", async () => {
    for (const status of ["HELD", "PENDING", "CONFIRMED"]) {
      const { tx, executeRaw } = fakeTx(3);
      await releaseForStatus(tx, status, stay);
      expect(executeRaw).toHaveBeenCalledTimes(1);
      const sql = (executeRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?");
      expect(sql).toContain(status === "CONFIRMED" ? "sold = sold -" : "held = held -");
    }
    for (const status of ["CANCELLED", "EXPIRED", "COMPLETED"]) {
      const { tx, executeRaw } = fakeTx(0);
      await releaseForStatus(tx, status, stay);
      expect(executeRaw).not.toHaveBeenCalled();
    }
  });
});
