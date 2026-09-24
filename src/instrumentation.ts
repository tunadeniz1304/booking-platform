/**
 * Next.js sunucu başlangıç kancası (yalnızca Node runtime).
 * - OpenTelemetry (OTEL_EXPORTER_OTLP_ENDPOINT varsa)
 * - Başlangıç logu: `LLM: CANLI (...)` veya `LLM: DEMO modu`
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerTracing } = await import("@/lib/observability/tracing");
    await registerTracing("booking-web");
    const { logLlmStartup } = await import("@/lib/llm/startup");
    logLlmStartup("web");
  }
}
