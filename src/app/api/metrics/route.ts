import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/observability/metrics";
import { metricsAuthorized } from "@/lib/observability/metrics-auth";
// Metrik tanımları modül yüklenince kaydedilir; iş metrikleri her zaman görünsün diye içe aktarılır.
import "@/lib/booking-service";
import "@/lib/llm/metrics";
import "@/lib/http/observed";

/** Prometheus metrikleri — `Authorization: Bearer <METRICS_TOKEN>`. */
export async function GET(req: NextRequest) {
  const auth = metricsAuthorized(req.headers.get("authorization"));
  if (auth === "disabled") {
    return NextResponse.json({ error: "Metrik ucu yapılandırılmamış" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }
  return new NextResponse(await registry.metrics(), {
    headers: { "content-type": registry.contentType },
  });
}

export const dynamic = "force-dynamic";
