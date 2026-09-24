import { NextResponse } from "next/server";

/** Liveness: süreç ayakta mı (bağımlılık kontrolü YOK — yeniden başlatma kararı için). */
export function GET() {
  return NextResponse.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
}

export const dynamic = "force-dynamic";
