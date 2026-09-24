import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/observability/readiness";

/** Readiness: veritabanı ve Redis erişilebilir mi (trafik alma kararı için). */
export async function GET() {
  const report = await checkReadiness();
  return NextResponse.json(report, { status: report.ready ? 200 : 503 });
}

export const dynamic = "force-dynamic";
