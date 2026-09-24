import pino from "pino";

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

export const logger = pino({
  level: defaultLevel(),
  base: { service: process.env.SERVICE_NAME ?? "booking-web" },
  timestamp: pino.stdTimeFunctions.isoTime,
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
});

export type Logger = typeof logger;

/** Hata nesnesini log alanına güvenli biçimde dönüştürür (yığın izi dahil, mesaj kısaltılır). */
export function errorFields(error: unknown): { err: { name: string; message: string } } {
  if (error instanceof Error) {
    return { err: { name: error.name, message: error.message.slice(0, 500) } };
  }
  return { err: { name: "UnknownError", message: String(error).slice(0, 500) } };
}
