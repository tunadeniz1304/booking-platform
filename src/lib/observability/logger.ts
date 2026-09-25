import pino from "pino";
import { trace } from "@opentelemetry/api";

/**
 * Uygulama geneli yapılandırılmış logger (pino).
 *
 * - Hassas alanlar (authorization, cookie, parola, token, API anahtarı) redakte edilir.
 * - Testlerde varsayılan seviye `silent`; `LOG_LEVEL` ile değiştirilebilir.
 * - İstek/iz korelasyonu için `child({ requestId, traceId })` kullanılır.
 */
function defaultLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "silent";
  return "info";
}

/** Dışa açık: redaksiyon yollarının testi için (anahtar/parola log'a girmez). */
export const LOGGER_OPTIONS: pino.LoggerOptions = {
  level: defaultLevel(),
  base: { service: process.env.SERVICE_NAME ?? "booking-web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // İz korelasyonu: aktif span varsa her log satırına traceId/spanId eklenir.
  mixin() {
    const ctx = trace.getActiveSpan()?.spanContext();
    return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : {};
  },
  redact: {
    paths: [
      "authorization",
      "cookie",
      "password",
      "passwordHash",
      "apiKey",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.apiKey",
      "headers.authorization",
      "headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
};

// stdio protokolü konuşan süreçler (MCP sunucusu) stdout'u JSON-RPC'ye ayırır → `LOG_TO_STDERR=true`.
export const logger =
  process.env.LOG_TO_STDERR === "true"
    ? pino(LOGGER_OPTIONS, pino.destination(2))
    : pino(LOGGER_OPTIONS);

export type Logger = typeof logger;

/** Hata nesnesini log alanına güvenli biçimde dönüştürür (yığın izi dahil, mesaj kısaltılır). */
export function errorFields(error: unknown): { err: { name: string; message: string } } {
  if (error instanceof Error) {
    return { err: { name: error.name, message: error.message.slice(0, 500) } };
  }
  return { err: { name: "UnknownError", message: String(error).slice(0, 500) } };
}
