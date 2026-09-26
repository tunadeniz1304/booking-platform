import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import {
  createFeature,
  createFeatureSchema,
  listHostFeatures,
} from "@/lib/compliance/accessibility";

/** Host: ilanın erişilebilirlik beyanları (doğrulanmış + bekleyen), P1-13(e). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json({ features: await listHostFeatures(actor, id) });
  } catch (error) {
    return toErrorResponse(error, "host.accessibility.list");
  }
}

/** Host: özellik beyan eder (ilan veya oda tipi düzeyinde, isteğe bağlı kanıt fotoğrafıyla). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const input = createFeatureSchema.parse(await req.json());
    return NextResponse.json({ feature: await createFeature(actor, id, input) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "host.accessibility.create");
  }
}

export const dynamic = "force-dynamic";
