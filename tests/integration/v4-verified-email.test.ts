import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken } from "@/lib/auth/tokens";
import * as bookings from "@/app/api/bookings/route";
import { POST as payPost } from "@/app/api/bookings/[id]/pay/route";
import { POST as payConfirmPost } from "@/app/api/bookings/[id]/pay/confirm/route";
import { POST as reviewPost } from "@/app/api/properties/[id]/reviews/route";
import { POST as transferPost } from "@/app/api/transfers/route";
import { POST as claimPost } from "@/app/api/transfers/claim/route";
import { POST as agenticCreate } from "@/app/api/agentic/checkout_sessions/route";
import { POST as agenticUpdate } from "@/app/api/agentic/checkout_sessions/[id]/route";
import { POST as agenticComplete } from "@/app/api/agentic/checkout_sessions/[id]/complete/route";

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/**
 * v4#6: e-posta doğrulaması para/itibar etkili uçlarda zorunlu. Doğrulanmamış hesap
 * rezervasyon/ödeme/yorum/devir/ajan checkout yapamaz (403 EMAIL_NOT_VERIFIED);
 * okuma uçları etkilenmez; doğrulama sonrası yeniden giriş gerekmez.
 */
describeInt("regression: v4#6 requireVerifiedEmail", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let unverifiedId: string;
  let token: string;

  const req = (path: string, method = "POST", body: unknown = {}) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": `v4-6-${Math.random().toString(36).slice(2)}`,
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-6", days: 30 });
    const u = await prisma.user.create({
      data: {
        email: `v4-6-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.test`,
        passwordHash: "x",
        firstName: "Doğrulanmamış",
        lastName: "Kullanıcı",
      },
    });
    unverifiedId = u.id;
    token = (await signAccessToken(u.id, "USER", 300)).token;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("regression: v4#6 doğrulanmamış hesap hassas uçlarda 403 EMAIL_NOT_VERIFIED alır", async () => {
    const cases: [string, Handler, string][] = [
      ["POST /api/bookings", bookings.POST as unknown as Handler, "/api/bookings"],
      ["POST pay", payPost as unknown as Handler, "/api/bookings/x/pay"],
      ["POST pay/confirm", payConfirmPost as unknown as Handler, "/api/bookings/x/pay/confirm"],
      [
        "POST reviews",
        reviewPost as unknown as Handler,
        `/api/properties/${fx.propertyId}/reviews`,
      ],
      ["POST /api/transfers", transferPost as unknown as Handler, "/api/transfers"],
      ["POST /api/transfers/claim", claimPost as unknown as Handler, "/api/transfers/claim"],
      [
        "POST agentic create",
        agenticCreate as unknown as Handler,
        "/api/agentic/checkout_sessions",
      ],
      [
        "POST agentic update",
        agenticUpdate as unknown as Handler,
        "/api/agentic/checkout_sessions/x",
      ],
      [
        "POST agentic complete",
        agenticComplete as unknown as Handler,
        "/api/agentic/checkout_sessions/x/complete",
      ],
    ];
    for (const [name, handler, path] of cases) {
      const res = await handler(req(path), ctx(name.includes("reviews") ? fx.propertyId : "x"));
      expect(res.status, name).toBe(403);
      expect((await res.json()).code, name).toBe("EMAIL_NOT_VERIFIED");
    }
    expect(await prisma.booking.count({ where: { userId: unverifiedId } })).toBe(0);
  });

  it("regression: v4#6 okuma uçları açık; doğrulama sonrası aynı token ile guard geçilir", async () => {
    const list = await (bookings.GET as unknown as Handler)(req("/api/bookings", "GET"), ctx(""));
    expect(list.status).toBe(200);

    await prisma.user.update({
      where: { id: unverifiedId },
      data: { emailVerifiedAt: new Date() },
    });
    const res = await (bookings.POST as unknown as Handler)(req("/api/bookings"), ctx(""));
    // Guard geçildi; boş gövde artık doğrulama hatasına düşer.
    expect(res.status).toBe(400);
    expect((await res.json()).code).not.toBe("EMAIL_NOT_VERIFIED");
  });
});
