/**
 * gRPC istemcisi — dahili Node süreçleri için. Her çağrı `authorization: Bearer`
 * metadata'sı taşır (sunucu token'sız çağrıyı UNAUTHENTICATED ile reddeder).
 * Devre kesici (circuit breaker) ile sarılıdır.
 */
import { readFileSync } from "fs";
import * as grpc from "@grpc/grpc-js";
import { breakers, BreakerOpenError } from "@/lib/resilience/circuit-breaker";
import { loadBookingV1 } from "./proto";

export interface DateRange {
  start: string;
  end: string;
}

export interface RoomAvailabilityResponse {
  available: boolean;
  prices: Array<{ date: string; price: number; available: boolean }>;
  estimated_total: number;
  estimated_total_minor: string | number;
  currency: string;
  available_rooms: number;
}

export interface ReserveRoomResponse {
  booking_id: string;
  status: string;
  total_price: number;
  currency: string;
}

type Unary = (
  request: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: (err: grpc.ServiceError | null, res?: unknown) => void
) => grpc.ClientUnaryCall;

export interface GrpcClients {
  getRoomAvailability(roomId: string, range: DateRange): Promise<RoomAvailabilityResponse>;
  reserveRoom(input: {
    roomId: string;
    propertyId: string;
    range: DateRange;
    guestCount?: number;
    idempotencyKey?: string;
  }): Promise<ReserveRoomResponse>;
  close(): void;
}

/**
 * @param address `host:port`
 * @param accessToken çağrıyı yapan kullanıcının erişim token'ı (yoksa sunucu reddeder)
 */
/**
 * İstemci kimlik bilgileri: `GRPC_TLS_CA` verilirse sunucu sertifikası bu CA ile doğrulanır
 * (mTLS için `GRPC_TLS_CLIENT_CERT` / `GRPC_TLS_CLIENT_KEY`); yoksa şifresiz (yerel/iç ağ).
 */
export function clientCredentials(env: NodeJS.ProcessEnv = process.env): grpc.ChannelCredentials {
  if (!env.GRPC_TLS_CA) return grpc.credentials.createInsecure();
  return grpc.credentials.createSsl(
    readFileSync(env.GRPC_TLS_CA),
    env.GRPC_TLS_CLIENT_KEY ? readFileSync(env.GRPC_TLS_CLIENT_KEY) : null,
    env.GRPC_TLS_CLIENT_CERT ? readFileSync(env.GRPC_TLS_CLIENT_CERT) : null
  );
}

export function createGrpcClients(
  address: string,
  accessToken?: string,
  timeoutMs = 5000,
  creds: grpc.ChannelCredentials = clientCredentials()
): GrpcClients {
  const pkg = loadBookingV1();
  const inventory = new pkg.InventoryService(address, creds);
  const booking = new pkg.BookingService(address, creds);

  function call<T>(client: grpc.Client, method: string, request: unknown): Promise<T> {
    const metadata = new grpc.Metadata();
    if (accessToken) metadata.set("authorization", `Bearer ${accessToken}`);
    const fn = (client as unknown as Record<string, Unary>)[method].bind(client);
    return new Promise<T>((resolve, reject) => {
      fn(request, metadata, { deadline: Date.now() + timeoutMs }, (err, res) => {
        if (err) reject(err);
        else resolve(res as T);
      });
    });
  }

  const guarded = <T>(fn: () => Promise<T>): Promise<T> =>
    breakers.grpc.call(fn, async () => {
      throw new BreakerOpenError("grpc-internal");
    });

  return {
    getRoomAvailability: (roomId, range) =>
      guarded(() =>
        call<RoomAvailabilityResponse>(inventory, "getRoomAvailability", { room_id: roomId, range })
      ),
    reserveRoom: (input) =>
      guarded(() =>
        call<ReserveRoomResponse>(booking, "reserveRoom", {
          room_id: input.roomId,
          property_id: input.propertyId,
          range: input.range,
          guest_count: input.guestCount ?? 1,
          idempotency_key: input.idempotencyKey ?? "",
        })
      ),
    close: () => {
      inventory.close();
      booking.close();
    },
  };
}
