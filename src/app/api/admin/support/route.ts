import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { listSupportTickets } from "@/lib/support/repo";

/** v5 P1-4: insan destek kuyruğu (ADMIN). `?status=` ile filtre; en eskiden yeniye. */
export const GET = observed("admin.support.list", async function getHandler(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const status = z
      .enum(["OPEN", "IN_PROGRESS", "RESOLVED"])
      .optional()
      .parse(req.nextUrl.searchParams.get("status") ?? undefined);
    return NextResponse.json({ tickets: await listSupportTickets(status) });
  } catch (error) {
    return toErrorResponse(error, "admin.support.list");
  }
});

export const dynamic = "force-dynamic";
