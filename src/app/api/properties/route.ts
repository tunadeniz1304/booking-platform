import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { searchProperties, getPopularProperties } from "@/lib/search";

const roomSchema = z.object({
  name: z.string().trim().min(1),
  capacity: z.number().int().positive(),
  bedType: z.string().trim().min(1),
  priceModifier: z.number().nonnegative().default(0),
});

const createPropertySchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().min(10),
  propertyType: z.enum(["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"]),
  city: z.string().trim().min(1),
  country: z.string().trim().min(1),
  basePrice: z.number().positive(),
  currency: z.string().trim().min(1).default("TRY"),
  amenities: z.array(z.string().trim().min(1)).default([]),
  images: z.array(z.string().url()).default([]),
  rooms: z.array(roomSchema).min(1),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const popular = searchParams.get("popular") === "true";

    if (popular) {
      const limit = Number(searchParams.get("limit") ?? "10");
      const results = await getPopularProperties(Number.isFinite(limit) ? Math.min(limit, 50) : 10);
      return NextResponse.json({ results, total: results.length, page: 1, pageSize: results.length, totalPages: 1, cached: false });
    }

    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "12");
    const response = await searchProperties({
      query: searchParams.get("destination") ?? searchParams.get("query") ?? undefined,
      checkIn: searchParams.get("checkIn") ?? undefined,
      checkOut: searchParams.get("checkOut") ?? undefined,
      guests: searchParams.get("guests") ? Number(searchParams.get("guests")) : undefined,
      city: undefined,
      country: undefined,
      minPrice: searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : undefined,
      maxPrice: searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined,
      propertyType: searchParams.get("propertyType") ?? undefined,
      amenities: searchParams.get("amenities")?.split(",").filter(Boolean),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 50) : 12,
      sort: (searchParams.get("sort") ?? "recommended") as "price_asc" | "price_desc" | "rating" | "recommended",
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("Properties list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const host = requireRole(req, ["HOST", "ADMIN"]);

    const body = await req.json();
    const parsed = createPropertySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { title, description, propertyType, city, country, basePrice, currency, amenities, images, rooms } = parsed.data;

    const property = await prisma.$transaction(async (tx) => {
      const location = await tx.location.upsert({
        where: { city_country: { city, country } },
        update: {},
        create: { city, country },
      });

      const amenityRecords = await Promise.all(
        amenities.map((name) =>
          tx.amenity.upsert({
            where: { name },
            update: {},
            create: { name },
          })
        )
      );

      const created = await tx.property.create({
        data: {
          hostId: host.userId,
          title,
          description,
          propertyType: propertyType as PropertyType,
          locationId: location.id,
          basePrice: new Prisma.Decimal(basePrice),
          currency,
          isActive: true,
          images,
          amenities: { connect: amenityRecords.map((a) => ({ id: a.id })) },
          rooms: {
            create: rooms.map((room) => ({
              name: room.name,
              capacity: room.capacity,
              bedType: room.bedType,
              priceModifier: new Prisma.Decimal(room.priceModifier),
            })),
          },
        },
        select: {
          id: true,
          title: true,
          propertyType: true,
          basePrice: true,
          currency: true,
          isActive: true,
          location: { select: { city: true, country: true } },
        },
      });
      return created;
    });

    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Missing or invalid token") {
      return NextResponse.json({ error: "Missing or invalid token" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Insufficient permissions") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    console.error("Property create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
