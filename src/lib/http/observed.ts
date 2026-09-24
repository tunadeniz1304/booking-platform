import type { NextRequest, NextResponse } from "next/server";
import { histogram } from "@/lib/observability/metrics";
import { logger } from "@/lib/observability/logger";
import { toErrorResponse } from "./errors";

export const httpRequestDuration = histogram(
  "http_request_duration_seconds",
  "API isteği süresi (saniye)",
  ["route", "method", "status"] as const,
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
);

type Handler<C> = (req: NextRequest, ctx: C) => Promise<NextResponse | Response>;

/**
 * Route handler sarmalayıcısı: süre histogramı (route/method/status), istek logu
 * (x-request-id korelasyonu) ve yakalanmamış hataların ortak eşleyiciye yönlendirilmesi.
 */
export function observed<C>(route: string, handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const started = performance.now();
    let status = 500;
    try {
      const res = await handler(req, ctx);
      status = res.status;
      return res;
    } catch (error) {
      const res = toErrorResponse(error, route);
      status = res.status;
      return res;
    } finally {
      const seconds = (performance.now() - started) / 1000;
      httpRequestDuration.observe({ route, method: req.method, status: String(status) }, seconds);
      logger.info(
        {
          route,
          method: req.method,
          status,
          durationMs: Math.round(seconds * 1000),
          requestId: req.headers.get("x-request-id"),
        },
        "http request"
      );
    }
  };
}
