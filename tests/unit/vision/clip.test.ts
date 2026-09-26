import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfigForTests } from "@/lib/config/app-config";
import {
  CLIP_DIMENSIONS,
  VISION_REASON_MESSAGES,
  getImageEmbedder,
  modelDirectory,
  normalizeVector,
  setImageEmbedderForTests,
  setTransformersLoaderForTests,
} from "@/lib/vision/clip";
import { createStubImageEmbedder, STUB_MODEL_ID } from "@/lib/vision/stub-embedder";
import { patternImage } from "../../helpers/test-images";

const ENV = ["VISION_CLIP_ENABLED", "VISION_MODEL_DIR", "VISION_ALLOW_REMOTE_MODELS"];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "clip-"));
  process.env.VISION_MODEL_DIR = dir;
  resetConfigForTests();
  setImageEmbedderForTests(undefined);
  setTransformersLoaderForTests(null);
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  resetConfigForTests();
  setImageEmbedderForTests(undefined);
  setTransformersLoaderForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const enable = () => {
  process.env.VISION_CLIP_ENABLED = "true";
  resetConfigForTests();
  setTransformersLoaderForTests(null);
};

const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

describe("P1-10 CLIP embedder — bayrak ve opsiyonel bağımlılık", () => {
  it("bayrak kapalı → FLAG_OFF (paket hiç yüklenmez)", async () => {
    let loaded = false;
    setTransformersLoaderForTests(async () => {
      loaded = true;
      throw new Error("yüklenmemeli");
    });
    expect(await getImageEmbedder()).toEqual({ embedder: null, reason: "FLAG_OFF" });
    expect(loaded).toBe(false);
    expect(VISION_REASON_MESSAGES.FLAG_OFF).toContain("VISION_CLIP_ENABLED");
  });

  it("model dizini yok → MODEL_MISSING (ağa çıkılmaz)", async () => {
    enable();
    expect(await getImageEmbedder()).toEqual({ embedder: null, reason: "MODEL_MISSING" });
  });

  it("paket kurulu değil → MODULE_MISSING", async () => {
    enable();
    mkdirSync(modelDirectory().model, { recursive: true });
    setTransformersLoaderForTests(async () => {
      throw new Error("Cannot find module '@huggingface/transformers'");
    });
    expect((await getImageEmbedder()).reason).toBe("MODULE_MISSING");
  });

  it("model yüklenemezse LOAD_FAILED", async () => {
    enable();
    mkdirSync(modelDirectory().model, { recursive: true });
    setTransformersLoaderForTests(async () => ({
      env: { localModelPath: "", cacheDir: "", allowRemoteModels: true },
      AutoProcessor: { from_pretrained: async () => Promise.reject(new Error("bozuk")) },
      CLIPVisionModelWithProjection: { from_pretrained: async () => async () => ({}) as never },
      RawImage: { fromBlob: async () => ({}) },
    }));
    expect((await getImageEmbedder()).reason).toBe("LOAD_FAILED");
  });

  it("paket + model varsa embedder normalize 512-d vektör döner; env yerel ayarlanır", async () => {
    enable();
    mkdirSync(modelDirectory().model, { recursive: true });
    const env = { localModelPath: "", cacheDir: "", allowRemoteModels: true };
    let dtype: unknown;
    setTransformersLoaderForTests(async () => ({
      env,
      AutoProcessor: { from_pretrained: async () => async (img: unknown) => ({ img }) },
      CLIPVisionModelWithProjection: {
        from_pretrained: async (_id: string, opts?: Record<string, unknown>) => {
          dtype = opts?.dtype;
          return async () => ({
            image_embeds: { data: Float32Array.from({ length: CLIP_DIMENSIONS }, () => 2) },
          });
        },
      },
      RawImage: { fromBlob: async (b: Blob) => b },
    }));
    const res = await getImageEmbedder();
    expect(res.reason).toBeNull();
    const v = await res.embedder!.embedImage(await patternImage(1));
    expect(v).toHaveLength(CLIP_DIMENSIONS);
    expect(cosine(v, v)).toBeCloseTo(1, 6);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.localModelPath).toBe(modelDirectory().root);
    expect(dtype).toBe("q8");
    // önbellek: ikinci çağrı aynı nesne
    expect((await getImageEmbedder()).embedder).toBe(res.embedder);
  });

  it("test override: stub embedder kullanılır; null override LOAD_FAILED", async () => {
    enable();
    setImageEmbedderForTests(createStubImageEmbedder());
    expect((await getImageEmbedder()).embedder?.modelId).toBe(STUB_MODEL_ID);
    setImageEmbedderForTests(null);
    expect((await getImageEmbedder()).reason).toBe("LOAD_FAILED");
  });

  it("normalizeVector sıfır vektörde 0 döner", () => {
    expect(normalizeVector([0, 0])).toEqual([0, 0]);
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
  });
});

describe("P1-10 stub embedder — deterministik benzerlik", () => {
  it("aynı görsel aynı vektör; hafif değişmiş kopya yakın, farklı görsel uzak", async () => {
    const e = createStubImageEmbedder();
    const a = await e.embedImage(await patternImage(5));
    const a2 = await e.embedImage(await patternImage(5));
    const aBlur = await e.embedImage(await patternImage(5, { blur: 1.5, width: 300 }));
    const b = await e.embedImage(await patternImage(6));
    expect(a).toHaveLength(CLIP_DIMENSIONS);
    expect(a).toEqual(a2);
    expect(cosine(a, aBlur)).toBeGreaterThan(0.9);
    expect(cosine(a, b)).toBeLessThan(cosine(a, aBlur));
  });
});
