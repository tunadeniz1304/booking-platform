import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { setPayoutsPaused } from "@/lib/payout/host-account";

const bodySchema = z
  .object({ paused: z.boolean(), reason: z.string().trim().min(1).max(500).optional() })
  .strict();

/** Yönetici: kullanıcının payout'larını durdurur / devam ettirir (denetim kaydıyla, P1-4). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { userId } = z.object({ userId: z.string().min(1).max(64) }).parse(await params);
    const { paused, reason } = bodySchema.parse(await req.json());
    const account = await setPayoutsPaused(admin.userId, userId, paused, reason);
    return NextResponse.json({
      userId: account.userId,
      payoutsPaused: account.payoutsPaused,
      pausedReason: account.pausedReason,
    });
  } catch (error) {
    return toErrorResponse(error, "admin.payouts.pause");
  }
}

export const dynamic = "force-dynamic";
