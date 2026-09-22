import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface Props {
  params: { id: string };
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
            capacity: true,
            bedType: true,
            priceModifier: true,
            available: true,
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
      rooms: property.rooms.map((r) => ({ ...r, priceModifier: Number(r.priceModifier) })),
    });
  } catch (error) {
    console.error("Property detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
