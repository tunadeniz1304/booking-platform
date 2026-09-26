import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { getClaimEvidence } from "@/lib/resolution/claims";

/**
 * Kanıt dosyası (yalnız taraflar + yönetici). İçerik tipi sunucunun belirlediği değerdir;
 * `nosniff` + CSP sandbox; PDF indirme olarak verilir (tarayıcıda gömülü çalışmaz).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; evidenceId: string }> }
) {
  try {
    const { id, evidenceId } = await params;
    const actor = await requireAuth(req);
    const file = await getClaimEvidence(actor, id, evidenceId);
    const pdf = file.contentType === "application/pdf";
    const name = `evidence-${evidenceId}.${pdf ? "pdf" : "webp"}`;
    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.data.byteLength),
        "content-disposition": `${pdf ? "attachment" : "inline"}; filename="${name}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, max-age=300",
        etag: `"${file.sha256}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error, "claims.evidence.get");
  }
}

export const dynamic = "force-dynamic";
