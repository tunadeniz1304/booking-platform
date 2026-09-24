import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { observed } from "@/lib/http/observed";
import { planTrip } from "@/lib/ai/trip-planner";

const bodySchema = z.object({
  cities: z.array(z.string().trim().min(2).max(60)).min(1).max(6),
  days: z.number().int().min(1).max(30),
  guests: z.number().int().min(1).max(10),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Çok şehirli gezi planı (rezervasyon yapmaz; her durak için teklif kimliği döner). */
export const POST = observed("ai.trip-plan", async function tripPlanHandler(req: NextRequest) {
  await requireAuth(req);
  return NextResponse.json(await planTrip(bodySchema.parse(await req.json())));
});

export const dynamic = "force-dynamic";
