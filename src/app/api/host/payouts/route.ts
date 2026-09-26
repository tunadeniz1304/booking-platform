import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { onboardHostAccount } from "@/lib/payout/host-account";
import { getHostPayoutOverview } from "@/lib/payout/overview";

/** Ev sahibi bakiye özeti (emanette / serbest / rezerv / ödenen) + payout geçmişi (P1-4). */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(await getHostPayoutOverview(actor.userId));
  } catch (error) {
    return toErrorResponse(error, "host.payouts");
  }
}

const onboardSchema = z
  .object({
    schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict();

/** Payout hesabını bağlar / durumunu tazeler; takvimi günceller (idempotent). */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const body = onboardSchema.parse(await req.json().catch(() => ({})));
    await onboardHostAccount(actor.userId, body);
    return NextResponse.json(await getHostPayoutOverview(actor.userId));
  } catch (error) {
    return toErrorResponse(error, "host.payouts.onboard");
  }
}

export const dynamic = "force-dynamic";
