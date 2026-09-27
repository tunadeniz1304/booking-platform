import { afterAll, afterEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import * as identityRoute from "@/app/api/account/identity/route";

/**
 * v5#3: üretimde (DEMO_MODE=false) Stripe Identity yapılandırılmamışsa KYC sessizce mock'a
 * düşmez — 503 KYC_UNAVAILABLE, kimse VERIFIED olmaz (PSP ile aynı fail-closed ilke).
 */
type Handler = (req: NextRequest) => Promise<Response>;
const identityGet = identityRoute.GET as unknown as Handler;
const identityPost = identityRoute.POST as unknown as Handler;

describeInt("v5#3 KYC fail-closed (regression: v5#3)", () => {
  const prisma = new PrismaClient();
  const saved = {
    DEMO_MODE: process.env.DEMO_MODE,
    KYC_PROVIDER: process.env.KYC_PROVIDER,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_IDENTITY_WEBHOOK_SECRET: process.env.STRIPE_IDENTITY_WEBHOOK_SECRET,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfigForTests();
  });
  afterAll(() => prisma.$disconnect());

  const req = (token: string, body?: unknown) =>
    new NextRequest("http://localhost/api/account/identity", {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function user() {
    const u = await prisma.user.create({
      data: {
        email: `v5kyc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@t.test`,
        passwordHash: "x",
        emailVerifiedAt: new Date(),
        firstName: "Kimlik",
        lastName: "Test",
      },
    });
    return { id: u.id, token: (await signAccessToken(u.id, "USER", 300)).token };
  }

  for (const mode of ["auto", "stripe", "mock"] as const) {
    it(`DEMO_MODE=false + Stripe yok + KYC_PROVIDER=${mode} → 503 KYC_UNAVAILABLE, VERIFIED yazılmaz`, async () => {
      process.env.DEMO_MODE = "false";
      process.env.KYC_PROVIDER = mode;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;
      resetConfigForTests();
      const u = await user();
      const res = await identityPost(req(u.token, { testDocument: "valid" }));
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("KYC_UNAVAILABLE");
      expect(await prisma.identityVerification.count({ where: { userId: u.id } })).toBe(0);
      const status = await identityGet(req(u.token));
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ status: "NOT_STARTED", testDocuments: [] });
    });
  }

  it("demo modunda mock KYC çalışmaya devam eder", async () => {
    process.env.DEMO_MODE = "true";
    delete process.env.KYC_PROVIDER;
    resetConfigForTests();
    const u = await user();
    const res = await identityPost(req(u.token, { testDocument: "valid" }));
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("VERIFIED");
  });
});
