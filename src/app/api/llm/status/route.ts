import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getLlmStatus } from "@/lib/llm/status";

/**
 * LLM çalışma modu (giriş yapmış kullanıcılar). Anahtar değeri asla dönmez;
 * yalnızca `hasKey: boolean`.
 */
export async function GET(req: NextRequest) {
  if (!getUserFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(getLlmStatus());
}

export const dynamic = "force-dynamic";
