import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/lib/http/openapi";
import { expectMatchesOpenApi, responseValidator } from "../../helpers/openapi-assert";

/**
 * v5 P1-2: yanıt kontratı yardımcısı ve kapsamı. Integration testleri gerçek yanıtları
 * `expectMatchesOpenApi(res, "METHOD", "/yol")` ile doğrular; burada (1) yardımcının yanlış
 * gövdeyi gerçekten reddettiği ve (2) integration testlerinde en az 20 farklı uç işleminin
 * doğrulandığı denetlenir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- belge JSON olarak gezilir
const doc = JSON.parse(JSON.stringify(buildOpenApiDocument())) as any;

describe("v5 P1-2: OpenAPI yanıt kontratı", () => {
  it("doğru gövde geçer, alan tipi bozulursa ve belgelenmemiş durum kodunda düşer", () => {
    const validate = responseValidator("POST", "/api/transfers/claim", 200);
    expect(typeof validate).toBe("function");
    const fn = validate as (body: unknown) => boolean;
    const good = {
      transferId: "t1",
      bookingId: "b1",
      status: "COMPLETED",
      paidMinor: 180_000,
      currency: "TRY",
    };
    expect(fn(good)).toBe(true);
    expect(fn({ ...good, paidMinor: "1800.00" })).toBe(false); // ondalık string para yasak
    expect(fn({ ...good, currency: "try" })).toBe(false);
    const missing: Partial<typeof good> = { ...good };
    delete missing.bookingId;
    expect(fn(missing)).toBe(false);
    expect(responseValidator("POST", "/api/transfers/claim", 418)).toBeNull();
    expect(responseValidator("GET", "/api/yok", 200)).toBeNull();
  });

  it("$ref'li yanıtlar (Error zarfı) ve özel medya tipi (JWKS) çözülür", async () => {
    const err = responseValidator("GET", "/api/bookings/{id}", 404) as (b: unknown) => boolean;
    expect(err({ error: "Yok", code: "NOT_FOUND" })).toBe(true);
    expect(err({ error: "Yok" })).toBe(false);
    const jwks = responseValidator("GET", "/.well-known/jwks.json", 200) as (b: unknown) => boolean;
    const key = { kty: "EC", crv: "P-256", x: "a", y: "b", kid: "k", alg: "ES256", use: "sig" };
    expect(jwks({ keys: [key] })).toBe(true);
    expect(jwks({ keys: [{ ...key, d: "gizli" }] })).toBe(false); // özel anahtar yayımlanmaz
    await expect(
      expectMatchesOpenApi(Response.json({ status: "ok", uptimeSeconds: 3 }), "GET", "/api/health")
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("devir listeleri token içeremez (şema düzeyinde)", () => {
    const pub = responseValidator("GET", "/api/transfers/discover", 200) as (b: unknown) => boolean;
    const row = {
      id: "t",
      askPriceMinor: 1,
      originalPriceMinor: 2,
      currency: "TRY",
      expiresAt: "2026-10-01T00:00:00.000Z",
      checkIn: "2026-10-02",
      checkOut: "2026-10-03",
      guestCount: 1,
      property: { id: "p", title: "Otel", city: "İstanbul" },
    };
    expect(pub([row])).toBe(true);
    expect(pub([{ ...row, claimToken: "x" }])).toBe(false);
  });

  it("integration testlerinde ≥ 20 farklı uç işlemi şemaya karşı doğrulanır", () => {
    const dir = path.resolve("tests/integration");
    const ops = new Set<string>();
    const call = /expectMatchesOpenApi(?:<[^>]*>)?\(\s*[^,]+,\s*"([A-Z]+)",\s*"([^"]+)"/g;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
      const src = readFileSync(path.join(dir, file), "utf8");
      for (const m of src.matchAll(call)) ops.add(`${m[1]} ${m[2]}`);
    }
    for (const op of ops) {
      const [method, apiPath] = op.split(" ");
      expect(doc.paths[apiPath]?.[method.toLowerCase()], op).toBeDefined();
    }
    expect(ops.size).toBeGreaterThanOrEqual(20);
  });

  it("kapsam: plan listesindeki uç grupları belgede", () => {
    for (const p of [
      "/api/search",
      "/api/quote",
      "/api/bookings",
      "/api/bookings/{id}/pay",
      "/api/cart",
      "/api/cart/items",
      "/api/transfers",
      "/api/transfers/claim",
      "/api/ucp/checkout-sessions",
      "/api/agentic/checkout_sessions",
      "/api/llm/status",
      "/.well-known/ucp",
      "/.well-known/jwks.json",
    ]) {
      expect(doc.paths, p).toHaveProperty([p]);
    }
    // Belgelenen her 2xx JSON yanıtının şeması var (boş `{type: object}` yer tutucusu değil).
    type Op = { responses?: Record<string, { content?: Record<string, { schema: unknown }> }> };
    for (const [p, item] of Object.entries(doc.paths) as [string, Record<string, Op>][]) {
      for (const [method, op] of Object.entries(item)) {
        if (method === "parameters") continue;
        for (const [status, res] of Object.entries(op.responses ?? {})) {
          if (!status.startsWith("2") || !res.content) continue;
          const schema = Object.values(res.content)[0].schema;
          expect(schema, `${method} ${p} ${status}`).not.toEqual({ type: "object" });
        }
      }
    }
  });
});
