import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { draftListingCopy } from "@/lib/ai/listing-copilot";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(await req.json());
    return NextResponse.json(await draftListingCopy(actor, propertyId));
  } catch (error) {
    return toErrorResponse(error, "ai.listing-copy");
  }
}

export const dynamic = "force-dynamic";
