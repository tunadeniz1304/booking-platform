import { describe, expect, it } from "vitest";
import { describeUserAgent, maskIpHint } from "@/lib/auth/user-sessions";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";
import { securityAlertEmail } from "@/lib/notifications/security-notifications";

describe("P0-4 oturum yardımcıları", () => {
  it("User-Agent kısa etikete çevrilir", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      )
    ).toBe("Chrome · Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe("Safari · iOS");
    expect(describeUserAgent("Mozilla/5.0 (Macintosh) Edg/120.0")).toBe("Edge · macOS");
    expect(describeUserAgent("curl/8.4.0")).toBe("curl/8.4.0");
    expect(describeUserAgent(null)).toBeNull();
  });

  it("IP ipucu tam adresi saklamaz", () => {
    expect(maskIpHint("ip:203.0.113.77")).toBe("203.0.113.x");
    expect(maskIpHint("ip:2001:db8:1:2::/64")).toBe("2001:db8:1:2::/64");
    expect(maskIpHint(null)).toBeNull();
  });

  it("erişim token'ı oturum kimliğini (sid) taşır", async () => {
    const withSid = await signAccessToken("u1", "USER", 60, 0, 100, "fam-1");
    expect((await verifyAccessToken(withSid.token))?.sessionId).toBe("fam-1");
    const legacy = await signAccessToken("u1", "USER", 60);
    expect((await verifyAccessToken(legacy.token))?.sessionId).toBeUndefined();
  });

  it("yeni cihaz e-postası TR/EN metinleri ve HTML kaçışı", () => {
    const tr = securityAlertEmail(
      {
        name: "<Ayşe>",
        detail: "Firefox · Linux — 203.0.113.x",
        occurredAt: "2026-09-26T10:00:00.000Z",
        kind: "NEW_DEVICE_LOGIN",
      },
      "tr"
    );
    expect(tr.subject).toBe("Hesabınıza yeni bir cihazdan giriş yapıldı");
    expect(tr.text).toContain("Firefox · Linux — 203.0.113.x");
    expect(tr.text).toContain("Hesap ▸ Oturumlar");
    expect(tr.html).toContain("&lt;Ayşe&gt;");
    const en = securityAlertEmail(
      { name: "A", detail: null, occurredAt: "2026-09-26T10:00:00.000Z", kind: "NEW_DEVICE_LOGIN" },
      "en"
    );
    expect(en.subject).toMatch(/new device/);
    // Varsayılan tür geriye uyumlu (passkey).
    expect(
      securityAlertEmail({ name: "A", detail: null, occurredAt: "2026-09-26T10:00:00.000Z" })
        .subject
    ).toBe("Hesabınıza yeni bir passkey eklendi");
  });
});
