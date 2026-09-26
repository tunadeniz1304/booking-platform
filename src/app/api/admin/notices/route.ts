import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listNotices } from "@/lib/compliance/dsa";

/** DSA bildirim kuyruğu (ADMIN, P1-13b). `?status=RECEIVED|DECIDED`. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const status = z
      .enum(["RECEIVED", "DECIDED"])
      .optional()
      .parse(req.nextUrl.searchParams.get("status") ?? undefined);
    return NextResponse.json({ notices: await listNotices({ status }) });
  } catch (error) {
    return toErrorResponse(error, "admin.notices");
  }
}
