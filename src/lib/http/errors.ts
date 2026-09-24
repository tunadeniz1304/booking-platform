import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * HTTP'ye eşlenen alan hataları. Route handler'lar ince kalır: iş mantığı bu
 * hataları fırlatır, `toErrorResponse` tek noktadan durum koduna çevirir.
 * 5xx yanıtlarında iç hata mesajı istemciye ASLA sızdırılmaz.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Oturum açmanız gerekiyor") {
    super(401, "UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Bu işlem için yetkiniz yok") {
    super(403, "FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Kayıt bulunamadı") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, code = "CONFLICT", details?: unknown) {
    super(409, code, message, details);
    this.name = "ConflictError";
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = "Servis geçici olarak kullanılamıyor") {
    super(503, "SERVICE_UNAVAILABLE", message);
    this.name = "ServiceUnavailableError";
  }
}

/** Hata → JSON yanıt. Bilinmeyen hatalar 500 ve genel mesajla döner (loglanır). */
export function toErrorResponse(error: unknown, context = "request"): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.status }
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Doğrulama hatası", code: "VALIDATION_ERROR", details: error.flatten() },
      { status: 400 }
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi", code: "INVALID_JSON" },
      { status: 400 }
    );
  }
  logger.error({ context, ...errorFields(error) }, "unhandled route error");
  return NextResponse.json(
    { error: "Beklenmeyen bir hata oluştu", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
