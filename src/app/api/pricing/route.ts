import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addPricingUpdateJob, setupPricingCron } from "@/lib/queue";
import { requireRole } from "@/lib/auth";

const pricingSchema = z.object({
  roomId: z.string().min(1),
  dates: z.array(z.string().datetime()).min(1).max(366),
  basePrice: z.number().positive(),
  currency: z.string().min(1).default("TRY"),
});

export async function POST(request: NextRequest) {
  try {
    requireRole(request, ["HOST", "ADMIN"]);
    const body = await request.json();
    const parsed = pricingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { roomId, dates, basePrice, currency } = parsed.data;

    // Cron mekanizmasını başlat (ilk istekte)
    await setupPricingCron();

    // Kuyruğa iş ekle (async)
    await addPricingUpdateJob(roomId, dates, basePrice, currency);

    return NextResponse.json({
      message: "Pricing update job queued successfully",
      roomId,
      dates,
      basePrice,
      currency,
    });
  } catch (error) {
    console.error("Pricing API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Use POST to trigger pricing update" });
}
