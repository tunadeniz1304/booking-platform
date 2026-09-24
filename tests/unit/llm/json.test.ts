import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, findBalancedObject, parseJsonWithSchema, LlmJsonError } from "@/lib/llm/json";

describe("LLM JSON çıkarma", () => {
  it("```json kod bloğundan çıkarır", () => {
    expect(extractJson('Açıklama:\n```json\n{"a": 1}\n```\nson')).toEqual({ a: 1 });
  });

  it("düz JSON metnini parse eder", () => {
    expect(extractJson('  {"b": [1,2]} ')).toEqual({ b: [1, 2] });
  });

  it("serbest metindeki ilk dengeli nesneyi bulur (string içi parantezlere duyarlı)", () => {
    const text = 'Tamam! {"t": "a } b { c", "n": {"x": "\\"}"}} ve fazlası }';
    expect(findBalancedObject(text)).toBe('{"t": "a } b { c", "n": {"x": "\\"}"}}');
    expect(extractJson(text)).toEqual({ t: "a } b { c", n: { x: '"}' } });
  });

  it("JSON yoksa invalid_json", () => {
    expect(() => extractJson("hiç json yok")).toThrow(LlmJsonError);
    try {
      extractJson("{ kırık");
      expect.unreachable();
    } catch (e) {
      expect((e as LlmJsonError).code).toBe("invalid_json");
    }
  });

  it("şema uyuşmazlığı schema_invalid", () => {
    const schema = z.object({ city: z.string() });
    expect(parseJsonWithSchema('{"city":"İzmir"}', schema)).toEqual({ city: "İzmir" });
    try {
      parseJsonWithSchema('{"city": 5}', schema);
      expect.unreachable();
    } catch (e) {
      expect((e as LlmJsonError).code).toBe("schema_invalid");
    }
  });
});
