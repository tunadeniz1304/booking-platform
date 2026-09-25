import { describe, expect, it } from "vitest";
import { passkeyErrorMessage, passkeySupported } from "@/lib/auth/passkey-client";
import { ApiError } from "@/lib/api-client";

describe("passkey istemci yardımcıları", () => {
  const named = (name: string) => Object.assign(new Error("x"), { name });

  it("WebAuthn hatalarını Türkçe mesaja çevirir", () => {
    expect(passkeyErrorMessage(named("NotAllowedError"), "f")).toMatch(/iptal/);
    expect(passkeyErrorMessage(named("InvalidStateError"), "f")).toMatch(/zaten kayıtlı/);
  });

  it("API hatasında sunucu mesajını, diğerlerinde yedek metni döner", () => {
    expect(passkeyErrorMessage(new ApiError(400, "Hesapta kayıtlı passkey yok"), "f")).toBe(
      "Hesapta kayıtlı passkey yok"
    );
    expect(passkeyErrorMessage(new Error("iç"), "yedek")).toBe("yedek");
    expect(passkeyErrorMessage("x", "yedek")).toBe("yedek");
  });

  it("sunucu ortamında passkey desteklenmez", () => {
    expect(passkeySupported()).toBe(false);
  });
});
