import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { buildOpenApiDocument, REQUEST_EXAMPLES, toJsonSchema } from "@/lib/http/openapi";
import {
  createBookingSchema,
  listBookingsQuerySchema,
  payBookingSchema,
  quoteQuerySchema,
} from "@/lib/http/api-schemas";
import { SearchParamsSchema, searchParamsFromUrl } from "@/lib/search/params";
import {
  ConflictError,
  EmailNotVerifiedError,
  ERROR_CATALOG,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/http/errors";
import { isPublicApi } from "@/lib/security/public-routes";

const API_ROOT = path.resolve(process.cwd(), "src/app");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** `/api/bookings/{id}/pay` → `src/app/api/bookings/[id]/pay/route.ts` */
function routeFileFor(apiPath: string): string {
  const segments = apiPath
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/^\{(.+)\}$/, "[$1]"));
  return path.join(API_ROOT, ...segments, "route.ts");
}

function exportsMethod(source: string, method: string): boolean {
  const m = method.toUpperCase();
  return new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(source);
}

/** Belge ↔ route dosyası uyumsuzlukları (boş dizi = senkron). */
function syncProblems(paths: Record<string, Record<string, unknown>>): string[] {
  const problems: string[] = [];
  for (const [apiPath, item] of Object.entries(paths)) {
    const file = routeFileFor(apiPath);
    if (!existsSync(file)) {
      problems.push(`${apiPath}: ${path.relative(process.cwd(), file)} yok`);
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      if (item[method] && !exportsMethod(source, method)) {
        problems.push(`${apiPath}: ${method.toUpperCase()} export edilmiyor`);
      }
    }
  }
  return problems;
}

/** Belgelenen işlemin route'ta parse ettiği şema (tek kaynak). */
const ROUTE_SCHEMAS: Record<string, Partial<Record<string, [string, ZodTypeAny]>>> = {
  "/api/search": { get: ["SearchParamsSchema", SearchParamsSchema] },
  "/api/quote": { get: ["quoteQuerySchema", quoteQuerySchema] },
  "/api/bookings": {
    get: ["listBookingsQuerySchema", listBookingsQuerySchema],
    post: ["createBookingSchema", createBookingSchema],
  },
  "/api/bookings/{id}/pay": { post: ["payBookingSchema", payBookingSchema] },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- belge JSON olarak gezilir
const doc = JSON.parse(JSON.stringify(buildOpenApiDocument())) as any;

describe("v2 P1-2: OpenAPI 3.1 sözleşmesi", () => {
  it("OpenAPI 3.1.x ve çekirdek misafir akışı yolları", () => {
    expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
    for (const p of [
      "/api/search",
      "/api/quote",
      "/api/bookings",
      "/api/bookings/{id}",
      "/api/bookings/{id}/pay",
    ]) {
      expect(doc.paths, p).toHaveProperty([p]);
    }
    expect(doc.paths["/api/bookings/{id}"].delete).toBeDefined(); // iptal
  });

  it("POST /api/bookings: requestBody, 201/401/409 ve Idempotency-Key", () => {
    const post = doc.paths["/api/bookings"].post;
    // zod bilinmeyen alanı atar, reddetmez; belge daha katı olmamalı.
    expect(post.requestBody.content["application/json"].schema.additionalProperties).not.toBe(
      false
    );
    expect(post.requestBody.content["application/json"].schema).toEqual(
      toJsonSchema(createBookingSchema)
    );
    expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(["201", "401", "409"]));
    expect(post.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", in: "header" })
    );
    const pay = doc.paths["/api/bookings/{id}/pay"].post;
    expect(pay.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true })
    );
  });

  it("Bearer güvenlik şeması ve ortak hata zarfı", () => {
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(doc.components.schemas.Error).toMatchObject({
      required: ["error", "code"],
      properties: { error: {}, code: {}, details: {} },
    });
    expect(doc.paths["/api/bookings"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/api/search"].get.security).toEqual([]);
  });

  it("hata kodu kataloğu 401/403/404/409/422/429/503'ü kapsar ve sınıflarla tutarlı", () => {
    const statuses = new Set(Object.values(doc["x-error-catalog"]).map((e: any) => e.status)); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const s of [401, 403, 404, 409, 422, 429, 503])
      expect(statuses.has(s), String(s)).toBe(true);
    for (const e of [
      new UnauthorizedError(),
      new ForbiddenError(),
      new EmailNotVerifiedError(),
      new NotFoundError(),
      new ConflictError("x"),
      new ValidationError("x"),
      new ServiceUnavailableError(),
    ]) {
      expect(ERROR_CATALOG, e.code).toHaveProperty([e.code, "status"], e.status);
    }
    // Belgede atıf yapılan genel kodlar katalogda tanımlı.
    for (const response of Object.values(doc.components.responses) as {
      "x-error-codes": string[];
    }[]) {
      for (const code of response["x-error-codes"]) expect(ERROR_CATALOG).toHaveProperty([code]);
    }
  });

  it("senkron: belgelenen her yol bir route.ts'e ve metoduna karşılık gelir", () => {
    expect(syncProblems(doc.paths)).toEqual([]);
  });

  it("senkron denetimi eksik route dosyasını ve metodu yakalar", () => {
    expect(syncProblems({ "/api/bookings/{id}/refund-now": { post: {} } })).toHaveLength(1);
    expect(syncProblems({ "/api/quote": { post: {} } })).toEqual([
      "/api/quote: POST export edilmiyor",
    ]);
  });

  it("senkron: route'lar belgelenen şemayı parse eder, örnekler şemadan geçer", () => {
    for (const [apiPath, ops] of Object.entries(ROUTE_SCHEMAS)) {
      const source = readFileSync(routeFileFor(apiPath), "utf8");
      for (const [method, entry] of Object.entries(ops)) {
        const [name, schema] = entry!;
        expect(source, `${method} ${apiPath}`).toMatch(new RegExp(`\\b${name}\\.parse\\(`));
        const op = doc.paths[apiPath][method];
        const body = op.requestBody?.content["application/json"];
        if (body) {
          expect(body.schema).toEqual(toJsonSchema(schema));
          expect(schema.safeParse(body.example).success, `${method} ${apiPath} örneği`).toBe(true);
        }
      }
    }
    expect(createBookingSchema.safeParse(REQUEST_EXAMPLES.createBooking).success).toBe(true);
    expect(payBookingSchema.safeParse(REQUEST_EXAMPLES.payBooking).success).toBe(true);
  });

  it("sorgu parametreleri zod şemasından: zorunlular işaretli, iç alanlar gizli", () => {
    const quoteParams = doc.paths["/api/quote"].get.parameters;
    const required = quoteParams.filter((p: { required?: boolean }) => p.required);
    expect(required.map((p: { name: string }) => p.name).sort()).toEqual(
      ["checkIn", "checkOut", "roomId"].sort()
    );
    const searchNames = doc.paths["/api/search"].get.parameters.map(
      (p: { name: string }) => p.name
    );
    expect(searchNames).toEqual(expect.arrayContaining(["destination", "checkIn", "pageSize"]));
    expect(searchNames).not.toContain("userId");
    // Belgelenen her arama parametresini route gerçekten okur.
    for (const name of searchNames) {
      const read = searchParamsFromUrl(new URLSearchParams({ [name]: "1" }));
      expect(
        Object.values(read).some((v) => v !== undefined),
        name
      ).toBe(true);
    }
  });

  it("/api/openapi.json oturumsuz erişilebilir ve belgeyi döner", async () => {
    expect(isPublicApi("/api/openapi.json", "GET")).toBe(true);
    expect(isPublicApi("/api/openapi.json", "POST")).toBe(false);
    const { GET } = await import("@/app/api/openapi.json/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://localhost/api/openapi.json"), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).openapi).toBe(doc.openapi);
  });
});
