import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { supportTicketStatusSchema } from "@/lib/http/api-schemas";
import { audit } from "@/lib/admin/audit";
import { updateSupportTicketStatus } from "@/lib/support/repo";

/** v5 P1-4: talep durum geçişi — insan temsilcinin kararı (denetim kaydı ile). */
export const PATCH = observed(
  "admin.support.update",
  async function patchHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const admin = await requireRole(req, ["ADMIN"]);
      const { status } = supportTicketStatusSchema.parse(await req.json());
      const updated = await updateSupportTicketStatus(id, status, admin.userId);
      if (!updated) throw new NotFoundError("Destek talebi bulunamadı");
      await audit(admin.userId, "support.ticket.status", "SupportTicket", id, { status });
      return NextResponse.json(updated);
    } catch (error) {
      return toErrorResponse(error, "admin.support.update");
    }
  }
);

export const dynamic = "force-dynamic";
