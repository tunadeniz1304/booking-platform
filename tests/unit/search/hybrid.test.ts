import { describe, it, expect } from "vitest";
import { buildTsQuery, rrfFuse } from "@/lib/search/hybrid";
import { ndcgAtK } from "@/lib/search/metrics";
import { canonicalToken, expandSynonyms, foldToken } from "@/lib/embedding/synonyms";
import { cosineSimilarity as cosine, encode, tokenize } from "@/lib/embedding/embedder";

describe("P1-1 hibrit arama — saf parçalar", () => {
  it("foldToken Türkçe aksanları ve noktasız ı'yı katlar, kelimeyi bölmez", () => {
    expect(foldToken("Şömine")).toBe("somine");
    expect(foldToken("KIYI")).toBe("kiyi");
    expect(foldToken("İstanbul")).toBe("istanbul");
    expect(tokenize("şömineli dağ")).toEqual(["somine", "dag"]);
  });

  it("eşanlamlılar tek kanonik biçime iner; bilinmeyen sözcük önek köke", () => {
    for (const w of ["sahil", "plaj", "beach", "kumsal"]) {
      expect(canonicalToken(foldToken(w))).toBe("deniz");
    }
    expect(canonicalToken(foldToken("havuzlu"))).toBe("havuz");
    expect(canonicalToken("kapadokya")).toBe("kapad");
    expect(expandSynonyms("plaj")).toContain("deniz");
    expect(expandSynonyms("xyzabc")).toEqual(["xyzabc"]);
  });

  it("eşanlamlı sorgu ile belge vektör uzayında yakın, alakasız belge uzak", () => {
    const doc = encode("Sahile sıfır butik otel, plaj havlusu");
    expect(cosine(encode("beach hotel"), doc)).toBeGreaterThan(0.5);
    expect(cosine(encode("kayak pisti"), doc)).toBeLessThan(0.2);
  });

  it("buildTsQuery: genişletilmiş, önekli ve enjeksiyona kapalı ifade üretir", () => {
    const q = buildTsQuery("plaj & ev")!;
    expect(q).toContain("deniz:*");
    expect(q).toContain("plaj:*");
    expect(q).not.toMatch(/[&!()<>:]\s*$/);
    expect(q.split(" | ").every((t) => /^[\p{L}\p{N}]+(:\*)?$/u.test(t))).toBe(true);
    expect(buildTsQuery("!!! ()")).toBeNull();
  });

  it("rrfFuse: Σ 1/(k+sıra); iki listede olan tek listedekini geçer", () => {
    const fused = rrfFuse(
      [
        ["a", "b"],
        ["b", "c"],
      ],
      60
    );
    expect(fused.get("b")).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused.get("a")).toBeCloseTo(1 / 61, 10);
    expect(fused.get("b")!).toBeGreaterThan(fused.get("a")!);
  });

  it("ndcgAtK: ideal sıra 1, ters sıra <1, kaçırılan ilgili belge cezalandırılır", () => {
    const grades = new Map([
      ["a", 3],
      ["b", 1],
      ["c", 0],
    ]);
    expect(ndcgAtK(["a", "b", "c"], grades)).toBeCloseTo(1, 10);
    expect(ndcgAtK(["c", "b", "a"], grades)).toBeLessThan(1);
    expect(ndcgAtK(["b"], grades)).toBeLessThan(ndcgAtK(["a"], grades));
    expect(ndcgAtK(["a"], new Map([["a", 0]]))).toBe(0);
  });
});
