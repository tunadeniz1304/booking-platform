import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { draftListingCopy } from "@/lib/ai/listing-copilot";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";

/** İlan metni taslağı (host onayı olmadan yayınlanmaz; AI çıktısı olarak işaretli). */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(await req.json());
    const draft = await withAiSubject(req, () => draftListingCopy(actor, propertyId));
    return NextResponse.json(markAiGenerated(draft));
  } catch (error) {
    return toErrorResponse(error, "ai.listing-copy");
  }
}

export const dynamic = "force-dynamic";
