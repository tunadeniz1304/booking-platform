// P1-2: davet linki HMAC imzalı + süreli; bozuk imza 404, süresi geçmiş 410.
import { describe, expect, it } from "vitest";
import {
  ShareLinkExpiredError,
  ShareLinkInvalidError,
  shareUrl,
  signShareToken,
  verifyShareToken,
} from "@/lib/cart/split-token";
import { splitShareEmail } from "@/lib/notifications/split-notifications";

describe("split-token", () => {
  const payload = { s: "share_1", n: "nonce_1", e: Date.now() + 60_000 };

  it("imzalı token doğrulanır ve payload döner", () => {
    expect(verifyShareToken(signShareToken(payload))).toEqual(payload);
  });

  it("imza / gövde değişirse 404 SHARE_LINK_INVALID", () => {
    const token = signShareToken(payload);
    const [body, sig] = token.split(".");
    const otherBody = Buffer.from(JSON.stringify({ ...payload, s: "share_2" })).toString(
      "base64url"
    );
    for (const bad of [
      `${otherBody}.${sig}`,
      `${body}.${sig.slice(1)}`,
      `${body}`,
      `${body}.${sig}.x`,
      "",
      `${Buffer.from("not json").toString("base64url")}.${sig}`,
    ]) {
      expect(() => verifyShareToken(bad)).toThrow(ShareLinkInvalidError);
    }
  });

  it("imzası geçerli ama biçimi bozuk payload reddedilir", () => {
    const token = signShareToken({ s: 1, n: "x", e: Date.now() + 1000 } as never);
    expect(() => verifyShareToken(token)).toThrow(ShareLinkInvalidError);
  });

  it("süresi geçmiş link 410 SHARE_LINK_EXPIRED", () => {
    const token = signShareToken({ ...payload, e: 1_000 });
    const err = (() => {
      try {
        verifyShareToken(token);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ShareLinkExpiredError);
    expect((err as ShareLinkExpiredError).status).toBe(410);
  });

  it("farklı JWT_SECRET ile imzalanan token geçersiz (anahtar sırdan türetilir)", () => {
    const token = signShareToken(payload);
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "z".repeat(48);
    try {
      expect(() => verifyShareToken(token)).toThrow(ShareLinkInvalidError);
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });

  it("zayıf sır → 503 SPLIT_PAY_UNAVAILABLE", () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "short";
    try {
      expect(() => signShareToken(payload)).toThrow(/yapılandırılmamış/);
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });

  it("link /pay/share/<token> biçiminde ve URL-kodlu", () => {
    expect(shareUrl("a.b")).toMatch(/\/pay\/share\/a\.b$/);
  });
});

describe("split e-postası", () => {
  it("davet ve yedek ödeme metni TR/EN; HTML kaçışlı", () => {
    const base = {
      name: "Ayşe",
      organizer: "<Ayşe>",
      amount: "₺100,00",
      deadline: "2026-10-01T10:00:00.000Z",
      url: "http://localhost:3000/pay/share/t",
    };
    const tr = splitShareEmail({ ...base, kind: "INVITE" }, "tr");
    expect(tr.subject).toContain("payınızı");
    expect(tr.text).toContain(base.url);
    expect(tr.html).toContain("&lt;Ayşe&gt;");
    const en = splitShareEmail({ ...base, kind: "FALLBACK" }, "en");
    expect(en.subject).toContain("remaining");
    expect(en.text).toContain("2026-10-01 10:00");
  });
});
