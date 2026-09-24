/**
 * İç gRPC servisi (web uygulamasından bağımsız süreç; başlatma: `services/grpc/main.ts`).
 *
 * Güvenlik (hata #1):
 *  - Her RPC `authorization: Bearer <JWT>` metadata'sı ister (UNAUTHENTICATED).
 *  - İşlemi yapan kullanıcı token'dan türetilir; `requester_id` yalnızca eşleşirse kabul.
 *  - Ödemede sahiplik kontrolü her şeyden (önbellek dahil) ÖNCE yapılır.
 *  - Varsayılan bind adresi `127.0.0.1`; Compose'da yalnızca iç ağda açıktır.
 */
import * as grpc from "@grpc/grpc-js";
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

/** RPC işleyicisini kimlik doğrulamasıyla sarar (sunucu tarafı interceptor). */
function authed<Req, Res>(
  handler: (request: Req, claims: AccessClaims) => Promise<Res>
): grpc.handleUnaryCall<Req, Res> {
  return (call: grpc.ServerUnaryCall<Req, Res>, callback: Callback<Res>) => {
    authenticateMetadata(call.metadata)
      .then((claims) => handler(call.request, claims))
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
    const room = await prisma.room.findUnique({
      where: { id: req.room_id },
      select: {
        property: { select: { currency: true } },
        availabilities: { where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } },
      },
    });
    if (!room) throw new GrpcAuthError(grpc.status.NOT_FOUND, "Oda bulunamadı");
    const prices = room.availabilities.map((a) => ({
      date: a.date.toISOString().slice(0, 10),
      price: Number(a.price),
      available: a.isAvailable,
    }));
    const available = prices.length > 0 && prices.every((p) => p.available);
    return {
      available,
      prices,
      estimated_total: available
        ? Math.round(prices.reduce((s, p) => s + p.price * 100, 0)) / 100
        : 0,
      currency: room.property.currency,
      available_rooms: available ? 1 : 0,
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
  }),

  Charge: authed(async (req: ChargeRequest, claims) => {
    const userId = resolveRequester(claims, req.requester_id);
    const outcome = await payForBooking({
      bookingId: req.booking_id,
      userId,
      cardToken: req.card_token || "",
      idempotencyKey: req.idempotency_key || "grpc",
    });
    return outcome.status === "confirmed"
      ? { payment_id: outcome.paymentId, status: "PAID", charged_amount: outcome.amount / 100 }
      : { payment_id: "", status: "REQUIRES_ACTION", charged_amount: 0 };
  }),
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

/** Sunucuyu verilen adreste başlatır; bağlanılan portu döndürür. */
export function startGrpcServer(server: grpc.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (err, bound) => {
      if (err) reject(err);
      else resolve(bound);
    });
  });
}
