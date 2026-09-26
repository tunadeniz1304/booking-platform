import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listAppeals } from "@/lib/compliance/dsa-appeal";

/** DSA md. 20 itiraz kuyruğu (ADMIN, P2-1a). `?status=PENDING|UPHELD|REJECTED`. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const status = z
      .enum(["PENDING", "UPHELD", "REJECTED"])
      .optional()
      .parse(req.nextUrl.searchParams.get("status") ?? undefined);
    return NextResponse.json({ appeals: await listAppeals({ status }) });
  } catch (error) {
    return toErrorResponse(error, "admin.notice_appeals");
  }
}
