import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as forgot } from "@/app/api/auth/password/forgot/route";
import { hashPassword } from "@/lib/auth";
import { openLink } from "@/lib/auth/link-crypto";
import { solvePow, type PowChallenge } from "@/lib/auth/pow-solver";
import { resetConfigForTests } from "@/lib/config/app-config";

const ENV = {
  AUTH_LOCKOUT_THRESHOLD: "4",
  AUTH_LOGIN_FREE_FAILURES: "2",
  AUTH_LOGIN_DELAY_BASE_MS: "5000",
  AUTH_POW_DIFFICULTY_BITS: "4",
  AUTH_MIN_RESPONSE_MS: "150",
  AUTH_RESET_PER_EMAIL_MAX: "2",
  RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX: "50",
};

function post(path: string, body: unknown, ua: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua },
    body: JSON.stringify(body),
  });
}

interface LoginBody {
  code?: string;
  details?: { pow?: PowChallenge; retryAfterSeconds?: number };
}

describeInt("regression: v4#12 kilitleme DoS'u ve reset zayıflıkları", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const password = "Password123!";

  beforeAll(() => {
    Object.assign(process.env, ENV);
    resetConfigForTests();
  });
  afterAll(async () => {
    for (const key of Object.keys(ENV)) delete process.env[key];
    resetConfigForTests();
    await prisma.$disconnect();
  });

  async function makeUser(tag: string) {
    return prisma.user.create({
      data: {
        email: `v4-12-${tag}-${stamp}@t.test`,
        passwordHash: await hashPassword(password),
        firstName: "Deniz",
        lastName: "Test",
      },
    });
  }

  const attempt = (email: string, pw: string, ua: string, pow?: unknown) =>
    login(post("/api/auth/login", { email, password: pw, ...(pow ? { pow } : {}) }, ua), undefined);

  it("saldırganın başarısızlıkları hesabı kilitlemez; saldırgan çifti kademeli gecikme alır", async () => {
    const user = await makeUser("nolock");
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await attempt(user.email, "yanlis1", "attacker")).status);
    expect(statuses).toEqual([401, 401, 401]);
    const delayed = await attempt(user.email, password, "attacker");
    expect(delayed.status).toBe(429);
    const body = (await delayed.json()) as LoginBody;
    expect(body.code).toBe("LOGIN_DELAYED");
    expect(body.details?.retryAfterSeconds).toBeGreaterThan(0);

    // Başka istemcideki gerçek kullanıcı etkilenmez; hesapta kilit alanı yazılmaz.
    expect((await attempt(user.email, password, "victim-browser")).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).toBeNull();
  });

  it("dağıtık deneme eşiği aşınca PoW istenir; çözüm tek kullanımlık", async () => {
    const user = await makeUser("pow");
    for (let i = 0; i < 4; i++) {
      expect((await attempt(user.email, "yanlis1", `bot-${i}`)).status).toBe(401);
    }
    const challenged = await attempt(user.email, password, "victim-browser");
    expect(challenged.status).toBe(429);
    const body = (await challenged.json()) as LoginBody;
    expect(body.code).toBe("POW_REQUIRED");
    const solution = await solvePow(body.details!.pow!);

    expect((await attempt(user.email, password, "victim-browser", solution)).status).toBe(200);
    // Aynı çözüm ikinci kez kabul edilmez.
    const replay = await attempt(user.email, password, "victim-browser", solution);
    expect(((await replay.json()) as LoginBody).code).toBe("POW_REQUIRED");
    // Sahte çözüm de reddedilir.
    const forged = await attempt(user.email, password, "victim-browser", {
      challenge: `${body.details!.pow!.challenge.slice(0, -2)}xx`,
      nonce: "0",
    });
    expect(((await forged.json()) as LoginBody).code).toBe("POW_REQUIRED");
  });

  it("sıfırlama: sabit asgari süre, e-posta başına throttle, outbox'ta ham token yok", async () => {
    const user = await makeUser("reset");
    const timed = async (email: string) => {
      const t0 = Date.now();
      const res = await forgot(post("/api/auth/password/forgot", { email }, "ua"), undefined);
      return { status: res.status, ms: Date.now() - t0 };
    };
    const unknown = await timed(`yok-${stamp}@t.test`);
    const known = await timed(user.email);
    expect([unknown.status, known.status]).toEqual([202, 202]);
    expect(unknown.ms).toBeGreaterThanOrEqual(140);
    expect(known.ms).toBeGreaterThanOrEqual(140);

    // Pencere başına en çok 2 e-posta: 3. ve 4. istek sessizce atlanır.
    await timed(user.email);
    await timed(user.email);
    const msgs = await prisma.outboxMessage.findMany({
      where: { eventType: "auth.email_requested", payload: { path: ["userId"], equals: user.id } },
    });
    expect(msgs).toHaveLength(2);

    for (const msg of msgs) {
      const payload = msg.payload as Record<string, string>;
      expect(payload).not.toHaveProperty("token");
      const raw = new URL(openLink(payload.sealedLink), "http://x").searchParams.get("token")!;
      expect(raw.length).toBeGreaterThan(20);
      expect(JSON.stringify(payload)).not.toContain(raw);
      expect(payload.tokenHash).toBe(createHash("sha256").update(raw).digest("hex"));
    }
  });
});
