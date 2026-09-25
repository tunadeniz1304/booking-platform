import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { issueInvoice, renderInvoicePdf } from "@/lib/invoice/invoice";

describeInt("mock e-Arşiv fatura (DB)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "invoice" });
  });
  afterAll(() => prisma.$disconnect());

  it("yalnızca sahibine ve onaylı rezervasyona; idempotent tek kayıt", async () => {
    const b = await fx.hold();
    await expect(issueInvoice(b.id, fx.userId)).rejects.toMatchObject({ status: 409 });

    await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    await expect(issueInvoice(b.id, fx.hostId)).rejects.toMatchObject({ status: 404 });

    const first = await issueInvoice(b.id, fx.userId);
    const again = await issueInvoice(b.id, fx.userId);
    expect(again.number).toBe(first.number);
    expect(first.amountMinor).toBe(b.totalMinor);
    expect(first.taxMinor).toBeGreaterThanOrEqual(0);
    expect(await prisma.invoice.count({ where: { bookingId: b.id } })).toBe(1);
    expect((await renderInvoicePdf(first)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
