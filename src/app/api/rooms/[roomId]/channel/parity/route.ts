import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { assertRoomAccess } from "@/lib/host/host-service";
import { checkRateParity } from "@/lib/channel/channel";
import { getConfig } from "@/lib/config/app-config";
import { prisma } from "@/lib/prisma";
import { toMinor, minorFromDb } from "@/lib/money/money";
import { fromDate, toDbDate, type IsoDate } from "@/lib/time/nights";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({
  channel: z.string().trim().min(2).max(40),
  rates: z
    .array(z.object({ date: isoDate, price: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/) }))
    .min(1)
    .max(366),
});

/**
 * Parite kontrolü (P1-9): host'un harici kanaldaki fiyatları bizimkilerle karşılaştırılır.
 * YALNIZCA uyarı döner; hiçbir fiyat değiştirilmez (DMA — parite zorlanmaz).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    await assertRoomAccess(await requireRole(req, ["HOST", "ADMIN"]), roomId);
    const { channel, rates } = bodySchema.parse(await req.json());
    const room = await prisma.roomType.findUniqueOrThrow({
      where: { id: roomId },
      select: { property: { select: { currency: true } } },
    });
    const currency = room.property.currency;
    const days = await prisma.inventoryDay.findMany({
      where: { roomTypeId: roomId, date: { in: rates.map((r) => toDbDate(r.date as IsoDate)) } },
      select: { date: true, priceMinor: true },
    });
    const warnings = checkRateParity(
      days.map((d) => ({ date: fromDate(d.date), amount: minorFromDb(d.priceMinor) })),
      rates.map((r) => ({ date: r.date as IsoDate, amount: toMinor(r.price, currency) })),
      getConfig().CHANNEL_PARITY_TOLERANCE_BPS
    );
    return NextResponse.json({ channel, currency, enforced: false, warnings });
  } catch (error) {
    return toErrorResponse(error, "channel.parity");
  }
}

export const dynamic = "force-dynamic";
