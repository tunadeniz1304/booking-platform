import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    const results = await prisma.location.findMany({
      where:
        q.length >= 2
          ? {
              OR: [
                { city: { contains: q, mode: "insensitive" as Prisma.QueryMode } },
                { country: { contains: q, mode: "insensitive" as Prisma.QueryMode } },
              ],
            }
          : undefined,
      select: { city: true, country: true },
      orderBy: { city: "asc" },
      take: 20,
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Locations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
