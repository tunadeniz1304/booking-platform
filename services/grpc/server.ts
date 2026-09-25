/**
 * İç gRPC servisi (web uygulamasından bağımsız süreç; başlatma: `services/grpc/main.ts`).
 *
 * Güvenlik (hata #1):
 *  - Her RPC `authorization: Bearer <JWT>` metadata'sı ister (UNAUTHENTICATED).
 *  - İşlemi yapan kullanıcı token'dan türetilir; `requester_id` yalnızca eşleşirse kabul.
 *  - Ödemede sahiplik kontrolü her şeyden (önbellek dahil) ÖNCE yapılır.
 *  - Varsayılan bind adresi `127.0.0.1`; Compose'da yalnızca iç ağda açıktır.
 *  - v3#13: opsiyonel TLS (`GRPC_TLS_CERT` / `GRPC_TLS_KEY`, istenirse `GRPC_TLS_CA` ile
 *    karşılıklı TLS) ve interceptor tabanlı rate limit (kimlik doğrulamadan önce eş
 *    adresi, sonra kullanıcı başına; HTTP ile aynı kategoriler) → RESOURCE_EXHAUSTED.
 */
import { readFileSync } from "fs";
import * as grpc from "@grpc/grpc-js";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { checkRateLimit, type RateLimitCategory } from "@/lib/security/rate-limit";
import { computeTotal, RestrictionError, SoldOutError } from "@/lib/pricing/quote";
import { money, toDecimalString, assertCurrency } from "@/lib/money/money";
import { prisma } from "@/lib/prisma";
import { createBooking } from "@/lib/booking-service";
import { payForBooking } from "@/lib/payment/payment-service";
import { HttpError } from "@/lib/http/errors";
import { logger, errorFields } from "@/lib/observability/logger";
import type { AccessClaims } from "@/lib/auth/tokens";
import { loadBookingV1 } from "./proto";
import { applyAriMessage } from "@/lib/channel/channel";
import { assertRoomAccess } from "@/lib/host/host-service";
import { GrpcAuthError, authenticateMetadata, resolveRequester } from "./auth";

interface DateRange {
  start?: string;
  end?: string;
}

interface RoomAvailabilityRequest {
  room_id: string;
  range?: DateRange;
}

interface ReserveRoomRequest {
  room_id: string;
  property_id: string;
  range?: DateRange;
  guest_count?: number;
  requester_id?: string;
  idempotency_key?: string;
}

interface ChargeRequest {
  booking_id: string;
  requester_id?: string;
  card_token?: string;
  idempotency_key?: string;
}

type Callback<T> = (err: grpc.ServiceError | null, value?: T) => void;

function serviceError(code: grpc.status, message: string): grpc.ServiceError {
  const error = new Error(message) as grpc.ServiceError;
  error.code = code;
  error.details = message;
  error.metadata = new grpc.Metadata();
  return error;
}

/** Alan hatalarını gRPC durum kodlarına çevirir; iç hata ayrıntısı sızdırılmaz. */
export function toGrpcError(error: unknown): grpc.ServiceError {
  if (error instanceof GrpcAuthError) return serviceError(error.code, error.message);
  if (error instanceof HttpError) {
    const code =
      error.status === 400
        ? grpc.status.INVALID_ARGUMENT
        : error.status === 402
          ? grpc.status.FAILED_PRECONDITION
          : error.status === 401
            ? grpc.status.UNAUTHENTICATED
            : error.status === 403
              ? grpc.status.PERMISSION_DENIED
              : error.status === 404
                ? grpc.status.NOT_FOUND
                : error.status === 409
                  ? grpc.status.ABORTED
                  : grpc.status.INTERNAL;
    return serviceError(code, code === grpc.status.INTERNAL ? "İç hata" : error.message);
  }
  logger.error(errorFields(error), "grpc handler error");
  return serviceError(grpc.status.INTERNAL, "İç hata");
}

/** Rate limit aşımı / limit servisi yok → RESOURCE_EXHAUSTED / UNAVAILABLE. */
async function enforceRateLimit(category: RateLimitCategory, identity: string): Promise<void> {
  const decision = await checkRateLimit(redis, { category, identity, config: getConfig() });
  if (decision.unavailable) {
    throw new GrpcAuthError(grpc.status.UNAVAILABLE, "Servis geçici olarak kullanılamıyor");
  }
  if (!decision.allowed) {
    throw new GrpcAuthError(
      grpc.status.RESOURCE_EXHAUSTED,
      `Çok fazla istek; ${decision.resetSeconds} sn sonra tekrar deneyin`
    );
  }
}

/** `ipv4:1.2.3.4:5678` → `1.2.3.4` (port atılır; kova IP başına). */
export function peerKey(peer: string): string {
  const host = peer.replace(/^ipv[46]:/, "").replace(/:\d+$/, "");
  return `grpc-peer:${host.replace(/^\[|\]$/g, "")}`;
}

/**
 * RPC işleyicisini sarar (sunucu tarafı interceptor): önce eş adresi başına kimlik
 * doğrulama denemesi limiti, sonra JWT, sonra kullanıcı başına kategori limiti.
 */
function authed<Req, Res>(
  handler: (request: Req, claims: AccessClaims) => Promise<Res>,
  category: RateLimitCategory = "default"
): grpc.handleUnaryCall<Req, Res> {
  return (call: grpc.ServerUnaryCall<Req, Res>, callback: Callback<Res>) => {
    enforceRateLimit("auth", peerKey(call.getPeer()))
      .then(() => authenticateMetadata(call.metadata))
      .then(async (claims) => {
        await enforceRateLimit(category, `u:${claims.userId}`);
        return handler(call.request, claims);
      })
      .then((result) => callback(null, result))
      .catch((error: unknown) => callback(toGrpcError(error)));
  };
}

function parseRange(range?: DateRange): { start: Date; end: Date } {
  const start = new Date(`${range?.start ?? ""}T00:00:00.000Z`);
  const end = new Date(`${range?.end ?? ""}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new GrpcAuthError(grpc.status.INVALID_ARGUMENT, "Geçersiz tarih aralığı");
  }
  return { start, end };
}

const handlers = {
  GetRoomAvailability: authed(async (req: RoomAvailabilityRequest) => {
    const { start, end } = parseRange(req.range);
    const room = await prisma.roomType.findUnique({
      where: { id: req.room_id },
      select: {
        property: { select: { currency: true } },
        inventory: { where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } },
      },
    });
    if (!room) throw new GrpcAuthError(grpc.status.NOT_FOUND, "Oda bulunamadı");
    const prices = room.inventory.map((a) => ({
      date: a.date.toISOString().slice(0, 10),
      price: Number(a.price),
      available: a.sold + a.held < a.total,
    }));
    const currency = assertCurrency(room.property.currency);
    // v3#9: tahmini toplam = arama/PDP/checkout ile aynı computeTotal (oda farkı + vergiler).
    let totalMinor = 0;
    try {
      const quote = await computeTotal({
        roomId: req.room_id,
        checkIn: req.range?.start ?? "",
        checkOut: req.range?.end ?? "",
        guests: 1,
      });
      totalMinor = quote.total;
    } catch (error) {
      if (!(error instanceof SoldOutError) && !(error instanceof RestrictionError)) throw error;
    }
    const available = totalMinor > 0;
    // Aralık boyunca her gece boş kalan en az oda sayısı (sayaçlı envanter).
    const minFree = room.inventory.reduce(
      (m, a) => Math.min(m, a.total - a.sold - a.held),
      Infinity
    );
    return {
      available,
      prices,
      estimated_total: Number(toDecimalString(money(totalMinor, currency))),
      estimated_total_minor: totalMinor,
      currency,
      available_rooms: available && Number.isFinite(minFree) ? minFree : 0,
    };
  }),

  ReserveRoom: authed(async (req: ReserveRoomRequest, claims) => {
    const userId = resolveRequester(claims, req.requester_id);
    const result = await createBooking({
      userId,
      propertyId: req.property_id,
      roomId: req.room_id,
      checkIn: req.range?.start ?? "",
      checkOut: req.range?.end ?? "",
      guestCount: req.guest_count || 1,
      idempotencyKey: req.idempotency_key || undefined,
    });
    return {
      booking_id: result.booking.id,
      status: result.booking.status,
      total_price: result.booking.totalPrice,
      currency: result.booking.currency,
    };
  }, "booking"),

  Charge: authed(async (req: ChargeRequest, claims) => {
    const userId = resolveRequester(claims, req.requester_id);
    // v3#1: sabit varsayılan anahtar ("grpc") yok — her ödeme isteği kendi anahtarını taşır.
    if (!req.idempotency_key) {
      throw new GrpcAuthError(grpc.status.INVALID_ARGUMENT, "idempotency_key gerekli");
    }
    const outcome = await payForBooking({
      bookingId: req.booking_id,
      userId,
      cardToken: req.card_token || "",
      idempotencyKey: req.idempotency_key,
    });
    if (outcome.status !== "confirmed") {
      return {
        payment_id: "",
        status: "REQUIRES_ACTION",
        charged_amount: 0,
        charged_amount_minor: 0,
        currency: "",
      };
    }
    const charged = money(outcome.amount, outcome.currency);
    return {
      payment_id: outcome.paymentId,
      status: "PAID",
      // v3#9: float bölme yok — minor-unit'ten kesin ondalık dizgiye.
      charged_amount: Number(toDecimalString(charged)),
      charged_amount_minor: outcome.amount,
      currency: outcome.currency,
    };
  }, "payment"),
};

interface PushAvailabilityRequest {
  room_id: string;
  sequence: string | number;
  idempotency_key: string;
  updates: Array<{
    date: string;
    price: number;
    has_price: boolean;
    available: boolean;
    has_available: boolean;
  }>;
}

const PushAvailability = authed(async (req: PushAvailabilityRequest, claims) => {
  if (claims.role !== "HOST" && claims.role !== "ADMIN") {
    throw new GrpcAuthError(grpc.status.PERMISSION_DENIED, "Yalnızca host/admin");
  }
  await assertRoomAccess(claims, req.room_id);
  if (!req.idempotency_key)
    throw new GrpcAuthError(grpc.status.INVALID_ARGUMENT, "idempotency_key gerekli");
  const res = await applyAriMessage({
    roomId: req.room_id,
    sequence: Number(req.sequence),
    idempotencyKey: req.idempotency_key,
    updates: (req.updates ?? []).map((u) => ({
      date: u.date,
      ...(u.has_price ? { price: u.price } : {}),
      ...(u.has_available ? { available: u.available } : {}),
    })),
  });
  return { status: res.status, applied: res.applied };
});

/** Yan etkisiz sunucu oluşturucu (testler kendi portunda başlatır). */
export function createGrpcServer(): grpc.Server {
  const pkg = loadBookingV1();
  const server = new grpc.Server();
  server.addService(pkg.InventoryService.service, {
    GetRoomAvailability: handlers.GetRoomAvailability,
  });
  server.addService(pkg.BookingService.service, { ReserveRoom: handlers.ReserveRoom });
  server.addService(pkg.PaymentService.service, { Charge: handlers.Charge });
  server.addService(pkg.AriService.service, { PushAvailability });
  return server;
}

/**
 * Sunucu kimlik bilgileri (v3#13): `GRPC_TLS_CERT` + `GRPC_TLS_KEY` (PEM dosya yolları)
 * verilirse TLS; `GRPC_TLS_CA` da verilirse istemci sertifikası zorunlu (mTLS). Aksi
 * halde güvensiz kanal — yalnızca iç ağ/yerel için; production'da uyarı loglanır.
 */
export function serverCredentials(env: NodeJS.ProcessEnv = process.env): grpc.ServerCredentials {
  const certPath = env.GRPC_TLS_CERT;
  const keyPath = env.GRPC_TLS_KEY;
  if (certPath && keyPath) {
    const ca = env.GRPC_TLS_CA ? readFileSync(env.GRPC_TLS_CA) : null;
    return grpc.ServerCredentials.createSsl(
      ca,
      [{ cert_chain: readFileSync(certPath), private_key: readFileSync(keyPath) }],
      Boolean(ca)
    );
  }
  if (env.NODE_ENV === "production") {
    logger.warn("grpc: TLS yapılandırılmadı (GRPC_TLS_CERT/KEY) — kanal şifresiz");
  }
  return grpc.ServerCredentials.createInsecure();
}

/** Sunucuyu verilen adreste başlatır; bağlanılan portu döndürür. */
export function startGrpcServer(
  server: grpc.Server,
  host: string,
  port: number,
  credentials: grpc.ServerCredentials = serverCredentials()
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, credentials, (err, bound) => {
      if (err) reject(err);
      else resolve(bound);
    });
  });
}
