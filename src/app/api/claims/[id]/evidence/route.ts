import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getConfig } from "@/lib/config/app-config";
import { toErrorResponse } from "@/lib/http/errors";
import { readMultipartFile } from "@/lib/http/body-limit";
import { uploadClaimEvidence } from "@/lib/resolution/claims";

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
    // v5#11: gövde akıştan sayılarak okunur (content-length'e güvenilmez; aşımda 413).
    const file = await readMultipartFile(req, max);
    const row = await uploadClaimEvidence(actor, id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "claims.evidence.upload");
  }
}

export const dynamic = "force-dynamic";
