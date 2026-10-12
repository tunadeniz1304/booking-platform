import { describe, expect, it } from "vitest";
import { shortRef } from "@/lib/ui/short-ref";

describe("shortRef", () => {
  it("uzun kimlikte son 8 karakteri büyük harfle döndürür", () => {
    expect(shortRef("clx9abcdefgh12345678")).toBe("12345678");
    expect(shortRef("cm1q2w3e4r5t6y7uabcdwxyz")).toBe("ABCDWXYZ");
  });

  it("8 veya daha kısa kimliği olduğu gibi büyük harfle döndürür", () => {
    expect(shortRef("abc12345")).toBe("ABC12345");
    expect(shortRef("ab1")).toBe("AB1");
    expect(shortRef("")).toBe("");
  });
});
