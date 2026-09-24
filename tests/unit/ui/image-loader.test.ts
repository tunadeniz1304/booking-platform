import { describe, it, expect } from "vitest";
import { unsplashLoader } from "@/lib/ui/image-loader";

const SRC =
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80";

describe("unsplashLoader (PDP galerisi)", () => {
  it("Unsplash görselini istenen genişlik ve kaliteye ölçekler", () => {
    const url = new URL(unsplashLoader({ src: SRC, width: 384, quality: 60 }));
    expect(url.hostname).toBe("images.unsplash.com");
    expect(url.searchParams.get("w")).toBe("384");
    expect(url.searchParams.get("q")).toBe("60");
    expect(url.searchParams.get("auto")).toBe("format");
    expect(url.searchParams.get("fit")).toBe("crop");
  });

  it("kalite verilmezse varsayılan 60; fit yoksa crop eklenir", () => {
    const url = new URL(
      unsplashLoader({ src: "https://images.unsplash.com/photo-1?w=1200", width: 640 })
    );
    expect(url.searchParams.get("w")).toBe("640");
    expect(url.searchParams.get("q")).toBe("60");
    expect(url.searchParams.get("fit")).toBe("crop");
  });

  it("farklı alan adları ve göreli yollar değiştirilmez", () => {
    expect(unsplashLoader({ src: "/demo/room.jpg", width: 640 })).toBe("/demo/room.jpg");
    expect(unsplashLoader({ src: "https://example.com/a.jpg?w=1", width: 640 })).toBe(
      "https://example.com/a.jpg?w=1"
    );
  });
});
