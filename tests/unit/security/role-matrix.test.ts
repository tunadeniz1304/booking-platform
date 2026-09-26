import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis(), getRedisConnection: () => ({}) };
});
// Yetki kontrolü veritabanından ÖNCE yapılmalı: DB'ye dokunan her çağrı hata fırlatır.
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: () => {
        throw new Error("DB erişimi (yetki sonrası)");
      },
    }
  ),
}));

import { signAccessToken, type Role } from "@/lib/auth/tokens";
import * as pricing from "@/app/api/pricing/route";
import * as property from "@/app/api/properties/[id]/route";
import * as rooms from "@/app/api/properties/[id]/rooms/route";
import * as ari from "@/app/api/rooms/[roomId]/availability/route";
import * as hostProps from "@/app/api/host/properties/route";
import * as hostBookings from "@/app/api/host/bookings/route";
import * as hostRevenue from "@/app/api/host/revenue/route";
import * as revenueGenerate from "@/app/api/host/revenue/suggestions/route";
import * as revenueAccept from "@/app/api/host/revenue/suggestions/[id]/accept/route";
import * as revenueReject from "@/app/api/host/revenue/suggestions/[id]/reject/route";
import * as adminEvents from "@/app/api/admin/events/route";
import * as adminOutbox from "@/app/api/admin/outbox/route";
import * as adminFraud from "@/app/api/admin/fraud/route";
import * as adminRole from "@/app/api/admin/users/[id]/role/route";
import * as adminRefunds from "@/app/api/admin/refunds/route";
import * as adminReconciliation from "@/app/api/admin/reconciliation/route";
import * as hostPhotos from "@/app/api/host/properties/[id]/photos/route";
import * as hostPhoto from "@/app/api/host/properties/[id]/photos/[photoId]/route";
import * as accountSessions from "@/app/api/account/sessions/route";
import * as bookings from "@/app/api/bookings/route";
import * as account from "@/app/api/account/route";
import * as listingCopy from "@/app/api/ai/listing-copy/route";
import * as mailbox from "@/app/api/dev/mailbox/route";

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>;
const ctx = { params: Promise.resolve({ id: "x", roomId: "x" }) };
const ALL: Role[] = ["USER", "HOST", "ADMIN"];
const HOST_ADMIN: Role[] = ["HOST", "ADMIN"];

const MATRIX: Array<[string, string, Handler, Role[]]> = [
  ["POST /api/pricing", "POST", pricing.POST as unknown as Handler, HOST_ADMIN],
  ["PATCH /api/properties/[id]", "PATCH", property.PATCH as unknown as Handler, HOST_ADMIN],
  ["POST /api/properties/[id]/rooms", "POST", rooms.POST as unknown as Handler, HOST_ADMIN],
  ["PUT /api/rooms/[roomId]/availability", "PUT", ari.PUT as unknown as Handler, HOST_ADMIN],
  ["GET /api/host/properties", "GET", hostProps.GET as unknown as Handler, HOST_ADMIN],
  ["GET /api/host/properties/[id]/photos", "GET", hostPhotos.GET as unknown as Handler, HOST_ADMIN],
  [
    "POST /api/host/properties/[id]/photos",
    "POST",
    hostPhotos.POST as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "DELETE /api/host/properties/[id]/photos/[photoId]",
    "DELETE",
    hostPhoto.DELETE as unknown as Handler,
    HOST_ADMIN,
  ],
  ["GET /api/host/bookings", "GET", hostBookings.GET as unknown as Handler, HOST_ADMIN],
  ["GET /api/host/revenue", "GET", hostRevenue.GET as unknown as Handler, HOST_ADMIN],
  [
    "POST /api/host/revenue/suggestions",
    "POST",
    revenueGenerate.POST as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "POST /api/host/revenue/suggestions/[id]/accept",
    "POST",
    revenueAccept.POST as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "POST /api/host/revenue/suggestions/[id]/reject",
    "POST",
    revenueReject.POST as unknown as Handler,
    HOST_ADMIN,
  ],
  ["POST /api/ai/listing-copy", "POST", listingCopy.POST as unknown as Handler, HOST_ADMIN],
  ["GET /api/admin/events", "GET", adminEvents.GET as unknown as Handler, ["ADMIN"]],
  ["GET /api/admin/outbox", "GET", adminOutbox.GET as unknown as Handler, ["ADMIN"]],
  ["GET /api/admin/fraud", "GET", adminFraud.GET as unknown as Handler, ["ADMIN"]],
  ["PATCH /api/admin/users/[id]/role", "PATCH", adminRole.PATCH as unknown as Handler, ["ADMIN"]],
  ["GET /api/admin/refunds", "GET", adminRefunds.GET as unknown as Handler, ["ADMIN"]],
  ["POST /api/admin/refunds", "POST", adminRefunds.POST as unknown as Handler, ["ADMIN"]],
  [
    "GET /api/admin/reconciliation",
    "GET",
    adminReconciliation.GET as unknown as Handler,
    ["ADMIN"],
  ],
  ["GET /api/account/sessions", "GET", accountSessions.GET as unknown as Handler, ALL],
  ["GET /api/bookings", "GET", bookings.GET as unknown as Handler, ALL],
  ["GET /api/account", "GET", account.GET as unknown as Handler, ALL],
  ["GET /api/dev/mailbox", "GET", mailbox.GET as unknown as Handler, ALL],
];

async function call(h: Handler, method: string, role: Role | null): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role)
    headers.authorization = `Bearer ${(await signAccessToken(`u-${role}`, role, 900)).token}`;
  const body = method === "GET" ? undefined : JSON.stringify({});
  return (await h(new NextRequest("http://localhost/api/x", { method, headers, body }), ctx))
    .status;
}

describe("P0-6 route yetki matrisi (her route × her rol × anonim)", () => {
  for (const [name, method, handler, allowed] of MATRIX) {
    it(`${name}: anonim 401, izinsiz rol 403, izinli rol yetki kontrolünü geçer`, async () => {
      expect(await call(handler, method, null)).toBe(401);
      for (const role of ALL) {
        const status = await call(handler, method, role);
        if (allowed.includes(role)) expect([401, 403]).not.toContain(status);
        else expect(status).toBe(403);
      }
    });
  }
});
