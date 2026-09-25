import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis(), getRedisConnection: () => ({}) };
});
const db = vi.hoisted(() => ({
  policies: new Set<string>(["policy_moderate_v1"]),
  created: 0,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    cancellationPolicy: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        db.policies.has(where.id) ? { id: where.id } : null
      ),
    },
    $transaction: vi.fn(async () => {
      db.created += 1;
      return { id: "p-new" };
    }),
  },
}));

import { signAccessToken } from "@/lib/auth/tokens";
import { POST as createProperty } from "@/app/api/properties/route";

const valid = {
  title: "Deniz Manzaralı Daire",
  description: "Kadıköy'de sahile yürüme mesafesinde ferah daire.",
  propertyType: "APARTMENT",
  city: "İstanbul",
  country: "TR",
  basePrice: 2500,
  currency: "TRY",
  rooms: [{ name: "Oda", capacity: 2, bedType: "Çift" }],
};

async function post(body: unknown) {
  const { token } = await signAccessToken("host-1", "HOST", 300);
  return createProperty(
    new NextRequest("http://localhost:3000/api/properties", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  db.created = 0;
});

describe("regression: v3#8 mülk oluşturma doğrulaması", () => {
  it("desteklenmeyen para birimi 400 (500 değil) ve kayıt oluşmaz", async () => {
    const res = await post({ ...valid, currency: "XYZ" });
    expect(res.status).toBe(400);
    expect(db.created).toBe(0);
  });

  it("başlık/açıklama/oda sayısı/oda alanları üst sınırlı", async () => {
    for (const body of [
      { ...valid, title: "x".repeat(121) },
      { ...valid, description: "x".repeat(5001) },
      { ...valid, rooms: Array.from({ length: 51 }, () => valid.rooms[0]) },
      { ...valid, rooms: [{ name: "x".repeat(81), capacity: 2, bedType: "Çift" }] },
      { ...valid, rooms: [{ name: "Oda", capacity: 500, bedType: "Çift" }] },
      { ...valid, amenities: Array.from({ length: 51 }, (_, i) => `a${i}`) },
      { ...valid, basePrice: 10_000_000 },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(db.created).toBe(0);
  });

  it("var olmayan iptal politikası 400; var olan kabul", async () => {
    const bad = await post({ ...valid, cancellationPolicyId: "policy_yok" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("İptal politikası");
    const ok = await post({ ...valid, cancellationPolicyId: "policy_moderate_v1" });
    expect(ok.status).toBe(201);
    expect(db.created).toBe(1);
  });

  it("güvenilmeyen tur sayılı pazarlık ucu kaldırıldı (ADR 0016)", async () => {
    await expect(import("@/app/api/negotiate/route" as string)).rejects.toThrow();
  });
});
