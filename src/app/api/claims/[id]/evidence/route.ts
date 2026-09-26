import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getConfig } from "@/lib/config/app-config";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { uploadClaimEvidence } from "@/lib/resolution/claims";

/** Multipart gövdesinde dosya dışı alanlar için pay (sınır + başlıklar). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Kanıt yükle (multipart `file`). Tür dosya imzasından belirlenir; görseller yeniden kodlanır
 * (tüm metadata/EXIF/GPS silinir), PDF yalnız imza + boyut doğrulamasıyla kabul edilir.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth(req);
    const cfg = getConfig();
    const max = Math.max(cfg.CLAIM_EVIDENCE_MAX_BYTES, cfg.CLAIM_EVIDENCE_PDF_MAX_BYTES);
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > max + MULTIPART_OVERHEAD_BYTES) throw new ValidationError("Dosya çok büyük");
    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      throw new ValidationError("multipart/form-data gövdesi bekleniyor");
    }
    if (!file || typeof file === "string") throw new ValidationError("`file` alanı gerekli");
    if (file.size > max) throw new ValidationError("Dosya çok büyük");
    const row = await uploadClaimEvidence(actor, id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "claims.evidence.upload");
  }
}

export const dynamic = "force-dynamic";
