import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis(), getRedisConnection: () => ({}) };
});
vi.mock("@/lib/live/stats", async (orig) => {
  const actual = await orig<typeof import("@/lib/live/stats")>();
  return { ...actual, getRoomHeat: vi.fn(async () => ({ roomId: "r1" })) };
});

import { redis } from "@/lib/redis";
import { GET as metrics } from "@/app/api/metrics/route";
import { GET as live } from "@/app/api/rooms/[roomId]/live/route";
import { observed } from "@/lib/http/observed";
import { acquireConnectionSlot } from "@/lib/live/hub";
import { recordRoomView } from "@/lib/live/stats";
import { resetConfigForTests } from "@/lib/config/app-config";

const fake = redis as unknown as FakeRedis;
const TOKEN = "m".repeat(32);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

beforeEach(() => {
  fake.store.clear();
  process.env.METRICS_TOKEN = TOKEN;
  resetConfigForTests();
});

describe("P0-8 gözlemlenebilirlik", () => {
  it("/api/metrics token'sız 401, token yoksa 503, doğru token ile Prometheus metni", async () => {
    const req = (auth?: string) =>
      new NextRequest("http://localhost/api/metrics", {
        headers: auth ? { authorization: auth } : {},
      });
    expect((await metrics(req())).status).toBe(401);
    expect((await metrics(req("Bearer yanlis"))).status).toBe(401);

    await observed("test.route", async () => NextResponse.json({ ok: true }))(
      new NextRequest("http://localhost/api/x"),
      undefined
    );
    const res = await metrics(req(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const name of [
      "http_request_duration_seconds",
      "booking_created_total",
      "llm_requests_total",
    ]) {
      expect(body).toContain(name);
    }
    expect(body).toContain('route="test.route"');

    delete process.env.METRICS_TOKEN;
    expect((await metrics(req(`Bearer ${TOKEN}`))).status).toBe(503);
  });

  it("src altında console.* çağrısı yok (logger kullanılır)", () => {
    const offenders = walk(path.resolve("src")).filter((f) =>
      /\bconsole\./.test(readFileSync(f, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("dürüst isimlendirme: kodda 'quantum' / 'sentiment ai' iddiası yok", () => {
    const offenders = walk(path.resolve("src")).filter((f) =>
      /quantum|sentiment ai/i.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});

describe("regression: #11 canlı SSE sınırları", () => {
  it("tarih aralığı LIVE_MAX_RANGE_DAYS'i aşarsa 400 (DB'ye gitmeden)", async () => {
    const res = await live(
      new NextRequest("http://localhost/api/rooms/r1/live?start=2026-01-01&end=2026-12-31"),
      { params: Promise.resolve({ roomId: "r1" }) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("RANGE_TOO_LARGE");
  });

  it("IP başına bağlantı sınırı", async () => {
    process.env.LIVE_MAX_CONNECTIONS_PER_IP = "2";
    resetConfigForTests();
    expect(await acquireConnectionSlot("1.2.3.4")).not.toBeNull();
    expect(await acquireConnectionSlot("1.2.3.4")).not.toBeNull();
    expect(await acquireConnectionSlot("1.2.3.4")).toBeNull();
    expect(await acquireConnectionSlot("5.6.7.8")).not.toBeNull();
    delete process.env.LIVE_MAX_CONNECTIONS_PER_IP;
  });

  it("görüntülenme sayacı atomik ve IP başına tekil", async () => {
    expect(await recordRoomView("r1", "9.9.9.9")).toBe(true);
    expect(await recordRoomView("r1", "9.9.9.9")).toBe(false);
    expect(await recordRoomView("r1", "8.8.8.8")).toBe(true);
    expect(fake.store.get("live:room:r1:views")).toBe("2");
  });
});
