import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { issueInvoice, renderInvoicePdf } from "@/lib/invoice/invoice";

/** Mock e-Arşiv fatura PDF'i (yalnızca rezervasyon sahibi; CONFIRMED/COMPLETED). */
export const GET = observed(
  "bookings.invoice",
  async function invoiceHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      const invoice = await issueInvoice(id, userId);
      const pdf = await renderInvoicePdf(invoice);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${invoice.number}.pdf"`,
          "cache-control": "private, no-store",
        },
      });
    } catch (error) {
      return toErrorResponse(error, "bookings.invoice");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
