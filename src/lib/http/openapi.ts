import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import pkg from "../../../package.json";
import { ERROR_CATALOG } from "@/lib/http/errors";
import {
  createBookingSchema,
  listBookingsQuerySchema,
  payBookingSchema,
  quoteQuerySchema,
} from "@/lib/http/api-schemas";
import { SearchParamsSchema } from "@/lib/search/params";

/**
 * Makine okunur API sözleşmesi (v2 P1-2): çekirdek misafir akışı için OpenAPI 3.1 belgesi.
 * İstek şemaları route'ların kullandığı zod şemalarından üretilir (`api-schemas.ts`,
 * `SearchParamsSchema`); belgelenen her yolun gerçek bir `route.ts`'e karşılık geldiği
 * `tests/unit/lib/openapi-contract.test.ts` ile doğrulanır. İnsan okunur ayrıntı:
 * `docs/api-contract.md`.
 */

export const OPENAPI_VERSION = "3.1.0";

type JsonSchema = Record<string, unknown>;

interface Parameter {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  description?: string;
  schema: JsonSchema;
}

/** zod → JSON Schema (OpenAPI 3.1 = JSON Schema 2020-12 uyumlu alt küme); satır içi, `$ref`siz. */
export function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  // zod nesneleri bilinmeyen alanı reddetmez, atar: `additionalProperties: false` yazılmaz.
  const out = zodToJsonSchema(schema, {
    $refStrategy: "none",
    effectStrategy: "input",
    removeAdditionalStrategy: "strict",
  });
  // Diyalekt belge düzeyinde (OpenAPI 3.1 = 2020-12); şema başına `$schema` yazılmaz.
  const rest: JsonSchema = { ...out };
  delete rest.$schema;
  return rest;
}

/** Nesne şemasının alanlarını sorgu parametrelerine açar. */
function queryParameters(
  schema: ZodTypeAny,
  opts: {
    omit?: readonly string[];
    commaSeparated?: readonly string[];
    flags?: readonly string[];
  } = {}
): Parameter[] {
  const json = toJsonSchema(schema);
  const props = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required ?? []) as string[]);
  return Object.entries(props)
    .filter(([name]) => !opts.omit?.includes(name))
    .map(([name, prop]) => {
      let paramSchema = prop;
      if (opts.commaSeparated?.includes(name)) {
        paramSchema = { type: "string", description: "Virgülle ayrılmış liste" };
      } else if (opts.flags?.includes(name)) {
        paramSchema = { type: "string", enum: ["1", "true"] };
      }
      // Varsayılanı olan alan istemci için zorunlu değildir.
      const isRequired = required.has(name) && !("default" in prop);
      return {
        name,
        in: "query" as const,
        ...(isRequired ? { required: true } : {}),
        schema: paramSchema,
      };
    });
}

const ref = (kind: "schemas" | "responses", name: string) => ({
  $ref: `#/components/${kind}/${name}`,
});

const jsonContent = (schema: JsonSchema, example?: unknown) => ({
  "application/json": { schema, ...(example !== undefined ? { example } : {}) },
});

/** Alana özgü hata kodları (genel katalog `ERROR_CATALOG`'da). */
function errorResponse(description: string, codes: readonly string[]) {
  return {
    description: `${description} Kodlar: ${codes.join(", ")}.`,
    content: jsonContent(ref("schemas", "Error")),
    "x-error-codes": codes,
  };
}

/** requestBody örnekleri; senkron testi bunları route şemasıyla parse eder. */
export const REQUEST_EXAMPLES = {
  createBooking: {
    propertyId: "prop_demo_istanbul",
    roomId: "room_demo_deluxe",
    checkIn: "2026-11-10",
    checkOut: "2026-11-13",
    guestCount: 2,
    quoteId: "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
    currency: "TRY",
  },
  payBooking: { cardToken: "tok_visa_success", creditMinor: 0 },
} as const;

/** Satır içi (`$ref`siz): istemci/ajan araçları başlığı doğrudan görsün. */
function idempotencyKey(required: boolean): Parameter {
  return {
    name: "Idempotency-Key",
    in: "header",
    required,
    description:
      "Tekrar güvenli istek anahtarı (en çok 128 karakter; UUID önerilir). Aynı anahtarla tekrar " +
      "aynı sonucu döner; farklı gövdeyle 409 IDEMPOTENCY_KEY_REUSED.",
    schema: { type: "string", minLength: 1, maxLength: 128 },
  };
}

const bookingId: Parameter = {
  name: "id",
  in: "path",
  required: true,
  description: "Rezervasyon kimliği",
  schema: { type: "string", minLength: 1 },
};

export function buildOpenApiDocument() {
  const secured = [{ bearerAuth: [] }];
  const common = {
    "400": ref("responses", "ValidationError"),
    "429": ref("responses", "RateLimited"),
    "503": ref("responses", "ServiceUnavailable"),
  };
  const authed = {
    ...common,
    "401": ref("responses", "Unauthorized"),
    "403": ref("responses", "Forbidden"),
  };

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Booking Platform API",
      version: pkg.version,
      description:
        "Çekirdek misafir akışı: arama → teklif → rezervasyon (HELD) → ödeme (CONFIRMED) → iptal. " +
        "Tutarlar minor-unit tamsayıdır. Hatalar ortak zarfla döner: `{ error, code, details? }`.",
    },
    servers: [{ url: "/" }],
    tags: [{ name: "search" }, { name: "pricing" }, { name: "bookings" }, { name: "payments" }],
    paths: {
      "/api/search": {
        get: {
          operationId: "searchProperties",
          tags: ["search"],
          summary: "Hibrit tesis araması (oturumsuz)",
          security: [],
          parameters: [
            {
              name: "destination",
              in: "query",
              description: "`query` takma adı (serbest metin, şehir/ülke/tesis adı)",
              schema: { type: "string", maxLength: 200 },
            },
            ...queryParameters(SearchParamsSchema, {
              // `userId` yalnız doğrulanmış token'dan; `country` URL'den okunmaz (searchParamsFromUrl).
              omit: ["userId", "country"],
              commaSeparated: ["amenities", "accessibility"],
              flags: ["semantic"],
            }),
          ],
          responses: {
            "200": {
              description: "Sayfalı sonuçlar; tarih verildiyse her sonuçta `quote` (minor-unit).",
              content: jsonContent(ref("schemas", "SearchResult")),
            },
            ...common,
          },
        },
      },
      "/api/quote": {
        get: {
          operationId: "createQuote",
          tags: ["pricing"],
          summary: "Fiyat teklifi (vergi dahil, 15 dk geçerli)",
          security: [],
          parameters: queryParameters(quoteQuerySchema),
          responses: {
            "200": { description: "Teklif", content: jsonContent(ref("schemas", "Quote")) },
            "404": ref("responses", "NotFound"),
            "409": errorResponse("Oda müsait değil ya da kısıt ihlali.", [
              "SOLD_OUT",
              "RESTRICTED",
            ]),
            ...common,
          },
        },
      },
      "/api/bookings": {
        get: {
          operationId: "listBookings",
          tags: ["bookings"],
          summary: "Kullanıcının rezervasyonları (cursor pagination)",
          security: secured,
          parameters: queryParameters(listBookingsQuerySchema),
          responses: {
            "200": {
              description:
                'Rezervasyon dizisi; sonraki sayfa `X-Next-Cursor` ve `Link: rel="next"` başlıklarında.',
              headers: {
                "X-Next-Cursor": { schema: { type: "string" } },
                Link: { schema: { type: "string" } },
              },
              content: jsonContent({ type: "array", items: ref("schemas", "Booking") }),
            },
            ...authed,
          },
        },
        post: {
          operationId: "createBooking",
          tags: ["bookings"],
          summary: "Rezervasyon oluştur (HELD); doğrulanmış e-posta gerekir",
          security: secured,
          parameters: [idempotencyKey(false)],
          requestBody: {
            required: true,
            content: jsonContent(toJsonSchema(createBookingSchema), REQUEST_EXAMPLES.createBooking),
          },
          responses: {
            "201": {
              description:
                "Rezervasyon oluşturuldu (HELD). Aynı Idempotency-Key + aynı gövde aynı rezervasyonu döner.",
              content: jsonContent(ref("schemas", "Booking")),
            },
            ...authed,
            "404": ref("responses", "NotFound"),
            "409": errorResponse("Rezervasyon yapılamadı.", [
              "ROOM_BUSY",
              "SOLD_OUT",
              "RESTRICTED",
              "PRICE_CHANGED",
              "QUOTE_EXPIRED",
              "COUPON_EXHAUSTED",
              "COUPON_NOT_APPLICABLE",
              "IDEMPOTENCY_KEY_REUSED",
              "TRANSACTION_CONFLICT",
            ]),
          },
        },
      },
      "/api/bookings/{id}": {
        parameters: [bookingId],
        get: {
          operationId: "getBooking",
          tags: ["bookings"],
          summary: "Rezervasyon ayrıntısı (yalnız sahibi)",
          security: secured,
          responses: {
            "200": {
              description: "Rezervasyon",
              content: jsonContent({
                type: "object",
                required: ["booking"],
                properties: { booking: ref("schemas", "Booking") },
              }),
            },
            ...authed,
            "404": ref("responses", "NotFound"),
          },
        },
        delete: {
          operationId: "cancelBooking",
          tags: ["bookings"],
          summary: "Rezervasyonu iptal et; iade tutarı rezervasyon anındaki politikaya göre",
          security: secured,
          responses: {
            "200": {
              description: "İptal edildi; iade ayrıntısıyla",
              content: jsonContent({ type: "object" }),
            },
            ...authed,
            "404": ref("responses", "NotFound"),
            "409": errorResponse("Rezervasyon bu durumda iptal edilemez.", [
              "INVALID_STATE",
              "CONCURRENT_UPDATE",
              "TRANSACTION_CONFLICT",
            ]),
            "502": ref("responses", "PaymentProviderError"),
          },
        },
      },
      "/api/bookings/{id}/pay": {
        parameters: [bookingId],
        post: {
          operationId: "payForBooking",
          tags: ["payments"],
          summary: "HELD rezervasyonun ödemesi: authorize → (3DS) → capture → CONFIRMED",
          security: secured,
          parameters: [idempotencyKey(true)],
          requestBody: {
            required: true,
            content: jsonContent(toJsonSchema(payBookingSchema), REQUEST_EXAMPLES.payBooking),
          },
          responses: {
            "200": {
              description: "Ödeme tamamlandı (`status: confirmed`)",
              content: jsonContent(ref("schemas", "PayOutcome")),
            },
            "202": {
              description: "Ek doğrulama gerekiyor (`status: requires_action`, 3DS challenge)",
              content: jsonContent(ref("schemas", "PayOutcome")),
            },
            ...authed,
            "404": ref("responses", "NotFound"),
            "409": errorResponse("Rezervasyon ödenebilir durumda değil.", [
              "HOLD_EXPIRED",
              "INVALID_STATE",
              "CONCURRENT_UPDATE",
              "TRANSACTION_CONFLICT",
            ]),
            "422": errorResponse("Kart token'ı reddedildi.", ["INVALID_CARD_TOKEN"]),
            "502": ref("responses", "PaymentProviderError"),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "`/api/auth/login` token'ı; tarayıcıda `token` httpOnly çerezi de kabul edilir.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: { type: "string", description: "İnsan okunur mesaj (Türkçe)" },
            code: { type: "string", description: "Makine kodu; bkz. `x-error-catalog`" },
            details: { description: "Koda özgü ek bilgi (ör. zod alan hataları)" },
          },
        },
        Booking: {
          type: "object",
          required: ["id", "status"],
          properties: {
            id: { type: "string" },
            status: {
              type: "string",
              enum: ["PENDING", "HELD", "CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED"],
            },
            checkIn: { type: "string" },
            checkOut: { type: "string" },
          },
        },
        Quote: {
          type: "object",
          required: ["quoteId", "roomId", "checkIn", "checkOut", "charge", "expiresAt"],
          properties: {
            quoteId: { type: "string", format: "uuid" },
            propertyId: { type: "string" },
            roomId: { type: "string" },
            checkIn: { type: "string", format: "date" },
            checkOut: { type: "string", format: "date" },
            guests: { type: "integer" },
            units: { type: "integer" },
            charge: {
              type: "object",
              required: ["currency", "total"],
              properties: {
                currency: { type: "string" },
                total: { type: "integer", description: "Vergi dahil, minor-unit" },
              },
            },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        SearchResult: { type: "object", description: "Sayfalı arama sonucu" },
        PayOutcome: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["confirmed", "requires_action"] },
            bookingId: { type: "string" },
          },
        },
      },
      responses: {
        ValidationError: errorResponse("Geçersiz istek.", ["VALIDATION_ERROR", "INVALID_JSON"]),
        Unauthorized: errorResponse("Oturum gerekli.", ["UNAUTHORIZED"]),
        Forbidden: errorResponse("Yetki yok.", [
          "FORBIDDEN",
          "EMAIL_NOT_VERIFIED",
          "CSRF_REJECTED",
        ]),
        NotFound: errorResponse("Kayıt yok.", ["NOT_FOUND"]),
        RateLimited: errorResponse("İstek sınırı aşıldı.", ["RATE_LIMITED"]),
        PaymentProviderError: errorResponse("Ödeme sağlayıcısı hatası.", [
          "PAYMENT_PROVIDER_ERROR",
        ]),
        ServiceUnavailable: errorResponse("Servis geçici olarak kullanılamıyor.", [
          "SERVICE_UNAVAILABLE",
          "RATE_LIMIT_UNAVAILABLE",
        ]),
      },
    },
    "x-error-catalog": ERROR_CATALOG,
  };
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
