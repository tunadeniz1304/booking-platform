import { NextRequest, NextResponse } from "next/server";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { getPublicPhoto } from "@/lib/vision/photo-service";

/** Yayındaki ilanın normalize fotoğrafı (WebP, meta verisiz). Kimlik değişmez → uzun önbellek. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const photo = await getPublicPhoto(id);
    if (!photo) throw new NotFoundError("Fotoğraf bulunamadı");
    return new NextResponse(new Uint8Array(photo.data), {
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error, "photos.get");
  }
}

export const dynamic = "force-dynamic";
