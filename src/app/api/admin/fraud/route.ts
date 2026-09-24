import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";

/** Fraud inceleme kuyruğu (ADMIN): review/block kararları ve kural açıklamaları. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    return NextResponse.json(
      await prisma.fraudCheck.findMany({
        where: { decision: { in: ["review", "block"] } },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
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
