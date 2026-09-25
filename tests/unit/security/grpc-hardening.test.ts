import { describe, it, expect, vi, beforeEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis(), getRedisConnection: () => ({}) };
});
vi.mock("@/lib/payment/payment-service", () => ({
  payForBooking: vi.fn(async () => ({
    status: "confirmed",
    bookingId: "b1",
    paymentId: "pay1",
    amount: 123456,
    currency: "TRY",
  })),
}));

import { redis } from "@/lib/redis";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import {
  createGrpcServer,
  peerKey,
  serverCredentials,
  startGrpcServer,
} from "../../../services/grpc/server";
import { clientCredentials } from "../../../services/grpc/client";
import { loadBookingV1 } from "../../../services/grpc/proto";

const fake = redis as unknown as FakeRedis;

type Unary = (
  req: unknown,
  md: grpc.Metadata,
  cb: (err: grpc.ServiceError | null, res?: Record<string, unknown>) => void
) => void;

async function withServer<T>(fn: (address: string) => Promise<T>): Promise<T> {
  const server = createGrpcServer();
  const port = await startGrpcServer(
    server,
    "127.0.0.1",
    0,
    grpc.ServerCredentials.createInsecure()
  );
  try {
    return await fn(`127.0.0.1:${port}`);
  } finally {
    server.forceShutdown();
  }
}

function charge(address: string, token: string, body: Record<string, unknown>) {
  const pkg = loadBookingV1();
  const client = new pkg.PaymentService(address, grpc.credentials.createInsecure());
  const md = new grpc.Metadata();
  md.set("authorization", `Bearer ${token}`);
  return new Promise<{ err: grpc.ServiceError | null; res?: Record<string, unknown> }>((resolve) =>
    (client as unknown as { charge: Unary }).charge(body, md, (err, res) => {
      client.close();
      resolve({ err, res });
    })
  );
}

beforeEach(() => {
  fake.store.clear();
  fake.failing = false;
  delete process.env.RATE_LIMIT_BOOKING_MAX;
  resetConfigForTests();
});

describe("regression: v3#13 gRPC sertleştirme", () => {
  it("TLS: sertifika verilmezse güvensiz, verilirse SSL kimlik bilgisi", () => {
    expect(serverCredentials({} as NodeJS.ProcessEnv)).toBeInstanceOf(grpc.ServerCredentials);
    expect(() =>
      serverCredentials({ GRPC_TLS_CERT: "/yok/cert.pem", GRPC_TLS_KEY: "/yok/key.pem" } as never)
    ).toThrow(); // dosya okunmaya çalışılır → TLS yolu etkin
    expect(clientCredentials({} as NodeJS.ProcessEnv)).toBeDefined();
    expect(() => clientCredentials({ GRPC_TLS_CA: "/yok/ca.pem" } as never)).toThrow();
  });

  it("peerKey port'u atar (IP başına kova)", () => {
    expect(peerKey("ipv4:10.1.2.3:51000")).toBe("grpc-peer:10.1.2.3");
    expect(peerKey("ipv6:[::1]:51000")).toBe("grpc-peer:::1");
  });

  it("kullanıcı başına rate limit → RESOURCE_EXHAUSTED", async () => {
    process.env.RATE_LIMIT_BOOKING_MAX = "2";
    resetConfigForTests();
    const { token } = await signAccessToken("u-grpc", "USER", 300);
    await withServer(async (address) => {
      const codes: Array<number | null> = [];
      for (let i = 0; i < 3; i++) {
        const { err } = await charge(address, token, {
          booking_id: "b1",
          card_token: "tok_mock_ok_4242",
          idempotency_key: `k${i}`,
        });
        codes.push(err?.code ?? null);
      }
      expect(codes).toEqual([null, null, grpc.status.RESOURCE_EXHAUSTED]);
    });
  });

  it("regression: v3#1 Charge idempotency_key zorunlu; tutar minor-unit + kesin ondalık (v3#9)", async () => {
    const { token } = await signAccessToken("u-grpc2", "USER", 300);
    await withServer(async (address) => {
      const missing = await charge(address, token, { booking_id: "b1", card_token: "t" });
      expect(missing.err?.code).toBe(grpc.status.INVALID_ARGUMENT);
      const ok = await charge(address, token, {
        booking_id: "b1",
        card_token: "tok_mock_ok_4242",
        idempotency_key: "x",
      });
      expect(ok.err).toBeNull();
      expect(ok.res).toMatchObject({
        status: "PAID",
        charged_amount: 1234.56,
        charged_amount_minor: "123456",
        currency: "TRY",
      });
    });
  });
});
