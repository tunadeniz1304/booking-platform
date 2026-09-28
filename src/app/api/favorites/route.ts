import { NextRequest, NextResponse } from "next/server";
import { minorFromDb } from "@/lib/money/money";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";
import { logger, errorFields } from "@/lib/observability/logger";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const user = await getAuth(req);
  if (!user) return unauthorized();

  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: user.userId },
      include: {
        property: {
          include: {
            location: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      favorites.map((f) => ({
        ...f,
        property: f.property
          ? {
              ...f.property,
              basePriceMinor: minorFromDb(f.property.basePriceMinor),
            }
          : f.property,
      }))
    );
  } catch (error) {
    logger.error(errorFields(error), "Failed to fetch favorites");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuth(req);
  if (!user) return unauthorized();

  try {
    const body = await req.json();
    const propertyId = body?.propertyId as string | undefined;

    if (!propertyId || typeof propertyId !== "string") {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const favorite = await prisma.favorite.upsert({
      where: {
        userId_propertyId: { userId: user.userId, propertyId },
      },
      update: {},
      create: { userId: user.userId, propertyId },
      include: {
        property: { include: { location: true } },
      },
    });

    return NextResponse.json(
      {
        ...favorite,
        property: favorite.property
          ? {
              ...favorite.property,
              basePriceMinor: minorFromDb(favorite.property.basePriceMinor),
            }
          : favorite.property,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error(errorFields(error), "Failed to add favorite");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getAuth(req);
  if (!user) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    await prisma.favorite.deleteMany({
      where: { userId: user.userId, propertyId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(errorFields(error), "Failed to remove favorite");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
