import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addPricingUpdateJob } from "@/lib/queue";
import { requireRole } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { isOwnedBy } from "@/lib/security/ownership";

const pricingSchema = z.object({
  roomId: z.string().min(1).max(64),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(366),
  basePrice: z.number().positive().max(10_000_000),
});

/**
 * Oda fiyat güncelleme işi kuyruğa alır.
 * - Oturum yok → 401, rol HOST/ADMIN değil → 403.
 * - HOST yalnızca KENDİ mülkünün odası için iş açabilir; başkasınınki → 404
 *   (kaynağın varlığı sızdırılmaz). ADMIN tüm odalar için.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const { roomId, dates, basePrice } = pricingSchema.parse(await req.json());

    const room = await prisma.roomType.findUnique({
      where: { id: roomId },
      select: { property: { select: { hostId: true, currency: true } } },
    });
    if (!room || (actor.role !== "ADMIN" && !isOwnedBy(room.property.hostId, actor.userId))) {
      throw new NotFoundError("Oda bulunamadı");
    }

    const jobId = await addPricingUpdateJob({
      roomId,
      dates,
      basePrice,
      currency: room.property.currency,
    });
    return NextResponse.json({ queued: true, jobId, roomId, dates: dates.length }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error, "pricing");
  }
}

export const dynamic = "force-dynamic";
