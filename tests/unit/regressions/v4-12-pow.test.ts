import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { redis } from "@/lib/redis";
import { issuePowChallenge, verifyPow } from "@/lib/auth/pow";
import { leadingZeroBits, solvePow } from "@/lib/auth/pow-solver";
import { openLink, sealLink } from "@/lib/auth/link-crypto";
import { loginDelayMs } from "@/lib/auth/account";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";

const fake = redis as unknown as FakeRedis;

beforeEach(() => {
  fake.store.clear();
  fake.failing = false;
  process.env.AUTH_POW_DIFFICULTY_BITS = "6";
  resetConfigForTests();
});

describe("regression: v4#12 PoW, şifreli bağlantı ve kademeli gecikme", () => {
  it("baştaki sıfır bitleri doğru sayılır", () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0xff]))).toBe(16);
    expect(leadingZeroBits(new Uint8Array([0x0f]))).toBe(4);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16);
  });

  it("çözülen bulmaca bir kez kabul edilir; tekrar, süre aşımı ve imza bozulması reddedilir", async () => {
    const now = Date.now();
    const challenge = issuePowChallenge(now);
    expect(challenge.bits).toBe(6);
    const solution = await solvePow(challenge);
    expect(await verifyPow(solution, now)).toBe(true);
    expect(await verifyPow(solution, now)).toBe(false); // tek kullanımlık

    const fresh = await solvePow(issuePowChallenge(now));
    const ttl = getConfig().AUTH_POW_TTL_SECONDS;
    expect(await verifyPow(fresh, now + (ttl + 5) * 1000)).toBe(false);

    const [id, exp, , sig] = fresh.challenge.split(".");
    expect(await verifyPow({ challenge: `${id}.${exp}.1.${sig}`, nonce: "0" }, now)).toBe(false);
    expect(await verifyPow({ challenge: "a.b", nonce: "0" }, now)).toBe(false);
    expect(await verifyPow(null, now)).toBe(false);
  });

  it("yetersiz iş (yanlış nonce) reddedilir; Redis yoksa kabul edilmez", async () => {
    const now = Date.now();
    const challenge = issuePowChallenge(now);
    const solution = await solvePow(challenge);
    // Çözüm dışındaki ilk nonce büyük olasılıkla eşik altında kalır.
    let wrong = 0;
    for (let n = 0; n < 50; n++) {
      if (String(n) === solution.nonce) continue;
      if (!(await verifyPow({ challenge: challenge.challenge, nonce: `x${n}` }, now))) wrong += 1;
    }
    expect(wrong).toBeGreaterThan(40);
    fake.failing = true;
    expect(await verifyPow(await solvePow(issuePowChallenge(now)), now)).toBe(false);
  });

  it("outbox bağlantısı AES-GCM ile şifrelenir; kurcalanırsa açılmaz", () => {
    const sealed = sealLink("/reset-password?token=abc");
    expect(sealed).not.toContain("abc");
    expect(openLink(sealed)).toBe("/reset-password?token=abc");
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}A`;
    expect(() => openLink(tampered)).toThrow();
    expect(() => openLink("v0.xyz")).toThrow();
  });

  it("gecikme serbest denemelerden sonra üstel artar ve tavanlıdır", () => {
    const config = getConfig();
    const free = config.AUTH_LOGIN_FREE_FAILURES;
    expect(loginDelayMs(free, config)).toBe(0);
    expect(loginDelayMs(free + 1, config)).toBe(config.AUTH_LOGIN_DELAY_BASE_MS);
    expect(loginDelayMs(free + 2, config)).toBe(config.AUTH_LOGIN_DELAY_BASE_MS * 2);
    expect(loginDelayMs(free + 50, config)).toBe(config.AUTH_LOGIN_DELAY_MAX_MS);
  });
});
