import { NextResponse } from "next/server";
import { publicJwks } from "@/lib/agentic/mandate-keys";
import { getConfig } from "@/lib/config/app-config";
import { toErrorResponse } from "@/lib/http/errors";

/**
 * AP2 mandate doğrulama anahtarları (v2-P1-1, ADR 0025): yalnız açık EC anahtarları (etkin +
 * rotasyondaki eskiler). Ajan/PSP mandate başlığındaki `kid` ile anahtarı buradan seçer.
 */
export function GET() {
  try {
    return NextResponse.json(publicJwks(), {
      headers: {
        "Content-Type": "application/jwk-set+json",
        "Cache-Control": `public, max-age=${getConfig().AGENT_MANDATE_JWKS_MAX_AGE_SECONDS}`,
      },
    });
  } catch (error) {
    return toErrorResponse(error, "well-known.jwks");
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
