import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";
import { minorFromDb } from "@/lib/money/money";

const QUEUE_LIMIT = 100;
const QUEUE_WHERE = {
  decision: { in: ["review", "deny", "block"] },
} satisfies Prisma.FraudCheckWhereInput;

/**
 * Fraud inceleme kuyruğu (ADMIN): review/deny kararları ve sebep kodları ("block" = v1 kayıtları).
 * F649: toplam kayıt `X-Total-Count` başlığında; `?cursor=<id>` ile sonraki sayfa.
 * F650: her satır, varsa rezervasyonun tarihleri, tutarı ve ilan başlığıyla (`booking`) döner.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const cursor = z
      .string()
      .min(1)
      .max(64)
      .optional()
      .parse(req.nextUrl.searchParams.get("cursor") ?? undefined);
    const [checks, total] = await Promise.all([
      prisma.fraudCheck.findMany({
        where: QUEUE_WHERE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: QUEUE_LIMIT,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.fraudCheck.count({ where: QUEUE_WHERE }),
    ]);
    const bookings = await prisma.booking.findMany({
      where: { id: { in: [...new Set(checks.map((c) => c.bookingId))] } },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        totalPriceMinor: true,
        currency: true,
        property: { select: { title: true } },
      },
    });
    const byId = new Map(
      bookings.map(({ id, totalPriceMinor, ...rest }) => [
        id,
        { ...rest, totalPriceMinor: minorFromDb(totalPriceMinor) },
      ])
    );
    return NextResponse.json(
      checks.map((check) => ({ ...check, booking: byId.get(check.bookingId) ?? null })),
      { headers: { "X-Total-Count": String(total) } }
    );
  } catch (error) {
    return toErrorResponse(error, "admin.fraud");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { id, resolution } = z
      .object({ id: z.string(), resolution: z.enum(["legit", "fraud"]) })
      .parse(await req.json());
    await prisma.fraudCheck.update({
      where: { id },
      data: {
        reviewedBy: admin.userId,
        reviewedAt: new Date(),
        decision: resolution === "legit" ? "cleared" : "confirmed_fraud",
      },
    });
    await audit(admin.userId, "fraud.review", "FraudCheck", id, { resolution });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, "admin.fraud.review");
  }
}

export const dynamic = "force-dynamic";
