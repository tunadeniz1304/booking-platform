// gRPC istemcisi — dahili servis tüketicileri (Node süreçleri) için.
// Next.js Edge/middleware içinde kullanılmaz; resolver/servis modüllerinden çağrılır.
// (Circuit Breaker ile sarmalanması için `call` iç işlevine ayrılmıştır.)

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

const PROTO_PATH = path.join(__dirname, "../../proto/booking.proto");
const GRPC_HOST = process.env.GRPC_HOST ?? "localhost";
const GRPC_PORT = Number(process.env.GRPC_PORT ?? "50051");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDefinition);

export interface RoomAvailabilityRequest {
  room_id: string;
  range: { start: string; end: string };
}
export interface RoomAvailabilityResponse {
  available: boolean;
  prices: Array<{ date: string; price: number; available: boolean }>;
  estimated_total: number;
  currency: string;
  available_rooms: number;
}
export interface ReserveRoomRequest {
  room_id: string;
  property_id: string;
  range: { start: string; end: string };
  guest_count?: number;
  requester_id: string;
  idempotency_key?: string;
}
export interface ReserveRoomResponse {
  booking_id: string;
  status: string;
  total_price: number;
  currency: string;
}
export interface ChargeRequest {
  booking_id: string;
  amount?: number;
  currency?: string;
  requester_id: string;
}
export interface ChargeResponse {
  payment_id: string;
  status: string;
  charged_amount: number;
}

interface InventoryClient {
  getRoomAvailability(
    req: RoomAvailabilityRequest,
    cb: (err: grpc.ServiceError | null, res?: RoomAvailabilityResponse) => void
  ): grpc.ClientUnaryCall;
}
interface BookingClient {
  reserveRoom(
    req: ReserveRoomRequest,
    cb: (err: grpc.ServiceError | null, res?: ReserveRoomResponse) => void
  ): grpc.ClientUnaryCall;
}
interface PaymentClient {
  charge(
    req: ChargeRequest,
    cb: (err: grpc.ServiceError | null, res?: ChargeResponse) => void
  ): grpc.ClientUnaryCall;
}

type ClientConstructor<C> = new (address: string, creds: grpc.ChannelCredentials) => C;

interface ClientConstructors {
  InventoryService: ClientConstructor<InventoryClient>;
  BookingService: ClientConstructor<BookingClient>;
  PaymentService: ClientConstructor<PaymentClient>;
}

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

/** Dinamik protobuf tiplerini tek noktada daraltıyoruz (bkz. BookingV1Root). */
const bookingV1: ClientConstructors = findInRoot(proto, ["booking", "v1"]) as unknown as ClientConstructors;
if (!bookingV1?.InventoryService) {
  throw new Error("proto/booking.proto 'booking.v1' paketi yüklenemedi — proto dosyasını kontrol edin");
}

const address = `${GRPC_HOST}:${GRPC_PORT}`;
const credentials = grpc.credentials.createInsecure();

const inventoryClient: InventoryClient = new bookingV1.InventoryService(address, credentials);
const bookingClient: BookingClient = new bookingV1.BookingService(address, credentials);
const paymentClient: PaymentClient = new bookingV1.PaymentService(address, credentials);

function promisify<Req, Res>(
  call: (req: Req, cb: (err: grpc.ServiceError | null, res?: Res) => void) => void,
  req: Req,
  timeoutMs = 5000
): Promise<Res> {
  const { promise, resolve, reject } = Promise.withResolvers<Res>();
  const timer = setTimeout(() => reject(new Error("gRPC çağrı zaman aşımı")), timeoutMs);
  call(req, (err, res) => {
    clearTimeout(timer);
    if (err) {
      reject(err);
      return;
    }
    if (!res) {
      reject(new Error("gRPC yanıtı boş"));
      return;
    }
    resolve(res);
  });
  return promise;
}

/** Yalnızca istemciyi döndürür; boş bağlantı eşiğinde yeniden bağlanma ClientUnaryCall tarafından yönetilir. */
export const grpcClients = {
  inventory: inventoryClient,
  booking: bookingClient,
  payment: paymentClient,
};

export function getRoomAvailability(req: RoomAvailabilityRequest, timeoutMs?: number): Promise<RoomAvailabilityResponse> {
  return promisify(inventoryClient.getRoomAvailability.bind(inventoryClient), req, timeoutMs);
}

export function reserveRoom(req: ReserveRoomRequest, timeoutMs?: number): Promise<ReserveRoomResponse> {
  return promisify(bookingClient.reserveRoom.bind(bookingClient), req, timeoutMs);
}

export function charge(req: ChargeRequest, timeoutMs?: number): Promise<ChargeResponse> {
  return promisify(paymentClient.charge.bind(paymentClient), req, timeoutMs);
}
