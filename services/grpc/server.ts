// Bu dosya bağımsız bir Node sürecinde çalışır (npm run grpc:server).
// Next.js uygulamasının bundle'ına dahil DEĞİLDİR; iç servis-arası iletişim
// protokolünün gerçek uygulamasıdır.

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { prisma } from "@/lib/prisma";
import { createBooking } from "@/lib/booking-service";
import { chargeBooking } from "@/lib/payment/payment-service";

const PROTO_PATH = path.join(__dirname, "../../proto/booking.proto");
const GRPC_PORT = Number(process.env.GRPC_PORT ?? "50051");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDefinition);

interface DateRange {
  start?: string;
  end?: string;
}

interface RoomAvailabilityRequest {
  room_id: string;
  range?: DateRange;
}

interface PricePoint {
  date: string;
  price: number;
  available: boolean;
}

interface RoomAvailabilityResponse {
  available: boolean;
  prices: PricePoint[];
  estimated_total: number;
  currency: string;
  available_rooms: number;
}

interface ReserveRoomRequest {
  room_id: string;
  property_id: string;
  range?: DateRange;
  guest_count?: number;
  requester_id: string;
  idempotency_key?: string;
}

interface ReserveRoomResponse {
  booking_id: string;
  status: string;
  total_price: number;
  currency: string;
}

interface ChargeRequest {
  booking_id: string;
  amount?: number;
  currency?: string;
  requester_id: string;
}

interface ChargeResponse {
  payment_id: string;
  status: string;
  charged_amount: number;
}

interface BookingV1Root {
  InventoryService: {
    service: grpc.ServiceDefinition;
  };
  BookingService: {
    service: grpc.ServiceDefinition;
  };
  PaymentService: {
    service: grpc.ServiceDefinition;
  };
}

type GrpcCallback<T> = (err: grpc.ServiceError | null, value?: T) => void;

/** Paket ağacında [booking, v1] yolunu güvenle gezer (proto-loader yuvalı döner). */
function findInRoot(root: unknown, parts: string[]): unknown {
  let node: unknown = root;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

const bookingV1: BookingV1Root = findInRoot(proto, ["booking", "v1"]) as unknown as BookingV1Root;
if (!bookingV1?.InventoryService?.service) {
  throw new Error(
    "proto/booking.proto 'booking.v1' paketi yüklenemedi — proto dosyasını kontrol edin"
  );
}

/** Tarih aralığını [start, end) UTC gece yarısı Date'lerine çevirir. */
function parseRange(range?: DateRange): { start: Date; end: Date } {
  if (!range?.start || !range?.end) {
    throw new Error("Geçersiz tarih aralığı");
  }
  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error("Geçersiz tarih aralığı");
  }
  return { start, end };
}

function toGrpcError(error: unknown): grpc.ServiceError {
  const message = (error as Error)?.message ?? "Internal error";
  const typeName = (error as Error)?.constructor?.name;
  let code = grpc.status.INTERNAL;
  if (typeName === "BookingConflictError") code = grpc.status.ABORTED;
  else if (typeName === "BookingValidationError") code = grpc.status.INVALID_ARGUMENT;
  else if (typeName === "BookingNotFoundError") code = grpc.status.NOT_FOUND;
  else if (typeName === "PaymentValidationError") code = grpc.status.INVALID_ARGUMENT;
  const serviceError = new Error(message) as grpc.ServiceError;
  serviceError.code = code;
  serviceError.details = message;
  serviceError.metadata = new grpc.Metadata();
  return serviceError;
}

// --- InventoryService ------------------------------------------------------

async function GetRoomAvailability(
  call: grpc.ServerUnaryCall<RoomAvailabilityRequest, RoomAvailabilityResponse>,
  callback: GrpcCallback<RoomAvailabilityResponse>
): Promise<void> {
  try {
    const req = call.request;
    const { start, end } = parseRange(req.range);

    const room = await prisma.room.findUnique({
      where: { id: req.room_id },
      include: { availabilities: { where: { date: { gte: start, lt: end } } } },
    });
    if (!room) {
      return callback(toGrpcError(new Error("Oda bulunamadı")));
    }

    const prices: PricePoint[] = room.availabilities
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((a) => ({
        date: a.date.toISOString().slice(0, 10),
        price: Number(a.price),
        available: a.isAvailable,
      }));

    const available = prices.length > 0 && prices.every((p) => p.available);
    const estimatedTotal = available
      ? Math.round(prices.reduce((s, p) => s + p.price, 0) * 100) / 100
      : 0;

    const property = await prisma.room
      .findUnique({ where: { id: req.room_id }, select: { propertyId: true } })
      .then((r) =>
        r
          ? prisma.property.findUnique({ where: { id: r.propertyId }, select: { currency: true } })
          : null
      );

    callback(null, {
      available,
      prices,
      estimated_total: estimatedTotal,
      currency: property?.currency ?? "TRY",
      available_rooms: available ? 1 : 0,
    });
  } catch (error) {
    callback(toGrpcError(error));
  }
}

// --- BookingService --------------------------------------------------------

async function ReserveRoom(
  call: grpc.ServerUnaryCall<ReserveRoomRequest, ReserveRoomResponse>,
  callback: GrpcCallback<ReserveRoomResponse>
): Promise<void> {
  try {
    const req = call.request;
    const result = await createBooking({
      userId: req.requester_id,
      propertyId: req.property_id,
      roomId: req.room_id,
      checkIn: req.range?.start ?? "",
      checkOut: req.range?.end ?? "",
      guestCount: req.guest_count ?? 1,
      idempotencyKey: req.idempotency_key || undefined,
    });
    callback(null, {
      booking_id: result.booking.id,
      status: result.booking.status,
      total_price: result.booking.totalPrice,
      currency: result.booking.currency,
    });
  } catch (error) {
    callback(toGrpcError(error));
  }
}

// --- PaymentService ---------------------------------------------------------

async function Charge(
  call: grpc.ServerUnaryCall<ChargeRequest, ChargeResponse>,
  callback: GrpcCallback<ChargeResponse>
): Promise<void> {
  try {
    const req = call.request;
    const payment = await chargeBooking({
      bookingId: req.booking_id,
      amount: req.amount ?? 0,
      currency: req.currency ?? "TRY",
      requesterId: req.requester_id,
      provider: "grpc-internal",
    });
    callback(null, {
      payment_id: payment.id,
      status: payment.status,
      charged_amount: payment.amount,
    });
  } catch (error) {
    callback(toGrpcError(error));
  }
}

// --- Başlatma ---------------------------------------------------------------

const server = new grpc.Server();
server.addService(bookingV1.InventoryService.service, { GetRoomAvailability });
server.addService(bookingV1.BookingService.service, { ReserveRoom });
server.addService(bookingV1.PaymentService.service, { Charge });

server.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error("[grpc] bind hatası:", err);
    process.exit(1);
  }
  console.log(`[grpc] Booking gRPC servisi ${port} portunda hazır`);
  void port;
});

process.on("SIGINT", () => {
  server.tryShutdown(() => process.exit(0));
});
process.on("SIGTERM", () => {
  server.tryShutdown(() => process.exit(0));
});
