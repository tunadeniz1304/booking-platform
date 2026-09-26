import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { closeTakedown, closeTakedownSchema } from "@/lib/compliance/takedown";

/** Kaldırma talebini kapatır (ADMIN, P1-13a). İlan otomatik yeniden yayına alınmaz. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const { resolution } = closeTakedownSchema.parse(await req.json());
    return NextResponse.json({ takedown: await closeTakedown(id, resolution, admin.userId) });
  } catch (error) {
    return toErrorResponse(error, "admin.takedowns.close");
  }
}
