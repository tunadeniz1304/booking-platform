import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { readMultipartFile } from "@/lib/http/body-limit";
import { getConfig } from "@/lib/config/app-config";
import { listPropertyPhotos, uploadPropertyPhoto } from "@/lib/vision/photo-service";
import { visualSearchStatus } from "@/lib/vision/visual-search";

/** Host: ilanın fotoğrafları (kalite skoru + duplikat işareti) ve görsel özellik durumu. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const [photos, visual] = await Promise.all([
      listPropertyPhotos(actor, id),
      visualSearchStatus(),
    ]);
    return NextResponse.json({ photos, visual });
  } catch (error) {
    return toErrorResponse(error, "host.photos.list");
  }
}

/**
 * Host: fotoğraf yükler (multipart `file`). Duplikat/düşük kalite yüklemeyi engellemez;
 * yanıt `warnings` ve `duplicate` ile host'u uyarır (P1-10 KK).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const max = getConfig().VISION_MAX_UPLOAD_BYTES;
    // v5#11: gövde akıştan sayılarak okunur (content-length'e güvenilmez; aşımda 413).
    const file = await readMultipartFile(req, max);
    const result = await uploadPropertyPhoto(actor, id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "host.photos.upload");
  }
}

export const dynamic = "force-dynamic";
