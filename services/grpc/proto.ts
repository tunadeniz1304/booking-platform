import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

/** `proto/booking.proto` → `booking.v1` paket ağacı (sunucu ve istemci ortak). */
export const PROTO_PATH = path.resolve(process.cwd(), "proto/booking.proto");

export interface BookingV1Package {
  InventoryService: grpc.ServiceClientConstructor;
  BookingService: grpc.ServiceClientConstructor;
  PaymentService: grpc.ServiceClientConstructor;
  AriService: grpc.ServiceClientConstructor;
}

let cached: BookingV1Package | null = null;

export function loadBookingV1(): BookingV1Package {
  if (cached) return cached;
  const definition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const root = grpc.loadPackageDefinition(definition) as unknown as {
    booking?: { v1?: BookingV1Package };
  };
  const pkg = root.booking?.v1;
  if (!pkg?.InventoryService) {
    throw new Error("proto/booking.proto 'booking.v1' paketi yüklenemedi");
  }
  cached = pkg;
  return pkg;
}
