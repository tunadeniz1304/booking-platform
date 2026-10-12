import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { previewClaim } from "@/lib/transfer/transfer-service";

const previewSchema = z.object({
  /** Claim bağlantısındaki imzalı token; günlüklere ve Referer'a düşmesin diye gövdede. */
  token: z.string().min(20).max(1000),
});

/**
 * Devir bağlantısının durumu (salt okunur): `ok` | `invalid` | `expired` | `gone` | `self`.
 * Alıcı kart bilgisi girmeden önce bağlantının kullanılamayacağını öğrenir. E-postası
 * doğrulanmamış kullanıcı da görür (devralma adımı ayrıca doğrulama ister).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { token } = previewSchema.parse(await req.json());
    return NextResponse.json(await previewClaim({ token, buyerId: userId }));
  } catch (error) {
    return toErrorResponse(error, "transfers.claimPreview");
  }
}

export const dynamic = "force-dynamic";
