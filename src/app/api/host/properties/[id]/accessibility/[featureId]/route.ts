import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { deleteFeature, updateFeature, updateFeatureSchema } from "@/lib/compliance/accessibility";

type Ctx = { params: Promise<{ id: string; featureId: string }> };

/** Host: kanıt fotoğrafı bağla/kaldır, ölçü/not güncelle (değişiklik doğrulamayı düşürür). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, featureId } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const input = updateFeatureSchema.parse(await req.json());
    return NextResponse.json({ feature: await updateFeature(actor, id, featureId, input) });
  } catch (error) {
    return toErrorResponse(error, "host.accessibility.update");
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const { id, featureId } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    await deleteFeature(actor, id, featureId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, "host.accessibility.delete");
  }
}

export const dynamic = "force-dynamic";
