import { describe, expect, it } from "vitest";
import { analyticsAllowed, readConsent } from "@/lib/privacy/consent";

describe("cookie consent parser", () => {
  it("returns null when the cookie is absent", () => {
    expect(readConsent("")).toBeNull();
    expect(readConsent("theme=dark; locale=tr")).toBeNull();
  });

  it("reads necessary-only and analytics consent", () => {
    expect(readConsent("a=1; cookie_consent=necessary")).toBe("necessary");
    expect(readConsent("cookie_consent=necessary%2Canalytics; b=2")).toBe("necessary,analytics");
    expect(analyticsAllowed("cookie_consent=necessary%2Canalytics")).toBe(true);
    expect(analyticsAllowed("cookie_consent=necessary")).toBe(false);
  });

  it("rejects unknown or malformed values", () => {
    expect(readConsent("cookie_consent=everything")).toBeNull();
    expect(readConsent("cookie_consent=%E0%A4%A")).toBeNull();
    expect(readConsent("xcookie_consent=necessary")).toBeNull();
  });
});
