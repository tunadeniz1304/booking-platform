import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { proposeEvent } from "@/lib/pricing/event-signals";
import { authorizeInternalRequest } from "@/lib/security/internal-auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";

/**
 * İç servis: dış olay sinyalini ÖNERİ (PROPOSED) olarak kaydeder. Fiyata etkisi
 * yalnızca admin onayından sonra (`/api/admin/events/:id/approve`). `x-internal-secret`
 * (≥32 karakter, timing-safe) veya ADMIN JWT.
 */
const signalSchema = z.object({
  title: z.string().min(3).max(200),
  city: z.string().min(1).max(100),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impact: z.number().int().min(1).max(10),
  source: z.string().min(2).max(40),
  category: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await authorizeInternalRequest(req);
    const s = signalSchema.parse(await req.json());
    const location = await prisma.location.findFirst({
      where: { city: { equals: s.city, mode: "insensitive" } },
      select: { id: true },
    });
    if (!location) throw new ValidationError("Lokasyon bulunamadı");
    const event = await proposeEvent({ locationId: location.id, ...s });
    return NextResponse.json({ eventId: event.id, status: event.status }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "internal.events.ingest");
  }
}

export const dynamic = "force-dynamic";
