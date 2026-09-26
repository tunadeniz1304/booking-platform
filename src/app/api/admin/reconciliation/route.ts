import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { reconcile, serializeReport } from "@/lib/ledger/reconcile";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Dünün UTC tarihi (günlük job ile aynı varsayılan). */
function yesterdayUtc(now = new Date()): string {
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * PSP ↔ jurnal mutabakat raporu (ADMIN, P0-3): `?date=YYYY-MM-DD` (UTC, varsayılan dün).
 * Tutarlar minor-unit string'tir; `differences` boşsa ve dengesiz jurnal yoksa `ok: true`.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const { date } = querySchema.parse({
      date: req.nextUrl.searchParams.get("date") ?? undefined,
    });
    const report = await reconcile(date ?? yesterdayUtc());
    return NextResponse.json(serializeReport(report));
  } catch (error) {
    const mapped = error instanceof RangeError ? new ValidationError(error.message) : error;
    return toErrorResponse(mapped, "admin.reconciliation");
  }
}
