import { describe, expect, it } from "vitest";
import { readBodyLimited } from "@/lib/http/body-limit";

const CHUNK = 1024;

/** Başlıksız (chunked) gövde: `total` bayt üretir; kaç bayt çekildiğini sayar. */
function chunkedRequest(total: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= total) return controller.close();
      const n = Math.min(CHUNK, total - pulled);
      pulled += n;
      controller.enqueue(new Uint8Array(n).fill(120));
    },
  });
  const req = new Request("http://localhost/upload", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { req, pulled: () => pulled };
}

describe("regression: v5#11 yükleme gövdesi akıştan sayılarak sınırlanır", () => {
  it("content-length yokken 2× sınır chunked gövde → 413; bellek sınır + bir parçayla sınırlı", async () => {
    const limit = 16 * CHUNK;
    const { req, pulled } = chunkedRequest(2 * limit);
    await expect(readBodyLimited(req, limit)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(pulled()).toBeLessThanOrEqual(limit + 2 * CHUNK);
  });

  it("beyan edilen content-length sınırı aşıyorsa gövde hiç okunmadan 413", async () => {
    const { req, pulled } = chunkedRequest(4 * CHUNK, { "content-length": String(8 * CHUNK) });
    await expect(readBodyLimited(req, 2 * CHUNK)).rejects.toMatchObject({ status: 413 });
    expect(pulled()).toBe(0);
  });

  it("sınır içindeki gövde eksiksiz döner (sınıra eşit dahil)", async () => {
    const { req } = chunkedRequest(4 * CHUNK);
    const buf = await readBodyLimited(req, 4 * CHUNK);
    expect(buf.byteLength).toBe(4 * CHUNK);
  });
});
