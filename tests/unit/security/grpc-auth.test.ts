import { describe, it, expect, vi } from "vitest";
import * as grpc from "@grpc/grpc-js";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { authenticateMetadata, resolveRequester, GrpcAuthError } from "../../../services/grpc/auth";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";

function metadataWith(value?: string): grpc.Metadata {
  const m = new grpc.Metadata();
  if (value) m.set("authorization", value);
  return m;
}

describe("regression: #1 gRPC kimlik doğrulaması", () => {
  it("token'sız çağrı UNAUTHENTICATED", async () => {
    await expect(authenticateMetadata(metadataWith())).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    });
    await expect(authenticateMetadata(metadataWith("Bearer bozuk"))).rejects.toBeInstanceOf(
      GrpcAuthError
    );
  });

  it("geçerli token → iddialar", async () => {
    const { token } = await signAccessToken("u1", "USER", 900);
    const claims = await authenticateMetadata(metadataWith(`Bearer ${token}`));
    expect(claims.userId).toBe("u1");
  });

  it("requester_id token'dan türetilir; farklı id → PERMISSION_DENIED", async () => {
    const { token } = await signAccessToken("u1", "USER", 900);
    const claims = (await verifyAccessToken(token))!;
    expect(resolveRequester(claims, "")).toBe("u1");
    expect(resolveRequester(claims, "u1")).toBe("u1");
    expect(() => resolveRequester(claims, "baskasi")).toThrow(GrpcAuthError);
    try {
      resolveRequester(claims, "baskasi");
    } catch (e) {
      expect((e as GrpcAuthError).code).toBe(grpc.status.PERMISSION_DENIED);
    }
  });
});
