import { afterEach, describe, expect, it, vi } from "vitest";

const fxRate = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { fxRate } }));

import { resetConfigForTests } from "@/lib/config/app-config";
import { pruneFxRates } from "@/lib/fx/store";
import { runFxRefresh } from "@/worker/jobs/fx-refresh";

const NOW = new Date("2026-09-25T12:00:00Z");

afterEach(() => {
  delete process.env.FX_RETENTION_DAYS;
  delete process.env.FX_SOURCES;
  resetConfigForTests();
  vi.clearAllMocks();
});

describe("kur tablosu saklama (FX_RETENTION_DAYS)", () => {
  it("eşikten eski, rezervasyonsuz satırları siler; en yeni satırı korur", async () => {
    process.env.FX_RETENTION_DAYS = "30";
    resetConfigForTests();
    fxRate.findFirst.mockResolvedValue({ id: "fx_newest" });
    fxRate.deleteMany.mockResolvedValue({ count: 4 });

    expect(await pruneFxRates(NOW)).toBe(4);
    expect(fxRate.deleteMany).toHaveBeenCalledWith({
      where: {
        fetchedAt: { lt: new Date("2026-08-26T12:00:00Z") },
        bookings: { none: {} },
        id: { not: "fx_newest" },
      },
    });
  });

  it("tablo boşsa id koşulu eklenmez; varsayılan süre 90 gün", async () => {
    fxRate.findFirst.mockResolvedValue(null);
    fxRate.deleteMany.mockResolvedValue({ count: 0 });
    expect(await pruneFxRates(NOW)).toBe(0);
    const where = fxRate.deleteMany.mock.calls[0][0].where;
    expect(where.id).toBeUndefined();
    expect(where.fetchedAt.lt).toEqual(new Date("2026-06-27T12:00:00Z"));
  });

  it("fx-refresh işi yenilemeden sonra budar", async () => {
    process.env.FX_SOURCES = "none";
    resetConfigForTests();
    fxRate.create.mockImplementation(async ({ data }) => ({ id: "fx_1", ...data }));
    fxRate.findFirst.mockResolvedValue({ id: "fx_1" });
    fxRate.deleteMany.mockResolvedValue({ count: 2 });
    const out = await runFxRefresh();
    expect(out).toMatchObject({ source: "static", stale: true, pruned: 2 });
    expect(fxRate.create).toHaveBeenCalledBefore(fxRate.deleteMany);
  });
});
