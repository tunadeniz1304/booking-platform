/**
 * Next.js sunucu başlangıç kancası (yalnızca Node runtime).
 * Başlangıç logu: `LLM: CANLI (...)` veya `LLM: DEMO modu`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logLlmStartup } = await import("@/lib/llm/startup");
    logLlmStartup("web");
  }
}
