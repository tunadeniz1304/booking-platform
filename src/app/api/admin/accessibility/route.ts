import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listFeaturesForReview } from "@/lib/compliance/accessibility";

/** Admin: erişilebilirlik doğrulama kuyruğu (`status=pending|verified`), P1-13(e). */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const status = req.nextUrl.searchParams.get("status") === "verified" ? "verified" : "pending";
    return NextResponse.json({ features: await listFeaturesForReview(status) });
  } catch (error) {
    return toErrorResponse(error, "admin.accessibility.list");
  }
}

export const dynamic = "force-dynamic";
