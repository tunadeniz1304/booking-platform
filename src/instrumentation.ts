/**
 * Next.js sunucu başlangıç kancası (yalnızca Node runtime).
 * - OpenTelemetry (OTEL_EXPORTER_OTLP_ENDPOINT varsa)
 * - Başlangıç logu: `LLM: CANLI (...)` veya `LLM: DEMO modu`
 * - v5#6: üretimde ters vekilsiz kurulum → ERROR logu (readiness de 503 döner)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerTracing } = await import("@/lib/observability/tracing");
    await registerTracing("booking-web");
    const { logLlmStartup } = await import("@/lib/llm/startup");
    logLlmStartup("web");
    const { logDirectExposureStartup } = await import("@/lib/security/exposure");
    logDirectExposureStartup();
  }
}
