import { describe, expect, it } from "vitest";
import { openLink, sealLink } from "@/lib/auth/link-crypto";

describe("link-crypto AES-GCM etiket uzunluğu (Semgrep gcm-no-tag-length)", () => {
  it("tam 16 baytlık etiketle açılır", () => {
    expect(openLink(sealLink("merhaba"))).toBe("merhaba");
  });

  it("kısaltılmış (truncated) etiketi reddeder", () => {
    // v1.<iv 12><tag 16><gövde>: 4 baytlık etiket + boş gövde → kısa etiket denemesi.
    const raw = Buffer.from(sealLink("").slice(3), "base64url");
    const truncated = `v1.${raw.subarray(0, 16).toString("base64url")}`;
    expect(() => openLink(truncated)).toThrow();
  });
});
