import { NextRequest, NextResponse } from "next/server";
import { ucpProfile } from "@/lib/agentic/ucp";

/** UCP keşif belgesi (P1-11): ajanlar yetenekleri, uçları ve mandate biçimini buradan öğrenir. */
export function GET(req: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  return NextResponse.json(ucpProfile(origin), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
