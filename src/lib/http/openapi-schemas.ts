/**
 * OpenAPI 3.1 yanıt şemaları (v5 P1-2). Route'ların GERÇEK yanıt gövdeleri integration
 * testlerinde bu şemalara karşı doğrulanır (`tests/helpers/openapi-assert.ts`): alan adı ya da
 * tipi değişirse kontrat testi düşer. Şemalar açık uçludur (`additionalProperties` yazılmaz):
 * yeni alan eklemek kırıcı değildir, belgelenmiş alanı kaldırmak/tipini değiştirmek kırıcıdır.
 * Tutarlar minor-unit tamsayıdır (`integer`).
 */

type JsonSchema = Record<string, unknown>;

const str: JsonSchema = { type: "string" };
const int: JsonSchema = { type: "integer" };
const num: JsonSchema = { type: "number" };
const bool: JsonSchema = { type: "boolean" };
const minor: JsonSchema = { type: "integer", description: "Minor-unit tutar (kuruş/cent)" };
const currency: JsonSchema = { type: "string", pattern: "^[A-Z]{3}$" };
const dateTime: JsonSchema = { type: "string", format: "date-time" };
const day: JsonSchema = { type: "string", format: "date" };
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: "null" }] });
const arrayOf = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });

function obj(required: Record<string, JsonSchema>, optional: Record<string, JsonSchema> = {}) {
  return {
    type: "object",
    required: Object.keys(required),
    properties: { ...required, ...optional },
  };
}

const bookingStatus = {
  type: "string",
  enum: ["PENDING", "HELD", "CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED"],
};

const location = obj(
  { city: str, country: str },
  { latitude: nullable(num), longitude: nullable(num) }
);

const priceBreakdown = obj(
  { currency, subtotal: minor, total: minor, nights: arrayOf(obj({ date: day, amount: minor })) },
  { taxes: arrayOf(obj({ code: str, amount: minor })), fees: { type: "array" } }
);

const searchHit = obj(
  {
    id: str,
    title: str,
    basePriceMinor: minor,
    currency,
    location,
  },
  {
    propertyType: str,
    ratingAvg: num,
    ratingCount: int,
    amenities: { type: "array" },
    images: { type: "array" },
    availableRooms: int,
    display: obj({ amount: minor, currency }),
    quote: obj({ total: minor, currency }),
  }
);

const searchPage = {
  results: arrayOf(ref("SearchHit")),
  total: int,
  page: int,
  pageSize: int,
  totalPages: int,
};

const cartItem = obj({
  id: str,
  propertyId: str,
  propertyTitle: str,
  roomTypeId: str,
  checkIn: day,
  checkOut: day,
  nights: int,
  adults: int,
  children: int,
  quantity: int,
  totalMinor: minor,
  propertyTotalMinor: minor,
  propertyCurrency: currency,
  bookingId: nullable(str),
  bookingStatus: nullable(bookingStatus),
});

const cart = obj({
  id: str,
  status: str,
  currency,
  holdExpiresAt: nullable(dateTime),
  items: arrayOf(cartItem),
  totalMinor: minor,
  payment: nullable(obj({ status: str, failureCode: nullable(str) })),
});

const amountLine = obj({ type: str, amount: minor });

const acpSession = obj(
  {
    id: str,
    status: { type: "string", enum: ["ready_for_payment", "in_progress", "completed", "canceled"] },
    currency,
    stay: obj({ property_id: str, room_id: str, check_in: day, check_out: day, guests: int }),
    line_items: arrayOf(
      obj({ id: str, quantity: int, base_amount: minor, tax: minor, total: minor })
    ),
    totals: arrayOf(amountLine),
    order: nullable(obj({ id: str })),
    expires_at: dateTime,
    messages: { type: "array" },
  },
  { payment_provider: obj({ provider: str }), next_action: { type: "object" } }
);

const ucpSession = obj(
  {
    ucp: obj({ version: str, capabilities: arrayOf(obj({ name: str, version: str })) }),
    id: str,
    status: {
      type: "string",
      enum: ["ready_for_complete", "requires_escalation", "completed", "canceled"],
    },
    currency,
    line_items: arrayOf(
      obj({
        id: str,
        item: obj({ id: str, property_id: str }),
        quantity: int,
        totals: arrayOf(amountLine),
      })
    ),
    lodging: obj({ property_id: str, check_in: day, check_out: day, guests: int }),
    totals: arrayOf(amountLine),
    payment: obj({ handlers: arrayOf(obj({ id: str, name: str, version: str })) }),
    merchant_of_record: { const: "platform" },
    order: nullable(obj({ id: str })),
    expires_at: dateTime,
    messages: { type: "array" },
  },
  { next_action: { type: "object" } }
);

const mandateClaims = obj(
  { sub: str, aud: str, maxAmountMinor: minor, currency, expiresAt: dateTime, nonce: str },
  { propertyId: arrayOf(str) }
);

/** `components.schemas` — hepsi yanıt gövdesi şemasıdır. */
export const RESPONSE_SCHEMAS: Record<string, JsonSchema> = {
  Health: obj({ status: { const: "ok" }, uptimeSeconds: int }),
  Readiness: obj(
    { ready: bool },
    {
      code: str,
      checks: { type: "object", additionalProperties: obj({ ok: bool }, { latencyMs: num }) },
    }
  ),
  LlmStatus: obj(
    { mode: { type: "string", enum: ["live", "demo"] }, effectiveMode: str, hasKey: bool },
    { model: str, baseUrlHost: nullable(str), maxConcurrency: int, visionEnabled: bool }
  ),
  Location: obj({ city: str, country: str }),
  Favorite: obj({
    id: str,
    propertyId: str,
    createdAt: dateTime,
    property: obj({ id: str, title: str, basePriceMinor: minor, currency, location }),
  }),
  UserProfile: obj({
    id: str,
    email: { type: "string", format: "email" },
    firstName: nullable(str),
    lastName: nullable(str),
    role: { type: "string", enum: ["USER", "HOST", "ADMIN"] },
    avatarUrl: nullable(str),
    createdAt: dateTime,
  }),
  Quote: obj(
    {
      quoteId: { type: "string", format: "uuid" },
      roomId: str,
      checkIn: day,
      checkOut: day,
      currency,
      nights: arrayOf(obj({ date: day, amount: minor })),
      subtotal: minor,
      total: minor,
      charge: obj({ currency, total: { ...minor, description: "Vergi dahil, minor-unit" } }),
      expiresAt: dateTime,
    },
    {
      propertyId: str,
      guests: int,
      units: int,
      taxes: arrayOf(obj({ code: str, amount: minor, inclusive: bool })),
      fees: { type: "array" },
      discounts: { type: "array" },
      discountTotal: minor,
      lowestPrice30dMinor: nullable(minor),
    }
  ),
  CreatedBooking: obj({
    booking: obj(
      {
        id: str,
        status: bookingStatus,
        propertyId: str,
        roomId: str,
        totalMinor: minor,
        currency,
        holdExpiresAt: nullable(dateTime),
      },
      { priceBreakdown }
    ),
    paymentRequired: bool,
  }),
  Booking: obj(
    {
      id: str,
      status: bookingStatus,
      propertyId: str,
      roomId: str,
      checkIn: str,
      checkOut: str,
      guestCount: int,
      totalPriceMinor: minor,
      currency,
    },
    {
      units: int,
      holdExpiresAt: nullable(dateTime),
      priceBreakdown: nullable(priceBreakdown),
      property: obj({ id: str, title: str }),
    }
  ),
  BookingDetail: obj({
    booking: {
      allOf: [
        ref("Booking"),
        obj(
          { room: obj({ id: str, name: str }) },
          { payment: nullable(obj({ status: str }, { amountMinor: minor })) }
        ),
      ],
    },
  }),
  CancelOutcome: obj({
    bookingId: str,
    status: { const: "CANCELLED" },
    refund: obj({ refundMinor: minor, refundPercent: num, currency, reason: str }),
  }),
  PayOutcome: {
    oneOf: [
      obj({
        status: { const: "confirmed" },
        bookingId: str,
        paymentId: str,
        amount: minor,
        currency,
      }),
      obj({
        status: { const: "requires_action" },
        bookingId: str,
        challenge: obj({ type: str }, { hint: str }),
      }),
    ],
  },
  SearchHit: searchHit,
  SearchResult: obj(searchPage, { cached: bool, semantic: bool, ranking: str }),
  SmartSearchResult: obj(
    {
      ...searchPage,
      filters: obj({ ai_generated: { const: true } }),
      ai_generated: { const: true },
      llmMode: str,
    },
    { cached: bool }
  ),
  PropertyDetail: obj(
    {
      id: str,
      title: str,
      basePriceMinor: minor,
      currency,
      location: obj({ city: str, country: str }),
      rooms: arrayOf(
        obj({ id: str, name: str, maxOccupancy: int, units: int }, { ratePlans: { type: "array" } })
      ),
    },
    {
      description: str,
      propertyType: str,
      ratingAvg: num,
      ratingCount: int,
      images: { type: "array" },
      amenities: { type: "array" },
    }
  ),
  Review: obj(
    {
      id: str,
      rating: { type: "integer", minimum: 1, maximum: 5 },
      comment: nullable(str),
      createdAt: dateTime,
      author: str,
      verifiedStay: bool,
    },
    { hostReply: nullable(str), subScores: { type: "object" } }
  ),
  ReviewSummary: obj({
    summary: str,
    pros: arrayOf(str),
    cons: arrayOf(str),
    citations: arrayOf(str),
    llmMode: str,
    reviewCount: int,
    ai_generated: { const: true },
  }),
  SessionRefresh: obj({
    user: obj({ id: str, role: str }),
    accessToken: str,
    accessExpiresAt: dateTime,
  }),
  Success: obj({ success: bool }),
  TransferListing: obj({
    id: str,
    bookingId: str,
    status: { const: "LISTED" },
    askPriceMinor: minor,
    currency,
    expiresAt: dateTime,
    claimToken: str,
    claimUrl: str,
  }),
  MyTransfer: {
    ...obj(
      {
        id: str,
        bookingId: str,
        status: str,
        askPriceMinor: minor,
        currency,
        listedAt: dateTime,
        expiresAt: dateTime,
        completedAt: nullable(dateTime),
      },
      { booking: obj({ propertyId: str, checkIn: str, checkOut: str }) }
    ),
    // Devir token'ı yalnız ilan anında bir kez döner; listelerde asla.
    not: { required: ["claimToken"] },
  },
  PublicTransfer: {
    ...obj({
      id: str,
      askPriceMinor: minor,
      originalPriceMinor: minor,
      currency,
      expiresAt: dateTime,
      checkIn: str,
      checkOut: str,
      guestCount: int,
      property: obj({ id: str, title: str }, { city: nullable(str) }),
    }),
    not: { anyOf: [{ required: ["claimToken"] }, { required: ["sellerId"] }] },
  },
  TransferClaimResult: obj({
    transferId: str,
    bookingId: str,
    status: { const: "COMPLETED" },
    paidMinor: minor,
    currency,
  }),
  MandateIssued: obj({
    mandate: { type: "string", pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$" },
    claims: mandateClaims,
  }),
  MandateList: obj({
    mandates: arrayOf(
      obj({
        nonce: str,
        maxAmountMinor: minor,
        currency: str,
        expiresAt: str,
        propertyId: nullable(arrayOf(str)),
        issuedAt: dateTime,
        revokedAt: nullable(dateTime),
        status: { type: "string", enum: ["active", "expired", "revoked"] },
        used: nullable(bool),
      })
    ),
  }),
  AcpCheckoutSession: acpSession,
  UcpCheckoutSession: ucpSession,
  UcpProfile: obj({
    ucp: obj({ version: str, capabilities: arrayOf(obj({ name: str, version: str })) }),
    endpoints: obj({ checkout_sessions: str, complete: str }),
    signing: obj({
      jwks_uri: str,
      mandate_alg: { const: "ES256" },
      http_message_signatures: obj({ spec: { const: "RFC 9421" }, required: bool }),
    }),
    ap2: obj({
      intent_mandate: obj({ alg: { const: "ES256" }, jwks_uri: str, typ: str, required: bool }),
    }),
  }),
  Jwks: obj({
    keys: arrayOf({
      ...obj({
        kty: { const: "EC" },
        crv: { const: "P-256" },
        x: str,
        y: str,
        kid: str,
        alg: { const: "ES256" },
        use: { const: "sig" },
      }),
      // Özel anahtar parçası asla yayımlanmaz.
      not: { required: ["d"] },
    }),
  }),
  CartResponse: obj({ cart: nullable(cart) }),
  CartCancelled: obj({ cancelled: bool }),
  PaymentsConfig: obj({ provider: str, publishableKey: nullable(str) }),
  OpenApiDocument: obj({
    openapi: { type: "string", pattern: "^3\\.1\\." },
    info: { type: "object" },
    paths: { type: "object" },
  }),
};
