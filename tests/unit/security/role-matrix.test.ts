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
import * as hostPayouts from "@/app/api/host/payouts/route";
import * as adminPayouts from "@/app/api/admin/payouts/route";
import * as adminPayoutPause from "@/app/api/admin/payouts/[userId]/route";
import * as hostPhotos from "@/app/api/host/properties/[id]/photos/route";
import * as hostPhoto from "@/app/api/host/properties/[id]/photos/[photoId]/route";
import * as accountSessions from "@/app/api/account/sessions/route";
import * as accountIdentity from "@/app/api/account/identity/route";
import * as hostPartyRisk from "@/app/api/host/trust/party-risk/route";
import * as adminTakedowns from "@/app/api/admin/takedowns/route";
import * as adminTakedown from "@/app/api/admin/takedowns/[id]/route";
import * as hostA11y from "@/app/api/host/properties/[id]/accessibility/route";
import * as hostA11yFeature from "@/app/api/host/properties/[id]/accessibility/[featureId]/route";
import * as adminA11y from "@/app/api/admin/accessibility/route";
import * as adminA11yVerify from "@/app/api/admin/accessibility/[id]/route";
import * as hostPromotions from "@/app/api/host/promotions/route";
import * as hostPromotion from "@/app/api/host/promotions/[id]/route";
import * as couponValidate from "@/app/api/coupons/validate/route";
import * as adminNotices from "@/app/api/admin/notices/route";
import * as adminNotice from "@/app/api/admin/notices/[id]/route";
import * as adminTransparency from "@/app/api/admin/compliance/transparency/route";
import * as itinerary from "@/app/api/itinerary/route";
import * as pushSubscription from "@/app/api/push/subscription/route";
import * as bookings from "@/app/api/bookings/route";
import * as claimsRoute from "@/app/api/claims/route";
import * as claimById from "@/app/api/claims/[id]/route";
import * as adminClaims from "@/app/api/admin/claims/route";
import * as adminClaimDecision from "@/app/api/admin/claims/[id]/decision/route";
import * as hostDeposit from "@/app/api/host/properties/[id]/deposit/route";
import * as account from "@/app/api/account/route";
import * as listingCopy from "@/app/api/ai/listing-copy/route";
import * as mailbox from "@/app/api/dev/mailbox/route";
import * as cart from "@/app/api/cart/route";
import * as cartItems from "@/app/api/cart/items/route";
import * as cartItem from "@/app/api/cart/items/[itemId]/route";
import * as cartById from "@/app/api/cart/[id]/route";
import * as cartHold from "@/app/api/cart/[id]/hold/route";
import * as cartRelease from "@/app/api/cart/[id]/release/route";
import * as cartPay from "@/app/api/cart/[id]/pay/route";
import * as cartPayConfirm from "@/app/api/cart/[id]/pay/confirm/route";
import * as cartReopen from "@/app/api/cart/reopen/route";
import * as cartSplit from "@/app/api/cart/[id]/split/route";
import * as cartSplitInvite from "@/app/api/cart/[id]/split/shares/[shareId]/invite/route";
import * as payShare from "@/app/api/pay/share/[token]/route";
import * as payShareConfirm from "@/app/api/pay/share/[token]/confirm/route";

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>;
const ctx = { params: Promise.resolve({ id: "x", roomId: "x", shareId: "x", token: "x" }) };
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
  ["GET /api/host/payouts", "GET", hostPayouts.GET as unknown as Handler, HOST_ADMIN],
  ["POST /api/host/payouts", "POST", hostPayouts.POST as unknown as Handler, HOST_ADMIN],
  ["GET /api/admin/payouts", "GET", adminPayouts.GET as unknown as Handler, ["ADMIN"]],
  [
    "POST /api/admin/payouts/[userId]",
    "POST",
    adminPayoutPause.POST as unknown as Handler,
    ["ADMIN"],
  ],
  ["GET /api/account/sessions", "GET", accountSessions.GET as unknown as Handler, ALL],
  ["GET /api/account/identity", "GET", accountIdentity.GET as unknown as Handler, ALL],
  ["GET /api/host/trust/party-risk", "GET", hostPartyRisk.GET as unknown as Handler, HOST_ADMIN],
  ["GET /api/admin/takedowns", "GET", adminTakedowns.GET as unknown as Handler, ["ADMIN"]],
  ["POST /api/admin/takedowns", "POST", adminTakedowns.POST as unknown as Handler, ["ADMIN"]],
  ["POST /api/admin/takedowns/[id]", "POST", adminTakedown.POST as unknown as Handler, ["ADMIN"]],
  ["GET /api/admin/accessibility", "GET", adminA11y.GET as unknown as Handler, ["ADMIN"]],
  [
    "POST /api/admin/accessibility/[id]",
    "POST",
    adminA11yVerify.POST as unknown as Handler,
    ["ADMIN"],
  ],
  [
    "GET /api/host/properties/[id]/accessibility",
    "GET",
    hostA11y.GET as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "POST /api/host/properties/[id]/accessibility",
    "POST",
    hostA11y.POST as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "PATCH /api/host/properties/[id]/accessibility/[featureId]",
    "PATCH",
    hostA11yFeature.PATCH as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "DELETE /api/host/properties/[id]/accessibility/[featureId]",
    "DELETE",
    hostA11yFeature.DELETE as unknown as Handler,
    HOST_ADMIN,
  ],
  ["GET /api/host/promotions", "GET", hostPromotions.GET as unknown as Handler, HOST_ADMIN],
  ["POST /api/host/promotions", "POST", hostPromotions.POST as unknown as Handler, HOST_ADMIN],
  [
    "PATCH /api/host/promotions/[id]",
    "PATCH",
    hostPromotion.PATCH as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "DELETE /api/host/promotions/[id]",
    "DELETE",
    hostPromotion.DELETE as unknown as Handler,
    HOST_ADMIN,
  ],
  ["POST /api/coupons/validate", "POST", couponValidate.POST as unknown as Handler, ALL],
  ["GET /api/admin/notices", "GET", adminNotices.GET as unknown as Handler, ["ADMIN"]],
  ["POST /api/admin/notices/[id]", "POST", adminNotice.POST as unknown as Handler, ["ADMIN"]],
  [
    "GET /api/admin/compliance/transparency",
    "GET",
    adminTransparency.GET as unknown as Handler,
    ["ADMIN"],
  ],
  ["GET /api/itinerary", "GET", itinerary.GET as unknown as Handler, ALL],
  ["GET /api/push/subscription", "GET", pushSubscription.GET as unknown as Handler, ALL],
  ["POST /api/push/subscription", "POST", pushSubscription.POST as unknown as Handler, ALL],
  ["DELETE /api/push/subscription", "DELETE", pushSubscription.DELETE as unknown as Handler, ALL],
  ["GET /api/bookings", "GET", bookings.GET as unknown as Handler, ALL],
  ["GET /api/account", "GET", account.GET as unknown as Handler, ALL],
  ["GET /api/dev/mailbox", "GET", mailbox.GET as unknown as Handler, ALL],
  // P1-1 grup sepeti: tüm uçlar oturum ister (sahiplik servis katmanında → 404).
  ["GET /api/cart", "GET", cart.GET as unknown as Handler, ALL],
  ["POST /api/cart/items", "POST", cartItems.POST as unknown as Handler, ALL],
  ["PATCH /api/cart/items/[itemId]", "PATCH", cartItem.PATCH as unknown as Handler, ALL],
  ["DELETE /api/cart/items/[itemId]", "DELETE", cartItem.DELETE as unknown as Handler, ALL],
  ["GET /api/cart/[id]", "GET", cartById.GET as unknown as Handler, ALL],
  ["DELETE /api/cart/[id]", "DELETE", cartById.DELETE as unknown as Handler, ALL],
  ["POST /api/cart/[id]/hold", "POST", cartHold.POST as unknown as Handler, ALL],
  ["POST /api/cart/[id]/release", "POST", cartRelease.POST as unknown as Handler, ALL],
  ["POST /api/cart/[id]/pay", "POST", cartPay.POST as unknown as Handler, ALL],
  ["POST /api/cart/[id]/pay/confirm", "POST", cartPayConfirm.POST as unknown as Handler, ALL],
  ["POST /api/cart/reopen", "POST", cartReopen.POST as unknown as Handler, ALL],
  // P1-2 bölünmüş ödeme: organizatör + katılımcı uçları oturum ister (link tek başına yetmez).
  ["GET /api/cart/[id]/split", "GET", cartSplit.GET as unknown as Handler, ALL],
  ["POST /api/cart/[id]/split", "POST", cartSplit.POST as unknown as Handler, ALL],
  [
    "POST /api/cart/[id]/split/shares/[shareId]/invite",
    "POST",
    cartSplitInvite.POST as unknown as Handler,
    ALL,
  ],
  ["GET /api/pay/share/[token]", "GET", payShare.GET as unknown as Handler, ALL],
  ["POST /api/pay/share/[token]", "POST", payShare.POST as unknown as Handler, ALL],
  ["POST /api/pay/share/[token]/confirm", "POST", payShareConfirm.POST as unknown as Handler, ALL],
  // P1-5 çözüm merkezi: taraf kontrolü servis katmanında (404); karar yalnız yönetici.
  ["GET /api/claims", "GET", claimsRoute.GET as unknown as Handler, ALL],
  ["POST /api/claims", "POST", claimsRoute.POST as unknown as Handler, ALL],
  ["GET /api/claims/[id]", "GET", claimById.GET as unknown as Handler, ALL],
  ["GET /api/admin/claims", "GET", adminClaims.GET as unknown as Handler, ["ADMIN"]],
  [
    "POST /api/admin/claims/[id]/decision",
    "POST",
    adminClaimDecision.POST as unknown as Handler,
    ["ADMIN"],
  ],
  [
    "GET /api/host/properties/[id]/deposit",
    "GET",
    hostDeposit.GET as unknown as Handler,
    HOST_ADMIN,
  ],
  [
    "PUT /api/host/properties/[id]/deposit",
    "PUT",
    hostDeposit.PUT as unknown as Handler,
    HOST_ADMIN,
  ],
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
