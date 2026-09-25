import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { propertyPatchSchema, updateProperty } from "@/lib/host/host-service";
import { prisma } from "@/lib/prisma";
import { logger, errorFields } from "@/lib/observability/logger";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params;
  try {
    const property = await prisma.property.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        title: true,
        description: true,
        propertyType: true,
        basePrice: true,
        currency: true,
        ratingAvg: true,
        ratingCount: true,
        images: true,
        location: { select: { city: true, country: true } },
        amenities: { select: { name: true, icon: true } },
        rooms: {
          select: {
            id: true,
            name: true,
            description: true,
            maxOccupancy: true,
            units: true,
            bedType: true,
            priceModifier: true,
            available: true,
            ratePlans: {
              where: { active: true },
              select: {
                id: true,
                code: true,
                name: true,
                mealPlan: true,
                refundable: true,
                priceModifierBps: true,
                isDefault: true,
              },
              orderBy: { priceModifierBps: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!property) {
      return NextResponse.json({ error: "Konaklama bulunamadı" }, { status: 404 });
    }

    return NextResponse.json({
      ...property,
      basePrice: Number(property.basePrice),
      // `capacity`: bir sürüm boyunca `maxOccupancy`'nin geriye uyumlu adı (ADR 0010).
      rooms: property.rooms.map((r) => ({
        ...r,
        capacity: r.maxOccupancy,
        priceModifier: Number(r.priceModifier),
      })),
    });
  } catch (error) {
    logger.error(errorFields(error), "Property detail error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Mülk güncelleme (sahip HOST veya ADMIN; başkasınınki 404). */
export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(
      await updateProperty(actor, id, propertyPatchSchema.parse(await req.json()))
    );
  } catch (error) {
    return toErrorResponse(error, "properties.update");
  }
}

export const dynamic = "force-dynamic";
