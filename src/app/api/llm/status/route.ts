import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getLlmStatus } from "@/lib/llm/status";

/**
 * LLM çalışma modu (giriş yapmış kullanıcılar). Anahtar değeri asla dönmez;
 * yalnızca `hasKey: boolean`.
 */
export async function GET(req: NextRequest) {
  if (!(await getAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(getLlmStatus());
}

export const dynamic = "force-dynamic";
