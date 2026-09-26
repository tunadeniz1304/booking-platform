import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { deletePropertyPhoto } from "@/lib/vision/photo-service";

/** Host: fotoğrafı siler (ör. duplikat uyarısından sonra); `Property.images`'tan da çıkar. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  try {
    const { id, photoId } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    await deletePropertyPhoto(actor, id, photoId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, "host.photos.delete");
  }
}

export const dynamic = "force-dynamic";
