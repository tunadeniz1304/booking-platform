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
import { RESPONSE_SCHEMAS } from "@/lib/http/openapi-schemas";
import { cartItemSchema } from "@/lib/cart/schemas";
import { issueMandateSchema } from "@/lib/agentic/mandate";
import {
  completeCheckoutSchema,
  createCheckoutSchema,
  updateCheckoutSchema,
} from "@/lib/agentic/checkout";
import { ucpCompleteSchema, ucpCreateSchema, ucpUpdateSchema } from "@/lib/agentic/ucp";

/**
 * Makine okunur API sözleşmesi (v2 P1-2, v5 P1-2): public + oturumlu uçlar için OpenAPI 3.1 belgesi.
 * Yanıt şemaları `openapi-schemas.ts`'te; integration testleri gerçek yanıtları onlara karşı
 * doğrular (`tests/helpers/openapi-assert.ts`). `zod-to-json-schema` bakımda değil (CHANGELOG
 * Notes): zod 4'e geçişte yerleşik `z.toJSONSchema()` ile değiştirilecek.
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

const pathId = (name: string, description: string): Parameter => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", minLength: 1 },
});

const ok = (description: string, schema: string | JsonSchema, status = "200") => ({
  [status]: {
    description,
    content: jsonContent(typeof schema === "string" ? ref("schemas", schema) : schema),
  },
});

const arrayOfRef = (name: string): JsonSchema => ({ type: "array", items: ref("schemas", name) });

/** RFC 9421 başlıkları (opsiyonel; `AGENT_HTTP_SIGNATURE_KEYS` doluysa zorunlu — ADR 0035). */
const agentSignatureHeaders: Parameter[] = [
  {
    name: "Signature-Input",
    in: "header",
    description: "RFC 9421 imza parametreleri (`@method`, `@target-uri`, `content-digest`)",
    schema: { type: "string" },
  },
  { name: "Signature", in: "header", description: "RFC 9421 imzası", schema: { type: "string" } },
  {
    name: "Content-Digest",
    in: "header",
    description: "RFC 9530 gövde özeti (gövdeli imzalı isteklerde)",
    schema: { type: "string" },
  },
];

const mandateForbidden = (codes: readonly string[]) =>
  errorResponse("Mandate yok, geçersiz, dolmuş, iptal edilmiş ya da kapsam dışı.", codes);

/**
 * v5 P1-2: misafir akışı dışındaki public + oturumlu uçlar (sepet, devir, ajan ticareti,
 * keşif belgeleri, hesap). Yanıt şemaları `openapi-schemas.ts`; integration testleri gerçek
 * gövdeleri bunlara karşı doğrular.
 */
function extendedPaths(
  common: Record<string, unknown>,
  authed: Record<string, unknown>,
  secured: Array<Record<string, string[]>>
) {
  const agentAuthed = { ...authed, "401": ref("responses", "AgentUnauthorized") };
  const agentConflicts = {
    "402": errorResponse("Tutar mandate limitini aşıyor ya da ödeme reddedildi.", [
      "MANDATE_AMOUNT_EXCEEDED",
      "PAYMENT_DECLINED",
    ]),
    "409": errorResponse("Mandate başka checkout oturumuna bağlı ya da oturum tamamlanamaz.", [
      "MANDATE_REPLAYED",
      "INVALID_STATE",
    ]),
  };
  const checkoutId = pathId("id", "Checkout oturumu kimliği");
  const cartId = pathId("id", "Sepet kimliği");
  const propertyId = pathId("id", "İlan kimliği");
  const notFound = { "404": ref("responses", "NotFound") };
  return {
    "/api/health": {
      get: {
        operationId: "health",
        tags: ["ops"],
        summary: "Süreç canlılık kontrolü (bağımlılıkları denetlemez)",
        security: [],
        responses: { ...ok("Süreç ayakta", "Health") },
      },
    },
    "/api/ready": {
      get: {
        operationId: "readiness",
        tags: ["ops"],
        summary: "Hazırlık: veritabanı ve Redis erişimi",
        security: [],
        responses: {
          ...ok("Hazır", "Readiness"),
          ...ok("Hazır değil (bağımlılık ya da güvenli kurulum eksik)", "Readiness", "503"),
        },
      },
    },
    "/api/openapi.json": {
      get: {
        operationId: "openapi",
        tags: ["ops"],
        summary: "Bu belge (OpenAPI 3.1)",
        security: [],
        responses: { ...ok("OpenAPI belgesi", "OpenApiDocument") },
      },
    },
    "/.well-known/ucp": {
      get: {
        operationId: "ucpProfile",
        tags: ["agentic"],
        summary: "UCP keşif belgesi: yetenekler, uçlar, `jwks_uri`, mandate `alg`, RFC 9421",
        security: [],
        responses: { ...ok("UCP profili", "UcpProfile") },
      },
    },
    "/.well-known/jwks.json": {
      get: {
        operationId: "mandateJwks",
        tags: ["agentic"],
        summary: "Mandate doğrulama açık anahtarları (ES256, `kid`)",
        security: [],
        responses: {
          "200": {
            description: "JWKS (yalnız açık EC anahtarları)",
            content: { "application/jwk-set+json": { schema: ref("schemas", "Jwks") } },
          },
          "503": ref("responses", "ServiceUnavailable"),
        },
      },
    },
    "/api/locations": {
      get: {
        operationId: "listLocations",
        tags: ["search"],
        summary: "Şehir otomatik tamamlama (en çok 20)",
        security: [],
        parameters: [{ name: "q", in: "query", schema: { type: "string", maxLength: 100 } }],
        responses: { ...ok("Şehir listesi", arrayOfRef("Location")) },
      },
    },
    "/api/properties": {
      get: {
        operationId: "listProperties",
        tags: ["search"],
        summary: "İlan listesi (arama ile aynı sayfalama) ya da `popular=true` vitrini",
        security: [],
        parameters: [
          { name: "query", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "popular", in: "query", schema: { type: "string", enum: ["true"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: { ...ok("Sayfalı ilanlar", "SearchResult"), ...common },
      },
    },
    "/api/properties/{id}": {
      parameters: [propertyId],
      get: {
        operationId: "getProperty",
        tags: ["search"],
        summary: "İlan ayrıntısı (odalar ve fiyat planlarıyla)",
        security: [],
        responses: { ...ok("İlan", "PropertyDetail"), ...notFound },
      },
    },
    "/api/properties/{id}/reviews": {
      parameters: [propertyId],
      get: {
        operationId: "listReviews",
        tags: ["reviews"],
        summary: "İlan yorumları (doğrulanmış konaklama işaretiyle)",
        security: [],
        responses: { ...ok("Yorumlar", arrayOfRef("Review")) },
      },
    },
    "/api/properties/{id}/reviews/summary": {
      parameters: [propertyId],
      get: {
        operationId: "reviewSummary",
        tags: ["reviews", "llm"],
        summary: "Yorum özeti (LLM; `ai_generated: true`, alıntılar kaynak yorumlara bağlı)",
        security: [],
        responses: { ...ok("Özet", "ReviewSummary"), ...common },
      },
    },
    "/api/payments/config": {
      get: {
        operationId: "paymentsConfig",
        tags: ["payments"],
        summary: "İstemci ödeme yapılandırması (yalnız publishable anahtar)",
        security: [],
        responses: { ...ok("Sağlayıcı", "PaymentsConfig") },
      },
    },
    "/api/user/me": {
      get: {
        operationId: "me",
        tags: ["account"],
        summary: "Oturumdaki kullanıcının profili",
        security: secured,
        responses: { ...ok("Profil", "UserProfile"), "401": ref("responses", "Unauthorized") },
      },
    },
    "/api/favorites": {
      get: {
        operationId: "listFavorites",
        tags: ["account"],
        summary: "Favori ilanlar",
        security: secured,
        responses: {
          ...ok("Favoriler", arrayOfRef("Favorite")),
          "401": ref("responses", "Unauthorized"),
        },
      },
      post: {
        operationId: "addFavorite",
        tags: ["account"],
        summary: "Favoriye ekle (idempotent)",
        security: secured,
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            required: ["propertyId"],
            properties: { propertyId: { type: "string", minLength: 1 } },
          }),
        },
        responses: {
          ...ok("Favori", "Favorite", "201"),
          "401": ref("responses", "Unauthorized"),
          ...notFound,
        },
      },
    },
    "/api/transfers": {
      get: {
        operationId: "listMyTransfers",
        tags: ["transfers"],
        summary: "Kullanıcının devir ilanları (devir token'ı dönmez)",
        security: secured,
        responses: { ...ok("Devirler", arrayOfRef("MyTransfer")), ...authed },
      },
      post: {
        operationId: "listTransfer",
        tags: ["transfers"],
        summary: "CONFIRMED rezervasyonu devre çıkar; imzalı devir bağlantısı yalnız burada döner",
        security: secured,
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            required: ["bookingId", "askPriceMinor"],
            properties: {
              bookingId: { type: "string", minLength: 1 },
              askPriceMinor: { type: "integer", minimum: 1 },
            },
          }),
        },
        responses: {
          ...ok("Devir ilanı", "TransferListing", "201"),
          ...authed,
          "400": errorResponse("Geçersiz istek ya da fiyat üst sınırı aşıldı.", [
            "VALIDATION_ERROR",
            "ASK_TOO_HIGH",
          ]),
          ...notFound,
          "409": errorResponse("Rezervasyon devredilebilir durumda değil.", ["INVALID_STATE"]),
        },
      },
    },
    "/api/transfers/discover": {
      get: {
        operationId: "discoverTransfers",
        tags: ["transfers"],
        summary: "Açık devir ilanları (satıcı kimliği ve token'sız)",
        security: [],
        responses: { ...ok("İlanlar", arrayOfRef("PublicTransfer")) },
      },
    },
    "/api/cart": {
      get: {
        operationId: "getActiveCart",
        tags: ["cart"],
        summary: "Aktif sepet (yoksa `cart: null`)",
        security: secured,
        responses: { ...ok("Sepet", "CartResponse"), ...authed },
      },
    },
    "/api/cart/items": {
      post: {
        operationId: "addCartItem",
        tags: ["cart"],
        summary: "Sepete oda ekle (teklif motoruyla fiyatlanır; sepet yoksa açılır)",
        security: secured,
        requestBody: { required: true, content: jsonContent(toJsonSchema(cartItemSchema)) },
        responses: {
          ...ok("Güncel sepet", "CartResponse", "201"),
          ...authed,
          ...notFound,
          "409": errorResponse("Sepet düzenlenemez durumda.", ["INVALID_STATE"]),
        },
      },
    },
    "/api/cart/{id}": {
      parameters: [cartId],
      get: {
        operationId: "getCart",
        tags: ["cart"],
        summary: "Sepet ayrıntısı (yalnız sahibi)",
        security: secured,
        responses: { ...ok("Sepet", "CartResponse"), ...authed, ...notFound },
      },
      delete: {
        operationId: "cancelCart",
        tags: ["cart"],
        summary: "Sepeti iptal et (tutulan odalar bırakılır)",
        security: secured,
        responses: {
          ...ok("İptal edildi", "CartCancelled"),
          ...authed,
          ...notFound,
          "409": errorResponse("Sepet bu durumda iptal edilemez.", ["INVALID_STATE"]),
        },
      },
    },
    "/api/cart/{id}/hold": {
      parameters: [cartId],
      post: {
        operationId: "holdCart",
        tags: ["cart"],
        summary: "Tümü-ya-hiç tutma: tüm kalemler tek işlemde HELD",
        security: secured,
        parameters: [idempotencyKey(false)],
        responses: {
          ...ok("Tutulan sepet", "CartResponse"),
          ...authed,
          ...notFound,
          "409": errorResponse("Kalem tutulamadı ya da fiyat değişti.", [
            "SOLD_OUT",
            "PRICE_CHANGED",
            "INVALID_STATE",
          ]),
        },
      },
    },
    "/api/cart/{id}/release": {
      parameters: [cartId],
      post: {
        operationId: "releaseCart",
        tags: ["cart"],
        summary: "Tutulan odaları bırak; sepet düzenlenebilir hâle döner",
        security: secured,
        responses: {
          ...ok("Sepet", "CartResponse"),
          ...authed,
          ...notFound,
          "409": errorResponse("Sepet bu durumda bırakılamaz.", ["INVALID_STATE"]),
        },
      },
    },
    "/api/account/agent-mandates": {
      get: {
        operationId: "listAgentMandates",
        tags: ["agentic"],
        summary: "Kullanıcının verdiği AP2 mandate listesi (durum + kullanıldı mı)",
        security: secured,
        responses: { ...ok("Mandate listesi", "MandateList"), ...authed },
      },
      post: {
        operationId: "issueAgentMandate",
        tags: ["agentic"],
        summary: "Ajana harcama yetkisi ver (ES256 JWS; recent-auth gerekir)",
        security: secured,
        requestBody: { required: true, content: jsonContent(toJsonSchema(issueMandateSchema)) },
        responses: {
          ...ok("İmzalı mandate", "MandateIssued", "201"),
          ...authed,
          "403": errorResponse(
            "Yakın zamanda kimlik doğrulama ya da e-posta doğrulaması gerekli.",
            ["REAUTH_REQUIRED", "EMAIL_NOT_VERIFIED"]
          ),
        },
      },
    },
    "/api/account/agent-mandates/{nonce}": {
      parameters: [pathId("nonce", "Mandate nonce değeri")],
      delete: {
        operationId: "revokeAgentMandate",
        tags: ["agentic"],
        summary: "Mandate iptali (idempotent)",
        security: secured,
        responses: {
          ...ok("İptal edildi", {
            type: "object",
            required: ["nonce", "revokedAt"],
            properties: { nonce: { type: "string" }, revokedAt: { type: "string" } },
          }),
          ...authed,
          ...notFound,
        },
      },
    },
    "/api/agentic/checkout_sessions": {
      post: {
        operationId: "acpCreateCheckout",
        tags: ["agentic"],
        summary: "ACP checkout oturumu aç (teklif alınır; tutma tamamlamada yapılır)",
        security: secured,
        parameters: [idempotencyKey(true), ...agentSignatureHeaders],
        requestBody: { required: true, content: jsonContent(toJsonSchema(createCheckoutSchema)) },
        responses: {
          ...ok("Oturum", "AcpCheckoutSession", "201"),
          ...agentAuthed,
          ...notFound,
          "409": errorResponse("Oda müsait değil.", ["SOLD_OUT", "IDEMPOTENCY_KEY_REUSED"]),
        },
      },
    },
    "/api/agentic/checkout_sessions/{id}": {
      parameters: [checkoutId],
      get: {
        operationId: "acpGetCheckout",
        tags: ["agentic"],
        summary: "ACP oturumu (yalnız sahibi)",
        security: secured,
        parameters: agentSignatureHeaders,
        responses: { ...ok("Oturum", "AcpCheckoutSession"), ...agentAuthed, ...notFound },
      },
      post: {
        operationId: "acpUpdateCheckout",
        tags: ["agentic"],
        summary: "ACP oturumunu güncelle (tarih/misafir/oda; yeniden fiyatlanır)",
        security: secured,
        parameters: agentSignatureHeaders,
        requestBody: { required: true, content: jsonContent(toJsonSchema(updateCheckoutSchema)) },
        responses: {
          ...ok("Oturum", "AcpCheckoutSession"),
          ...agentAuthed,
          ...notFound,
          "409": errorResponse("Oturum güncellenemez.", ["INVALID_STATE", "SOLD_OUT"]),
        },
      },
    },
    "/api/agentic/checkout_sessions/{id}/complete": {
      parameters: [checkoutId],
      post: {
        operationId: "acpCompleteCheckout",
        tags: ["agentic"],
        summary: "SPT + AP2 mandate ile tamamla (aynı ödeme saga'sı); 3DS → 202",
        security: secured,
        parameters: [idempotencyKey(true), ...agentSignatureHeaders],
        requestBody: {
          required: true,
          content: jsonContent(toJsonSchema(completeCheckoutSchema)),
        },
        responses: {
          ...ok("Tamamlandı", "AcpCheckoutSession"),
          ...ok("Ek doğrulama gerekiyor (`in_progress`)", "AcpCheckoutSession", "202"),
          ...agentAuthed,
          "403": mandateForbidden([
            "MANDATE_REQUIRED",
            "MANDATE_INVALID",
            "MANDATE_EXPIRED",
            "MANDATE_REVOKED",
            "MANDATE_SUBJECT_MISMATCH",
            "MANDATE_CURRENCY_MISMATCH",
            "MANDATE_PROPERTY_MISMATCH",
          ]),
          ...notFound,
          ...agentConflicts,
        },
      },
    },
    "/api/ucp/checkout-sessions": {
      post: {
        operationId: "ucpCreateCheckout",
        tags: ["agentic"],
        summary: "UCP lodging checkout oluştur (ACP servislerine eşlenir)",
        security: secured,
        parameters: [idempotencyKey(true), ...agentSignatureHeaders],
        requestBody: { required: true, content: jsonContent(toJsonSchema(ucpCreateSchema)) },
        responses: {
          ...ok("Oturum", "UcpCheckoutSession", "201"),
          ...agentAuthed,
          ...notFound,
          "409": errorResponse("Oda müsait değil.", ["SOLD_OUT", "IDEMPOTENCY_KEY_REUSED"]),
        },
      },
    },
    "/api/ucp/checkout-sessions/{id}": {
      parameters: [checkoutId],
      get: {
        operationId: "ucpGetCheckout",
        tags: ["agentic"],
        summary: "UCP oturumu (yalnız sahibi)",
        security: secured,
        parameters: agentSignatureHeaders,
        responses: { ...ok("Oturum", "UcpCheckoutSession"), ...agentAuthed, ...notFound },
      },
      put: {
        operationId: "ucpUpdateCheckout",
        tags: ["agentic"],
        summary: "UCP oturumunu güncelle",
        security: secured,
        parameters: agentSignatureHeaders,
        requestBody: { required: true, content: jsonContent(toJsonSchema(ucpUpdateSchema)) },
        responses: {
          ...ok("Oturum", "UcpCheckoutSession"),
          ...agentAuthed,
          ...notFound,
          "409": errorResponse("Oturum güncellenemez.", ["INVALID_STATE", "SOLD_OUT"]),
        },
      },
    },
    "/api/ucp/checkout-sessions/{id}/complete": {
      parameters: [checkoutId],
      post: {
        operationId: "ucpCompleteCheckout",
        tags: ["agentic"],
        summary: "UCP tamamlama: `payment_data.credential` (SPT) + `ap2.intent_mandate`",
        security: secured,
        parameters: [idempotencyKey(true), ...agentSignatureHeaders],
        requestBody: { required: true, content: jsonContent(toJsonSchema(ucpCompleteSchema)) },
        responses: {
          ...ok("Tamamlandı", "UcpCheckoutSession"),
          ...ok("Ek doğrulama gerekiyor (`requires_escalation`)", "UcpCheckoutSession", "202"),
          ...agentAuthed,
          "403": mandateForbidden([
            "MANDATE_REQUIRED",
            "MANDATE_INVALID",
            "MANDATE_EXPIRED",
            "MANDATE_REVOKED",
          ]),
          ...notFound,
          ...agentConflicts,
        },
      },
    },
  };
}

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
        "Misafir akışı (arama → teklif → rezervasyon → ödeme → iptal), sepet, devir, ajan ticareti " +
        "(ACP/UCP + AP2 mandate), keşif belgeleri ve hesap uçları. " +
        "Tutarlar minor-unit tamsayıdır. Hatalar ortak zarfla döner: `{ error, code, details? }`.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "search" },
      { name: "pricing" },
      { name: "bookings" },
      { name: "payments" },
      { name: "transfers" },
      { name: "auth" },
      { name: "llm" },
      { name: "cart" },
      { name: "agentic" },
      { name: "account" },
      { name: "reviews" },
      { name: "ops" },
    ],
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
              content: jsonContent(ref("schemas", "CreatedBooking")),
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
              content: jsonContent(ref("schemas", "BookingDetail")),
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
              content: jsonContent(ref("schemas", "CancelOutcome")),
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
              description:
                "Ödeme tamamlandı (`status: confirmed`) ya da RNPL planlandı (`status: scheduled`, bugün 0)",
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
              "RNPL_UNAVAILABLE",
            ]),
            "402": errorResponse("Kart reddedildi; rezervasyon HELD kalır.", ["PAYMENT_DECLINED"]),
            "422": errorResponse("Kart token'ı reddedildi.", ["INVALID_CARD_TOKEN"]),
            "502": ref("responses", "PaymentProviderError"),
          },
        },
      },
      "/api/bookings/{id}/rnpl": {
        parameters: [bookingId],
        get: {
          operationId: "getRnplOffer",
          tags: ["payments"],
          summary:
            "P1-3: 'şimdi rezerve et, sonra öde' teklifi (uygunluk, vade, ücretsiz iptal bitişi)",
          security: secured,
          responses: {
            "200": {
              description: "Teklif; uygun değilse `available: false` + `reason`",
              content: jsonContent(ref("schemas", "RnplOffer")),
            },
            ...authed,
            "404": ref("responses", "NotFound"),
          },
        },
      },
      // v5#16: docs/api-contract.md'nin atladığı uçlar (gövde şemaları route'lardaki zod ile aynı).
      "/api/search/smart": {
        post: {
          operationId: "smartSearch",
          tags: ["search"],
          summary:
            "Doğal dil araması: metin → yapılandırılmış filtre + sonuç (oturumsuz, AI kovası)",
          requestBody: {
            required: true,
            content: jsonContent(
              {
                type: "object",
                required: ["text"],
                properties: { text: { type: "string", minLength: 3, maxLength: 300 } },
              },
              { text: "İstanbul'da deniz manzaralı 2 kişilik otel" }
            ),
          },
          responses: {
            "200": {
              description: "Çözümlenen filtre ve sonuçlar (`ai_generated: true`)",
              content: jsonContent(ref("schemas", "SmartSearchResult")),
            },
            ...common,
          },
        },
      },
      "/api/transfers/claim": {
        post: {
          operationId: "claimTransfer",
          tags: ["transfers"],
          summary: "Devredilen rezervasyonu imzalı bağlantı token'ı ve kartla devral",
          security: secured,
          requestBody: {
            required: true,
            content: jsonContent({
              type: "object",
              required: ["token", "cardToken"],
              properties: {
                token: { type: "string", minLength: 20, maxLength: 1000 },
                cardToken: { type: "string", minLength: 8, maxLength: 200 },
              },
            }),
          },
          responses: {
            "200": {
              description: "Devir tamamlandı",
              content: jsonContent(ref("schemas", "TransferClaimResult")),
            },
            ...authed,
            "402": errorResponse("Kart reddedildi.", ["PAYMENT_DECLINED"]),
            "404": ref("responses", "NotFound"),
            "409": errorResponse("Devir bu durumda alınamaz.", ["INVALID_STATE"]),
          },
        },
      },
      "/api/auth/refresh": {
        post: {
          operationId: "refreshSession",
          tags: ["auth"],
          summary: "Yenileme token'ı (httpOnly çerez ya da gövde) ile erişim token'ını döndür",
          requestBody: {
            required: false,
            content: jsonContent({
              type: "object",
              properties: { refreshToken: { type: "string", minLength: 10, maxLength: 200 } },
            }),
          },
          responses: {
            "200": {
              description: "Yeni erişim token'ı",
              content: jsonContent(ref("schemas", "SessionRefresh")),
            },
            ...common,
            "401": ref("responses", "Unauthorized"),
          },
        },
      },
      "/api/auth/logout": {
        post: {
          operationId: "logout",
          tags: ["auth"],
          summary:
            "Oturumu kapat: erişim token'ı denylist'e, yenileme ailesi iptal, çerezler silinir",
          responses: {
            "200": {
              description: "Çıkış yapıldı",
              content: jsonContent(ref("schemas", "Success")),
            },
            ...common,
          },
        },
      },
      "/api/llm/status": {
        get: {
          operationId: "llmStatus",
          tags: ["llm"],
          summary: "LLM çalışma modu (canlı/demo; anahtar değeri dönmez; oturum gerekir)",
          security: secured,
          responses: {
            "200": { description: "LLM durumu", content: jsonContent(ref("schemas", "LlmStatus")) },
            "401": ref("responses", "Unauthorized"),
          },
        },
      },
      ...extendedPaths(common, authed, secured),
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
        ...RESPONSE_SCHEMAS,
      },
      responses: {
        ValidationError: errorResponse("Geçersiz istek.", ["VALIDATION_ERROR", "INVALID_JSON"]),
        Unauthorized: errorResponse("Oturum gerekli.", ["UNAUTHORIZED"]),
        AgentUnauthorized: errorResponse("Oturum gerekli ya da ajan HTTP imzası geçersiz.", [
          "UNAUTHORIZED",
          "HTTP_SIGNATURE_REQUIRED",
          "HTTP_SIGNATURE_INVALID",
          "HTTP_SIGNATURE_EXPIRED",
          "HTTP_SIGNATURE_UNKNOWN_KEY",
          "HTTP_SIGNATURE_DIGEST_MISMATCH",
        ]),
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
