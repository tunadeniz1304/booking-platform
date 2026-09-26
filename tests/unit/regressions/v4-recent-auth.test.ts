import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";
import {
  assertRecentAuth,
  authAgeSeconds,
  isRecentAuth,
  ReauthRequiredError,
} from "@/lib/auth/recent-auth";
import { securityAlertEmail } from "@/lib/notifications/security-notifications";

const nowMs = Date.UTC(2026, 8, 26, 12, 0, 0);
const nowSec = nowMs / 1000;

describe("regression: v4#2 recent-auth (auth_time)", () => {
  it("auth_time claim'i token'a yazılır; yoksa 0 (yakın zamanda doğrulanmamış)", async () => {
    const withTime = await signAccessToken("u1", "USER", 300, 0, 1_700_000_000);
    expect((await verifyAccessToken(withTime.token))?.authTime).toBe(1_700_000_000);
    const without = await signAccessToken("u1", "USER", 300);
    expect((await verifyAccessToken(without.token))?.authTime).toBe(0);
  });

  it("yaş ≤ RECENT_AUTH_MAX_AGE_SECONDS (varsayılan 300) ise yakın; değilse REAUTH_REQUIRED", () => {
    expect(authAgeSeconds({ authTime: 0 }, nowMs)).toBe(Number.POSITIVE_INFINITY);
    expect(authAgeSeconds({}, nowMs)).toBe(Number.POSITIVE_INFINITY);
    expect(isRecentAuth({ authTime: nowSec - 299 }, nowMs)).toBe(true);
    expect(isRecentAuth({ authTime: nowSec - 301 }, nowMs)).toBe(false);
    // Gelecekten gelen değer (saat kayması payı dışında) kabul edilmez.
    expect(isRecentAuth({ authTime: nowSec + 3600 }, nowMs)).toBe(false);
    expect(() => assertRecentAuth({ authTime: nowSec - 10 }, nowMs)).not.toThrow();
    expect(() => assertRecentAuth({ authTime: nowSec - 3600 }, nowMs)).toThrow(ReauthRequiredError);
    try {
      assertRecentAuth({ authTime: 0 }, nowMs);
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: "REAUTH_REQUIRED" });
    }
  });

  it("yeni passkey e-postası TR/EN, HTML kaçışlı", () => {
    const tr = securityAlertEmail({
      name: "Ayşe",
      detail: "<b>Telefon</b>",
      occurredAt: "2026-09-26T10:00:00.000Z",
    });
    expect(tr.subject).toContain("passkey");
    expect(tr.text).toContain("2026-09-26 10:00");
    expect(tr.html).not.toContain("<b>Telefon</b>");
    const en = securityAlertEmail(
      { name: "Ann", detail: null, occurredAt: "2026-09-26T10:00:00.000Z" },
      "en"
    );
    expect(en.subject).toBe("A new passkey was added to your account");
  });
});
