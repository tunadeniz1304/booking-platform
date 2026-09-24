import { beforeAll, afterAll, it, expect } from "vitest";
import * as grpc from "@grpc/grpc-js";
import { PrismaClient, Prisma, BookingStatus } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { createGrpcServer, startGrpcServer } from "../../services/grpc/server";
import { loadBookingV1 } from "../../services/grpc/proto";
import { signAccessToken } from "@/lib/auth/tokens";

describeInt("regression: #1 gRPC auth (integration)", () => {
  const prisma = new PrismaClient();
  let server: grpc.Server;
  let address = "";
  let ownerId = "";
  let otherId = "";
  let bookingId = "";

  type Cb = (err: grpc.ServiceError | null, res?: Record<string, unknown>) => void;

  function charge(token: string | null, request: Record<string, unknown>) {
    const pkg = loadBookingV1();
    const client = new pkg.PaymentService(
      address,
      grpc.credentials.createInsecure()
    ) as unknown as {
      charge(req: unknown, md: grpc.Metadata, cb: Cb): void;
      close(): void;
    };
    const md = new grpc.Metadata();
    if (token) md.set("authorization", `Bearer ${token}`);
    return new Promise<{ err: grpc.ServiceError | null; res?: Record<string, unknown> }>(
      (resolve) =>
        client.charge(request, md, (err, res) => {
          client.close();
          resolve({ err, res });
        })
    );
  }

  beforeAll(async () => {
    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: { email: `grpc-o-${stamp}@t.test`, passwordHash: "x", firstName: "O", lastName: "W" },
    });
    const other = await prisma.user.create({
      data: { email: `grpc-x-${stamp}@t.test`, passwordHash: "x", firstName: "X", lastName: "Y" },
    });
    ownerId = owner.id;
    otherId = other.id;
    const location = await prisma.location.create({
      data: { city: `GrpcCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId: owner.id,
        title: "gRPC Oteli",
        description: "grpc test",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(1000),
      },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: "Oda", capacity: 2, bedType: "Çift" },
    });
    const booking = await prisma.booking.create({
      data: {
        userId: owner.id,
        propertyId: property.id,
        roomId: room.id,
        checkIn: utcDay(20),
        checkOut: utcDay(22),
        guestCount: 1,
        totalPrice: new Prisma.Decimal(2000),
        status: BookingStatus.PENDING,
      },
    });
    bookingId = booking.id;

    server = createGrpcServer();
    const port = await startGrpcServer(server, "127.0.0.1", 0);
    address = `127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server?.forceShutdown();
    await prisma.$disconnect();
  });

  it("token'sız çağrı UNAUTHENTICATED", async () => {
    const { err } = await charge(null, { booking_id: bookingId, amount: 2000 });
    expect(err?.code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("requester_id token'daki kullanıcıdan farklıysa PERMISSION_DENIED", async () => {
    const { token } = await signAccessToken(otherId, "USER", 900);
    const { err } = await charge(token, {
      booking_id: bookingId,
      amount: 2000,
      requester_id: ownerId,
    });
    expect(err?.code).toBe(grpc.status.PERMISSION_DENIED);
  });

  it("başkasının rezervasyonu için ödeme NOT_FOUND (sahiplik önce)", async () => {
    const { token } = await signAccessToken(otherId, "USER", 900);
    const { err } = await charge(token, { booking_id: bookingId, amount: 2000 });
    expect(err?.code).toBe(grpc.status.NOT_FOUND);
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    expect(payment).toBeNull();
  });

  it("sahibi kendi token'ıyla ödeyebilir", async () => {
    const { token } = await signAccessToken(ownerId, "USER", 900);
    const { err, res } = await charge(token, { booking_id: bookingId, amount: 2000 });
    expect(err).toBeNull();
    expect(res?.status).toBe("PAID");
  });
});
