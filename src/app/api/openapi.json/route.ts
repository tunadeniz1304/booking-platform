import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/http/openapi";
import { observed } from "@/lib/http/observed";

/**
 * Makine okunur API sözleşmesi (OpenAPI 3.1, v2 P1-2). Oturumsuz okunur
 * (`public-routes.ts`); belge statik olduğundan kısa süre önbelleklenebilir.
 */
export const GET = observed("openapi", async function getHandler() {
  return NextResponse.json(buildOpenApiDocument(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
});
