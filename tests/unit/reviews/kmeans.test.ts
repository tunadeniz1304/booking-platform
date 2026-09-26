import { describe, it, expect } from "vitest";
import { kmeans, mulberry32 } from "@/lib/reviews/kmeans";
import { encode } from "@/lib/embedding/embedder";

/** v4 P1-9: yorum kümeleme deterministik olmalı (aynı girdi + tohum → aynı kümeler). */
const texts = [
  "Oda çok temiz ve ferahtı",
  "Temizlik mükemmeldi, oda pırıl pırıl",
  "Oda temiz, çarşaflar tertemiz",
  "Konum harika, metroya yakın",
  "Merkezi konum, metro durağı yanı başında",
  "Konum çok iyi, metro hemen yakında",
];

describe("kmeans", () => {
  it("PRNG tohumlu ve tekrarlanabilir", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });

  it("aynı girdi + tohum → birebir aynı sonuç (tekrar tekrar)", () => {
    const vectors = texts.map(encode);
    const first = kmeans(vectors, { k: 2, seed: 42, maxIterations: 50 });
    for (let i = 0; i < 5; i++) {
      expect(kmeans(vectors, { k: 2, seed: 42, maxIterations: 50 })).toEqual(first);
    }
  });

  it("belirgin iki temayı ayırır (temizlik vs konum)", () => {
    const res = kmeans(texts.map(encode), { k: 2, seed: 42, maxIterations: 50 });
    expect(res.clusters).toHaveLength(2);
    const groups = res.clusters.map((c) => c.members.sort((a, b) => a - b));
    expect(groups).toContainEqual([0, 1, 2]);
    expect(groups).toContainEqual([3, 4, 5]);
    expect(res.assignments[0]).toBe(res.assignments[2]);
    expect(res.assignments[0]).not.toBe(res.assignments[3]);
  });

  it("k nokta sayısıyla sınırlanır; boş girdi ve özdeş noktalar güvenli", () => {
    expect(kmeans([], { k: 3, seed: 1, maxIterations: 5 }).clusters).toEqual([]);
    const one = kmeans([[1, 0]], { k: 4, seed: 1, maxIterations: 5 });
    expect(one.clusters).toHaveLength(1);
    const same = kmeans(
      [
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      { k: 3, seed: 1, maxIterations: 5 }
    );
    expect(same.clusters).toHaveLength(1);
    expect(same.clusters[0].members).toEqual([0, 1, 2]);
  });

  it("kümeler büyüklüğe göre kararlı sıralanır", () => {
    const vectors = [
      [1, 0],
      [0, 1],
      [0.1, 1],
      [0.05, 1],
    ];
    const res = kmeans(vectors, { k: 2, seed: 3, maxIterations: 20 });
    expect(res.clusters[0].members).toEqual([1, 2, 3]);
    expect(res.clusters[1].members).toEqual([0]);
    expect(res.assignments).toEqual([1, 0, 0, 0]);
  });
});
