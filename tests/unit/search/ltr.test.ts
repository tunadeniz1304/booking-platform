import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import {
  LTR_FEATURES,
  buildFeatures,
  ltrAvailable,
  rankWithLtr,
  setOrtLoaderForTests,
  type LtrInput,
} from "@/lib/search/ltr";
import { RANKING_WEIGHTS_WITH_QUERY, rankResults } from "@/lib/search/ranking";
import { resetConfigForTests } from "@/lib/config/app-config";

const items: LtrInput[] = [
  {
    id: "strong",
    price: 150_000,
    ratingAvg: 4.8,
    ratingCount: 90,
    semantic: 1,
    lexical: 1,
    vector: 0.9,
  },
  {
    id: "weak",
    price: 140_000,
    ratingAvg: 3.2,
    ratingCount: 4,
    semantic: 0.1,
    lexical: 0,
    vector: 0.3,
  },
  {
    id: "mid",
    price: 160_000,
    ratingAvg: 4.3,
    ratingCount: 30,
    semantic: 0.5,
    lexical: 0.4,
    vector: 0.6,
  },
];

async function runtimeLoads(): Promise<boolean> {
  try {
    await import(/* @vite-ignore */ "onnxruntime-node");
    return true;
  } catch {
    return false;
  }
}

describe("P1-2 LTR (ONNX, fallback)", () => {
  afterEach(() => {
    setOrtLoaderForTests(null);
    delete process.env.LTR_MODEL_PATH;
    resetConfigForTests();
  });

  it("özellik matrisi LTR_FEATURES sırasında ve 0..1 aralığında", () => {
    const m = buildFeatures(items);
    expect(m).toHaveLength(3);
    expect(m[0]).toHaveLength(LTR_FEATURES.length);
    expect(m.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(m[0][LTR_FEATURES.indexOf("lexical")]).toBe(1);
  });

  it("model dosyası yoksa ağırlıklı sıralamaya düşer (çalışma zamanı yüklenmez)", async () => {
    process.env.LTR_MODEL_PATH = "models/does-not-exist.onnx";
    resetConfigForTests();
    let loaderCalled = false;
    setOrtLoaderForTests(async () => {
      loaderCalled = true;
      throw new Error("yüklenmemeli");
    });
    const res = await rankWithLtr(items, RANKING_WEIGHTS_WITH_QUERY);
    expect(res.mode).toBe("weighted");
    expect(res.items).toEqual(rankResults(items, RANKING_WEIGHTS_WITH_QUERY));
    expect(loaderCalled).toBe(false);
    expect(await ltrAvailable()).toBe(false);
  });

  it("onnxruntime yüklenemezse (ör. Alpine/musl) ağırlıklı sıralama", async () => {
    setOrtLoaderForTests(async () => {
      throw new Error("Cannot find module 'onnxruntime-node'");
    });
    const res = await rankWithLtr(items, RANKING_WEIGHTS_WITH_QUERY);
    expect(res.mode).toBe("weighted");
    expect(res.items.map((i) => i.id)).toEqual(
      rankResults(items, RANKING_WEIGHTS_WITH_QUERY).map((i) => i.id)
    );
  });

  it("çıkarım hatalı boyut döndürürse ağırlıklı sıralamaya düşer", async () => {
    setOrtLoaderForTests(async () => ({
      InferenceSession: {
        create: async () => ({
          inputNames: ["features"],
          outputNames: ["variable"],
          run: async () => ({ variable: { data: [1] } }),
        }),
      },
      Tensor: class {},
    }));
    const res = await rankWithLtr(items, RANKING_WEIGHTS_WITH_QUERY);
    expect(res.mode).toBe("weighted");
  });

  it("boş liste → boş, ağırlıklı", async () => {
    expect(await rankWithLtr([], RANKING_WEIGHTS_WITH_QUERY)).toEqual({
      items: [],
      mode: "weighted",
    });
  });

  it.runIf(existsSync("models/ranker.onnx"))(
    "gerçek model: çalışma zamanı varsa açık ara ilgili adayı başa koyar",
    async () => {
      if (!(await runtimeLoads())) return; // isteğe bağlı bağımlılık kurulu değil
      const res = await rankWithLtr(items, RANKING_WEIGHTS_WITH_QUERY);
      expect(res.mode).toBe("ltr");
      expect(res.items[0].id).toBe("strong");
      expect(res.items[2].id).toBe("weak");
      expect(res.items[0].explain).toBeDefined();
    }
  );
});
