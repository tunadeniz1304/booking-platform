import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { verifyFeature, verifyFeatureSchema } from "@/lib/compliance/accessibility";

/** Admin: kanıtı inceleyip özelliği doğrular / doğrulamayı geri alır (audit'li), P1-13(e). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const { verified } = verifyFeatureSchema.parse(await req.json());
    return NextResponse.json({ feature: await verifyFeature(admin.userId, id, verified) });
  } catch (error) {
    return toErrorResponse(error, "admin.accessibility.verify");
  }
}

export const dynamic = "force-dynamic";
