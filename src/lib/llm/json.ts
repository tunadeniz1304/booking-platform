import type { ZodType } from "zod";

/**
 * LLM düz metin yanıtından JSON çıkarma + zod doğrulama.
 *
 * Sıra: (1) ```json … ``` kod bloğu, (2) metnin tamamı, (3) ilk dengeli `{…}`
 * (string ve kaçış karakterlerine duyarlı parantez sayımı).
 */

export class LlmJsonError extends Error {
  constructor(
    readonly code: "invalid_json" | "schema_invalid",
    message: string
  ) {
    super(message);
    this.name = "LlmJsonError";
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Metindeki ilk dengeli JSON nesnesini döndürür; yoksa `null`. */
export function findBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Serbest metinden JSON değeri çıkarır; bulunamazsa `LlmJsonError("invalid_json")`. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const value = tryParse(fenced[1].trim());
    if (value !== undefined) return value;
  }
  const whole = tryParse(text.trim());
  if (whole !== undefined) return whole;
  const balanced = findBalancedObject(text);
  if (balanced) {
    const value = tryParse(balanced);
    if (value !== undefined) return value;
  }
  throw new LlmJsonError("invalid_json", "Yanıtta geçerli JSON bulunamadı");
}

/** JSON çıkarır ve şemaya göre doğrular. */
export function parseJsonWithSchema<T>(text: string, schema: ZodType<T>): T {
  const value = extractJson(text);
  const result = schema.safeParse(value);
  if (!result.success) {
    const paths = result.error.issues
      .slice(0, 5)
      .map((issue) => issue.path.join(".") || "(kök)")
      .join(", ");
    throw new LlmJsonError("schema_invalid", `Şema doğrulaması başarısız: ${paths}`);
  }
  return result.data;
}
