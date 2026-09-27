import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { logger, errorFields } from "@/lib/observability/logger";
import { isSerializationFailure } from "@/lib/db/serialization";
import { PaymentProviderError } from "@/lib/payment/provider";

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

/** E-posta adresi doğrulanmamış kullanıcı hassas bir işlem denedi (v4#6). */
export class EmailNotVerifiedError extends HttpError {
  constructor(message = "Bu işlem için e-posta adresinizi doğrulamanız gerekiyor") {
    super(403, "EMAIL_NOT_VERIFIED", message);
    this.name = "EmailNotVerifiedError";
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

export interface ErrorCatalogEntry {
  status: number;
  description: string;
}

/**
 * Genel hata kodu kataloğu (v2 P1-2): bu dosyadaki sınıfların, `toErrorResponse`'un ve
 * proxy'nin ürettiği kodlar. OpenAPI belgesi (`/api/openapi.json`) buradan beslenir; alana
 * özgü 409/422 kodları (PRICE_CHANGED, ROOM_BUSY…) ilgili işlemde belgelenir.
 */
export const ERROR_CATALOG = {
  VALIDATION_ERROR: {
    status: 400,
    description: "İstek doğrulanamadı; `details` alan hatalarını taşır",
  },
  INVALID_JSON: { status: 400, description: "Gövde geçerli JSON değil" },
  UNAUTHORIZED: { status: 401, description: "Oturum yok ya da token geçersiz" },
  FORBIDDEN: { status: 403, description: "Kaynağa ya da işleme yetki yok" },
  EMAIL_NOT_VERIFIED: { status: 403, description: "Hassas işlem için e-posta doğrulanmalı" },
  CSRF_REJECTED: { status: 403, description: "Çerezli istekte Origin doğrulanamadı" },
  NOT_FOUND: { status: 404, description: "Kayıt bulunamadı (başkasının kaydı da 404 döner)" },
  CONFLICT: { status: 409, description: "Genel durum çakışması" },
  TRANSACTION_CONFLICT: {
    status: 409,
    description: "Eşzamanlı işlem çakışması; `Retry-After` sonrası aynı Idempotency-Key ile tekrar",
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    description: "İstek gövdesi sınırı aştı (akıştan sayılır; content-length'e güvenilmez)",
  },
  INVALID_CARD_TOKEN: { status: 422, description: "Kart token'ı ödeme sağlayıcısınca reddedildi" },
  RATE_LIMITED: {
    status: 429,
    description: "İstek sınırı aşıldı; `X-RateLimit-*` başlıklarına bakın",
  },
  INTERNAL_ERROR: { status: 500, description: "Beklenmeyen hata; iç ayrıntı istemciye verilmez" },
  PAYMENT_PROVIDER_ERROR: {
    status: 502,
    description: "Ödeme sağlayıcısına ulaşılamadı; `Retry-After` sonrası tekrar denenebilir",
  },
  SERVICE_UNAVAILABLE: { status: 503, description: "Bağımlı servis geçici olarak kullanılamıyor" },
  RATE_LIMIT_UNAVAILABLE: {
    status: 503,
    description: "Rate-limit deposu (Redis) yok; güvenli tarafta kalınarak reddedildi",
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

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
  // Prisma "kayıt bulunamadı" (ör. var olmayan kimlikle update) → 404, 500 değil.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return NextResponse.json({ error: "Kayıt bulunamadı", code: "NOT_FOUND" }, { status: 404 });
  }
  // Yeniden denemeler tükendikten sonra kalan serileştirme çakışması geçicidir: 500 değil,
  // 409 + Retry-After. Aynı Idempotency-Key ile tekrar güvenlidir.
  if (isSerializationFailure(error)) {
    logger.warn({ context, ...errorFields(error) }, "serialization conflict after retries");
    return NextResponse.json(
      { error: "Eşzamanlı işlem çakışması, lütfen tekrar deneyin", code: "TRANSACTION_CONFLICT" },
      { status: 409, headers: { "Retry-After": "1" } }
    );
  }
  // P2-3 bulgusu: ödeme sağlayıcısı (PSP) hatası sunucu hatası değil, üst akış (upstream)
  // hatasıdır → 502 + sağlayıcı kodu; ödeme yeniden denenebilir. Geçersiz token istemci hatası.
  if (error instanceof PaymentProviderError) {
    if (error.code === "invalid_token") {
      return NextResponse.json(
        { error: "Kart bilgisi geçersiz", code: "INVALID_CARD_TOKEN" },
        { status: 422 }
      );
    }
    logger.warn({ context, providerCode: error.code }, "payment provider error");
    return NextResponse.json(
      {
        error: "Ödeme sağlayıcısına şu an ulaşılamıyor, lütfen tekrar deneyin",
        code: "PAYMENT_PROVIDER_ERROR",
        details: { providerCode: error.code },
      },
      { status: 502, headers: { "Retry-After": "5" } }
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
