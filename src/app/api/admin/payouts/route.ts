import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listPayoutAccounts } from "@/lib/payout/overview";

/** Yönetici: payout hesapları (durdurulanlar önce) ve bekleyen payout sayıları (P1-4). */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    return NextResponse.json({ accounts: await listPayoutAccounts() });
  } catch (error) {
    return toErrorResponse(error, "admin.payouts");
  }
}

export const dynamic = "force-dynamic";
