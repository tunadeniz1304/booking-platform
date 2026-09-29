import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";
import { generateSchema, generateSuggestions } from "@/lib/pricing/revenue";

/** Odanın önümüzdeki geceleri için fiyat önerisi üretir (fiyat DEĞİŞMEZ; karar ev sahibinin). */
const handlePost = observed(
  "host.revenue.suggestions",
  async function postHandler(req: NextRequest) {
    try {
      const actor = await requireRole(req, ["HOST", "ADMIN"]);
      const { roomId } = generateSchema.parse(await req.json());
      const suggestions = await withAiSubject(req, () => generateSuggestions(actor, roomId));
      return NextResponse.json(markAiGenerated({ suggestions }), { status: 201 });
    } catch (error) {
      return toErrorResponse(error, "host.revenue.generate");
    }
  }
);

export async function POST(req: NextRequest) {
  return handlePost(req, undefined);
}

export const dynamic = "force-dynamic";
