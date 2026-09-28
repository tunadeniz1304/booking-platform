import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { expect } from "vitest";
import { buildOpenApiDocument } from "@/lib/http/openapi";

/**
 * Yanıt gövdesini OpenAPI 3.1 belgesine karşı doğrular (v5 P1-2). Integration testleri gerçek
 * route yanıtını buradan geçirir: belgelenmemiş durum kodu ya da şemaya uymayan gövde testi
 * düşürür. OpenAPI 3.1 şemaları JSON Schema 2020-12 olduğundan `ajv/dist/2020` kullanılır;
 * `$ref`'ler belgenin kendisine (`openapi#/components/...`) çözülür.
 *
 * Kullanım (çağrı biçimi literal kalmalı — kapsam testi bunları sayar):
 *   await expectMatchesOpenApi(res, "GET", "/api/search");
 */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- belge JSON olarak gezilir
const doc = JSON.parse(JSON.stringify(buildOpenApiDocument())) as any;
const DOC_ID = "openapi";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...doc, $id: DOC_ID });

const cache = new Map<string, ValidateFunction>();

const pointer = (...parts: string[]) =>
  parts.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

function resolveResponse(response: { $ref?: string } | undefined) {
  if (!response?.$ref) return response;
  const name = response.$ref.replace("#/components/responses/", "");
  return { ...doc.components.responses[name], $pointer: pointer("components", "responses", name) };
}

/** Belgedeki (yol, metot, durum) için yanıt şemasının doğrulayıcısı; belgelenmemişse null. */
export function responseValidator(
  method: Method,
  apiPath: string,
  status: number
): ValidateFunction | "no-content" | null {
  const op = doc.paths[apiPath]?.[method.toLowerCase()];
  if (!op) return null;
  const key = String(status);
  const raw = op.responses?.[key] ?? op.responses?.default;
  const response = resolveResponse(raw);
  if (!response) return null;
  // `application/json` ya da `application/*+json` (ör. JWKS: `application/jwk-set+json`).
  const mediaType = Object.keys(response.content ?? {}).find((t) => /json$/.test(t));
  if (!mediaType || !response.content[mediaType].schema) return "no-content";
  const at =
    (response as { $pointer?: string }).$pointer ??
    pointer(
      "paths",
      apiPath,
      method.toLowerCase(),
      "responses",
      op.responses[key] ? key : "default"
    );
  const ref = `${DOC_ID}#/${at}/content/${pointer(mediaType)}/schema`;
  let fn = cache.get(ref);
  if (!fn) {
    fn = ajv.compile({ $ref: ref });
    cache.set(ref, fn);
  }
  return fn;
}

/** Yanıtın durum kodu belgelenmiş ve gövdesi şemaya uyuyor olmalı. Gövdeyi (JSON) döner. */
export async function expectMatchesOpenApi<T = unknown>(
  res: Response,
  method: Method,
  apiPath: string
): Promise<T> {
  const dump = process.env.OPENAPI_DUMP;
  if (dump) {
    const text = await res.clone().text();
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      dump,
      JSON.stringify({
        method,
        apiPath,
        status: res.status,
        body: text ? JSON.parse(text) : null,
      }) + "\n"
    );
    return (text ? JSON.parse(text) : null) as T;
  }
  const validate = responseValidator(method, apiPath, res.status);
  expect(validate, `${method} ${apiPath} → ${res.status} OpenAPI'de belgelenmemiş`).not.toBeNull();
  const text = await res.clone().text();
  if (validate === "no-content" || validate === null) return (text ? JSON.parse(text) : null) as T;
  const body = text ? JSON.parse(text) : null;
  const ok = validate(body);
  expect(
    ok,
    `${method} ${apiPath} → ${res.status} şemaya uymuyor: ${ajv.errorsText(validate.errors)}`
  ).toBe(true);
  return body as T;
}
