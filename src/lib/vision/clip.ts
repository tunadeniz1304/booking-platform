import { existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config/app-config";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * CLIP görsel embedding (P1-10, ADR 0022) — `@huggingface/transformers` (ONNX) ile
 * `Xenova/clip-vit-base-patch32` görü kulesi, 512-d L2-normalize vektör.
 *
 * Paket `optionalDependencies`'tedir ve TEMBEL yüklenir; model dosyaları repoya girmez
 * (`npm run vision:download`). Bayrak kapalıysa, paket kurulamamışsa veya model yerelde
 * yoksa (ve uzaktan indirme kapalıysa) embedder `null` döner + açıklayıcı neden kodu;
 * çağıranlar özelliği devre dışı bırakır. Testler `setImageEmbedderForTests` ile
 * deterministik stub kullanır (ağ yok).
 */

export const CLIP_DIMENSIONS = 512;

export interface ImageEmbedder {
  readonly modelId: string;
  embedImage(image: Buffer): Promise<number[]>;
}

export type VisionUnavailableReason =
  "FLAG_OFF" | "MODULE_MISSING" | "MODEL_MISSING" | "LOAD_FAILED" | "VECTOR_UNAVAILABLE";

export type EmbedderResult =
  { embedder: ImageEmbedder; reason: null } | { embedder: null; reason: VisionUnavailableReason };

/** API/UI açıklamaları (TR; UI kendi i18n anahtarını neden kodundan seçer). */
export const VISION_REASON_MESSAGES: Record<VisionUnavailableReason, string> = {
  FLAG_OFF: "Görsel arama bu ortamda kapalı (VISION_CLIP_ENABLED).",
  MODULE_MISSING: "Görsel model çalışma zamanı kurulu değil (@huggingface/transformers).",
  MODEL_MISSING: "CLIP modeli indirilmemiş (npm run vision:download).",
  LOAD_FAILED: "CLIP modeli yüklenemedi.",
  VECTOR_UNAVAILABLE: "Vektör veritabanı eklentisi (pgvector) yok.",
};

/** transformers.js'in kullandığımız en küçük yüzeyi (paket kurulu olmasa da derlenir). */
interface TransformersModule {
  env: { localModelPath: string; cacheDir: string; allowRemoteModels: boolean };
  AutoProcessor: { from_pretrained(id: string): Promise<(image: unknown) => Promise<unknown>> };
  CLIPVisionModelWithProjection: {
    from_pretrained(
      id: string,
      options?: Record<string, unknown>
    ): Promise<(inputs: unknown) => Promise<{ image_embeds: { data: ArrayLike<number> } }>>;
  };
  RawImage: { fromBlob(blob: Blob): Promise<unknown> };
}

export type TransformersLoader = () => Promise<TransformersModule>;

const TRANSFORMERS_PACKAGE = "@huggingface/transformers";
/** 8-bit nicemlenmiş görü modeli (~90 MB); fp32 ~350 MB. */
const MODEL_DTYPE = "q8";

const defaultLoader: TransformersLoader = async () =>
  (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ TRANSFORMERS_PACKAGE
  )) as TransformersModule;

let loader: TransformersLoader = defaultLoader;
let override: ImageEmbedder | null | undefined;
let embedderPromise: Promise<EmbedderResult> | null = null;

/** Yalnız testler: embedder'ı (stub) veya yükleyiciyi değiştirir, önbelleği sıfırlar. */
export function setImageEmbedderForTests(embedder: ImageEmbedder | null | undefined): void {
  override = embedder;
  embedderPromise = null;
}

export function setTransformersLoaderForTests(next: TransformersLoader | null): void {
  loader = next ?? defaultLoader;
  embedderPromise = null;
}

export function visionFlagEnabled(): boolean {
  return getConfig().VISION_CLIP_ENABLED;
}

/** Model dizini (`VISION_MODEL_DIR/<model id>`); indirme betiği de bunu kullanır. */
export function modelDirectory(): { root: string; model: string } {
  const cfg = getConfig();
  // Çalışma zamanı yolu: paket izlemesine (output tracing) girmesin, model imaja kopyalanmaz.
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), cfg.VISION_MODEL_DIR);
  return {
    root,
    model: path.join(/* turbopackIgnore: true */ root, ...cfg.VISION_CLIP_MODEL.split("/")),
  };
}

export function normalizeVector(values: ArrayLike<number>): number[] {
  let norm = 0;
  for (let i = 0; i < values.length; i++) norm += values[i]! * values[i]!;
  norm = Math.sqrt(norm);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = norm > 0 ? values[i]! / norm : 0;
  return out;
}

async function loadEmbedder(): Promise<EmbedderResult> {
  const cfg = getConfig();
  const dirs = modelDirectory();
  if (!cfg.VISION_ALLOW_REMOTE_MODELS && !existsSync(dirs.model)) {
    logger.info({ modelDir: dirs.model }, "CLIP modeli yok; görsel embedding devre dışı");
    return { embedder: null, reason: "MODEL_MISSING" };
  }
  let tf: TransformersModule;
  try {
    tf = await loader();
  } catch (error) {
    logger.warn(errorFields(error), "transformers.js yüklenemedi; görsel embedding devre dışı");
    return { embedder: null, reason: "MODULE_MISSING" };
  }
  try {
    tf.env.localModelPath = dirs.root;
    tf.env.cacheDir = dirs.root;
    tf.env.allowRemoteModels = cfg.VISION_ALLOW_REMOTE_MODELS;
    const modelId = cfg.VISION_CLIP_MODEL;
    const processor = await tf.AutoProcessor.from_pretrained(modelId);
    const model = await tf.CLIPVisionModelWithProjection.from_pretrained(modelId, {
      dtype: MODEL_DTYPE,
    });
    const embedder: ImageEmbedder = {
      modelId,
      async embedImage(image: Buffer): Promise<number[]> {
        const raw = await tf.RawImage.fromBlob(new Blob([new Uint8Array(image)]));
        const { image_embeds } = await model(await processor(raw));
        return normalizeVector(image_embeds.data);
      },
    };
    return { embedder, reason: null };
  } catch (error) {
    logger.warn(errorFields(error), "CLIP modeli yüklenemedi; görsel embedding devre dışı");
    return { embedder: null, reason: "LOAD_FAILED" };
  }
}

/** Bayrak + paket + model durumuna göre embedder (süreç boyunca önbelleklenir). */
export async function getImageEmbedder(): Promise<EmbedderResult> {
  if (!visionFlagEnabled()) return { embedder: null, reason: "FLAG_OFF" };
  if (override !== undefined) {
    return override
      ? { embedder: override, reason: null }
      : { embedder: null, reason: "LOAD_FAILED" };
  }
  embedderPromise ??= loadEmbedder();
  return embedderPromise;
}
