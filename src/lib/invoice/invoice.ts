import { createHash } from "crypto";
import { existsSync } from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/http/errors";
import { formatMoney, fromDecimal, money, toDecimalString } from "@/lib/money/money";

/**
 * Mock e-Arşiv fatura: GİB entegrasyonu YOK. Numara deterministik, PDF üzerinde
 * "DEMO — mali değeri yoktur" damgası bulunur. Rezervasyon başına tek fatura (idempotent).
 */
export const INVOICE_STAMP = "DEMO — mali değeri yoktur";
const INVOICEABLE: readonly BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED];
const INVOICE_HASH_LENGTH = 10;
/** Türkçe glifler (ğ, ş, ı, İ) için gömülü OFL font; yoksa Helvetica + harf çevirisi. */
const FONT_PATH = path.join(process.cwd(), "public", "fonts", "Geist-Regular.ttf");
const PAGE_MARGIN = 50;
const TITLE_SIZE = 18;
const BODY_SIZE = 11;
const STAMP_SIZE = 28;
const STAMP_ANGLE = -30;
const STAMP_OPACITY = 0.25;

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  buyerName: string;
  bookingId: string;
  currency: string;
  /** minor-unit */
  amountMinor: number;
  taxMinor: number;
}

export function invoiceNumber(bookingId: string, issuedAt: Date): string {
  const digest = createHash("sha256").update(`invoice:${bookingId}`).digest("hex");
  return `DEMO-${issuedAt.getUTCFullYear()}-${digest.slice(0, INVOICE_HASH_LENGTH).toUpperCase()}`;
}

const TRANSLIT: Record<string, string> = { ğ: "g", Ğ: "G", ş: "s", Ş: "S", ı: "i", İ: "I" };
function latin(text: string): string {
  return text.replace(/[ğĞşŞıİ]/g, (c) => TRANSLIT[c] ?? c);
}

export async function renderInvoicePdf(data: InvoiceData, fontPath = FONT_PATH): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, info: { Title: data.number } });
  const hasFont = existsSync(fontPath);
  if (hasFont) doc.font(fontPath);
  const t = (s: string) => (hasFont ? s : latin(s));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const fmt = (minor: number) => formatMoney(money(minor, data.currency));
  doc.fontSize(TITLE_SIZE).text(t("e-Arşiv Fatura (DEMO)"));
  doc.moveDown().fontSize(BODY_SIZE);
  doc.text(t(`Fatura no: ${data.number}`));
  doc.text(t(`Düzenleme tarihi: ${data.issuedAt.toISOString().slice(0, 10)}`));
  doc.text(t(`Alıcı: ${data.buyerName}`));
  doc.text(t(`Rezervasyon: ${data.bookingId}`));
  doc.moveDown();
  doc.text(t(`Vergiler: ${fmt(data.taxMinor)}`));
  doc.text(t(`Genel toplam: ${fmt(data.amountMinor)}`));

  doc.save().rotate(STAMP_ANGLE, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc
    .fillOpacity(STAMP_OPACITY)
    .fillColor("red")
    .fontSize(STAMP_SIZE)
    .text(t(INVOICE_STAMP), 0, doc.page.height / 2, { width: doc.page.width, align: "center" });
  doc.restore();
  doc.end();
  return done;
}

function taxMinorOf(breakdown: unknown): number {
  const taxes = (breakdown as { taxes?: { amount?: unknown }[] } | null)?.taxes;
  if (!Array.isArray(taxes)) return 0;
  return taxes.reduce((acc, x) => acc + (Number.isInteger(x.amount) ? Number(x.amount) : 0), 0);
}

/** Sahiplik + durum kontrolü; faturayı ilk çağrıda oluşturur, sonra aynısını döner. */
export async function issueInvoice(bookingId: string, userId: string): Promise<InvoiceData> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: { select: { firstName: true, lastName: true } }, invoice: true },
  });
  if (!booking || booking.userId !== userId) throw new NotFoundError("Rezervasyon bulunamadı");
  if (!INVOICEABLE.includes(booking.status)) {
    throw new ConflictError(
      "Fatura yalnızca onaylı rezervasyonlar için kesilir",
      "NOT_INVOICEABLE"
    );
  }
  const issuedAt = booking.invoice?.issuedAt ?? new Date();
  const invoice =
    booking.invoice ??
    (await prisma.invoice.upsert({
      where: { bookingId },
      update: {},
      create: {
        bookingId,
        number: invoiceNumber(bookingId, issuedAt),
        amount: booking.totalPrice,
        taxAmount: toDecimalString(money(taxMinorOf(booking.priceBreakdown), booking.currency)),
        currency: booking.currency,
        buyerName: `${booking.user.firstName} ${booking.user.lastName}`.trim(),
        issuedAt,
      },
    }));
  return {
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    buyerName: invoice.buyerName,
    bookingId,
    currency: invoice.currency,
    amountMinor: fromDecimal(invoice.amount, invoice.currency).amount,
    taxMinor: fromDecimal(invoice.taxAmount, invoice.currency).amount,
  };
}
