import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ValidationError, toErrorResponse } from "@/lib/http/errors";
import { httpsUrl } from "@/lib/security/url";
import { withAiSubject } from "@/lib/http/ai";
import { DEFAULT_RATE_PLANS, licenseSchema, roomSchema } from "@/lib/host/host-service";
import { CURRENCIES } from "@/lib/money/money";
import {
  SearchParamsSchema,
  searchParamsFromUrl,
  searchProperties,
  getPopularProperties,
} from "@/lib/search";
import { appendOutbox } from "@/lib/cqrs";
import { verifyLicense } from "@/lib/compliance/license-registry";
import { EventTypes, makeEvent, type PropertyCreatedPayload } from "@/lib/events/events";

/**
 * v3#8: her alanın üst sınırı var; para birimi desteklenen listeden (aksi halde 400,
 * sonradan `assertCurrency` → 500 değil); oda şeması host extranet ile ortak.
 */
const createPropertySchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(5000),
  propertyType: z.enum(["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"]),
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().min(1).max(100),
  basePrice: z.number().positive().max(1_000_000),
  currency: z.enum(CURRENCIES).default("TRY"),
  amenities: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  images: z.array(httpsUrl).max(20).default([]),
  rooms: z.array(roomSchema).min(1).max(50),
  licenseNumber: licenseSchema.optional(),
  cancellationPolicyId: z.string().trim().min(1).max(64).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const popular = searchParams.get("popular") === "true";

    if (popular) {
      const limit = Number(searchParams.get("limit") ?? "10");
      const results = await getPopularProperties(Number.isFinite(limit) ? Math.min(limit, 50) : 10);
      return NextResponse.json({
        results,
        total: results.length,
        page: 1,
        pageSize: results.length,
        totalPages: 1,
        cached: false,
      });
    }

    const params = SearchParamsSchema.parse({
      ...searchParamsFromUrl(searchParams),
      pageSize: searchParams.get("pageSize") ?? 12,
    });
    // Sorgu embedding'i (uzak model açıksa) isteğin öznesine faturalanır (v4#3).
    const response = await withAiSubject(req, () => searchProperties(params));
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error, "properties.list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const host = await requireRole(req, ["HOST", "ADMIN"]);

    const body = await req.json();
    const parsed = createPropertySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const {
      title,
      description,
      propertyType,
      city,
      country,
      basePrice,
      currency,
      amenities,
      images,
      rooms,
      licenseNumber,
      cancellationPolicyId,
    } = parsed.data;
    if (
      cancellationPolicyId &&
      !(await prisma.cancellationPolicy.findUnique({
        where: { id: cancellationPolicyId },
        select: { id: true },
      }))
    ) {
      throw new ValidationError("İptal politikası bulunamadı");
    }

    // P1-10: kayıt no ülkeye göre (TR Bakanlık / AB STR) doğrulanır; yalnızca VERIFIED yayınlanır.
    const license = licenseNumber ? await verifyLicense(licenseNumber, country) : null;

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
          // Belge numarası yoksa veya kayıtta doğrulanmadıysa ilan yayınlanmaz (7464 / 7565, v3#25).
          isActive: license?.status === "VERIFIED",
          licenseNumber,
          licenseStatus: license?.status ?? "PENDING",
          licenseCheckedAt: license ? new Date() : null,
          cancellationPolicyId: cancellationPolicyId ?? null,
          images,
          amenities: { connect: amenityRecords.map((a) => ({ id: a.id })) },
          rooms: {
            create: rooms.map((room) => ({
              name: room.name,
              maxOccupancy: room.maxOccupancy,
              units: room.units,
              ratePlans: { create: DEFAULT_RATE_PLANS.map((p) => ({ ...p })) },
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
          licenseStatus: true,
          location: { select: { city: true, country: true } },
        },
      });
      // #22: yeni mülk için embedding işçide üretilir (outbox ile atomik olay).
      await appendOutbox(
        tx,
        makeEvent<PropertyCreatedPayload>(EventTypes.PropertyCreated, created.id, "property", {
          propertyId: created.id,
          hostId: host.userId,
        })
      );
      return created;
    });

    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "properties.create");
  }
}

export const dynamic = "force-dynamic";
