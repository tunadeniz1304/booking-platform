import { NextRequest, NextResponse } from "next/server";
import { minorFromDb } from "@/lib/money/money";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { propertyPatchSchema, updateProperty } from "@/lib/host/host-service";
import { prisma } from "@/lib/prisma";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";
import { logger, errorFields } from "@/lib/observability/logger";
import { DEFAULT_POLICIES, toSnapshot, type PolicySnapshot } from "@/lib/booking/cancellation";

interface Props {
  params: Promise<{ id: string }>;
}

type PolicyRow = { kind: string; version: number; rules: unknown } | null;

/**
 * Rezervasyonda uygulanacak iptal politikası (booking-service ile aynı seçim: iade edilemez
 * plan → NON_REFUNDABLE, yoksa planın ya da mülkün politikası; atanmamışsa varsayılan).
 * Kurallar okunamazsa null: ödeme ekranı ücretsiz iptal satırını göstermez.
 */
function policySummary(policy: PolicyRow, refundable = true): PolicySnapshot | null {
  if (!refundable) return DEFAULT_POLICIES.NON_REFUNDABLE;
  try {
    return toSnapshot(policy);
  } catch {
    return null;
  }
}

const POLICY_SELECT = { select: { kind: true, version: true, rules: true } } as const;

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params;
  try {
    const property = await prisma.property.findFirst({
      // Doğrulanmamış (PENDING/REJECTED) ilan aramadaki gibi 404 (v3#26).
      where: { id, ...LISTABLE_PROPERTY },
      select: {
        id: true,
        title: true,
        description: true,
        propertyType: true,
        basePriceMinor: true,
        currency: true,
        ratingAvg: true,
        ratingCount: true,
        images: true,
        timeZone: true,
        checkInTime: true,
        cancellationPolicy: POLICY_SELECT,
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
            priceModifierMinor: true,
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
                cancellationPolicy: POLICY_SELECT,
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

    // `cancellationPolicy` + `timeZone`/`checkInTime`: ödeme ekranı ücretsiz iptal son anını
    // `freeCancellation` (lib/booking/free-cancellation-deadline.ts) ile hesaplar.
    return NextResponse.json({
      ...property,
      basePriceMinor: minorFromDb(property.basePriceMinor),
      cancellationPolicy: policySummary(property.cancellationPolicy),
      // `capacity`: bir sürüm boyunca `maxOccupancy`'nin geriye uyumlu adı (ADR 0010).
      rooms: property.rooms.map((r) => ({
        ...r,
        capacity: r.maxOccupancy,
        priceModifierMinor: minorFromDb(r.priceModifierMinor),
        ratePlans: r.ratePlans.map((plan) => ({
          ...plan,
          cancellationPolicy: policySummary(
            plan.cancellationPolicy ?? property.cancellationPolicy,
            plan.refundable
          ),
        })),
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
