import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { addPricingUpdateJob } = vi.hoisted(() => ({
  addPricingUpdateJob: vi.fn(async (data: unknown) => (data ? "job-1" : undefined)),
}));

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/queue", () => ({ addPricingUpdateJob }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "room-of-h1" ? { property: { hostId: "h1", currency: "TRY" } } : null
      ),
    },
  },
}));

import { POST } from "@/app/api/pricing/route";
import { signAccessToken } from "@/lib/auth/tokens";

async function call(token: string | null, roomId = "room-of-h1") {
  return POST(
    new NextRequest("http://localhost:3000/api/pricing", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ roomId, dates: ["2026-12-01"], basePrice: 1000 }),
    })
  );
}

beforeEach(() => addPricingUpdateJob.mockClear());

describe("regression: #17 POST /api/pricing yetki", () => {
  it("anonim → 401 (500 değil)", async () => {
    expect((await call(null)).status).toBe(401);
  });

  it("USER rolü → 403", async () => {
    const { token } = await signAccessToken("u1", "USER", 900);
    expect((await call(token)).status).toBe(403);
  });

  it("başka host'un odası → 404, iş kuyruğa girmez", async () => {
    const { token } = await signAccessToken("h2", "HOST", 900);
    expect((await call(token)).status).toBe(404);
    expect(addPricingUpdateJob).not.toHaveBeenCalled();
  });

  it("kendi odası → 202 ve para birimi mülkten alınır", async () => {
    const { token } = await signAccessToken("h1", "HOST", 900);
    const res = await call(token);
    expect(res.status).toBe(202);
    expect(addPricingUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-of-h1", currency: "TRY" })
    );
  });

  it("ADMIN her oda için iş açabilir", async () => {
    const { token } = await signAccessToken("a1", "ADMIN", 900);
    expect((await call(token)).status).toBe(202);
  });
});
