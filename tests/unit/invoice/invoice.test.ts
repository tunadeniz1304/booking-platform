import { describe, expect, it } from "vitest";
import { INVOICE_STAMP, invoiceNumber, renderInvoicePdf } from "@/lib/invoice/invoice";

const data = {
  number: invoiceNumber("bk_1", new Date("2026-09-25T00:00:00Z")),
  issuedAt: new Date("2026-09-25T00:00:00Z"),
  buyerName: "Ayşe Yılmaz",
  bookingId: "bk_1",
  currency: "TRY",
  amountMinor: 250_000,
  taxMinor: 38_136,
};

describe("mock e-Arşiv fatura", () => {
  it("numara deterministik ve DEMO önekli", () => {
    expect(data.number).toMatch(/^DEMO-2026-[0-9A-F]{10}$/);
    expect(invoiceNumber("bk_1", data.issuedAt)).toBe(data.number);
    expect(invoiceNumber("bk_2", data.issuedAt)).not.toBe(data.number);
    expect(INVOICE_STAMP).toBe("DEMO — mali değeri yoktur");
  });

  it("gömülü fontla geçerli PDF üretir", async () => {
    const pdf = await renderInvoicePdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("FontFile2");
  });

  it("font yoksa Helvetica'ya düşer (harf çevirisiyle)", async () => {
    const pdf = await renderInvoicePdf(data, "/nonexistent/font.ttf");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("Helvetica");
  });
});
