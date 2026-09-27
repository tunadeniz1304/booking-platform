import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/observability/readiness";
import { directExposureProblem } from "@/lib/security/exposure";

/**
 * Readiness: veritabanı ve Redis erişilebilir mi (trafik alma kararı için).
 * v5#6: üretimde ters vekilsiz (istemci IP'si bilinmeyen) kurulum trafik almaz → 503.
 */
export async function GET() {
  const exposure = directExposureProblem();
  if (exposure) {
    return NextResponse.json({ ready: false, code: exposure.code }, { status: 503 });
  }
  const report = await checkReadiness();
  return NextResponse.json(report, { status: report.ready ? 200 : 503 });
}

export const dynamic = "force-dynamic";
