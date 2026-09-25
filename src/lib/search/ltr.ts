import { existsSync } from "fs";
import path from "path";
import { getConfig } from "@/lib/config/app-config";
import { logger, errorFields } from "@/lib/observability/logger";
import {
  rankResults,
  rankingComponents,
  type RankedItem,
  type RankingInput,
  type RankingWeights,
} from "@/lib/search/ranking";

/**
 * Öğrenen sıralama (P1-2): LightGBM `lambdarank` → ONNX (`models/ranker.onnx`).
 *
 * `onnxruntime-node` isteğe bağlı bağımlılıktır ve TEMBEL yüklenir. Paket kurulamazsa
 * (ör. Alpine/musl), model dosyası yoksa veya çıkarım hata verirse `rankResults`
 * (ağırlıklı, açıklanabilir sıralama) kullanılır — arama hiçbir koşulda düşmez.
 * Özellik sırası `scripts/ltr/train.py` ile birebir aynı olmalıdır.
 */
export const LTR_FEATURES = [
  "relevance",
  "lexical",
  "vector",
  "trigram",
  "priceFit",
  "rating",
  "popularity",
  "personal",
] as const;

export type LtrFeature = (typeof LTR_FEATURES)[number];

export interface LtrInput extends RankingInput {
  lexical?: number;
  vector?: number;
  trigram?: number;
}

export interface LtrRanking {
  items: RankedItem[];
  /** Gerçekte kullanılan sıralayıcı (model yoksa "weighted"). */
  mode: "ltr" | "weighted";
}

/** Özellik matrisi (satır = aday, sütun = LTR_FEATURES). Değerler 0..1. */
export function buildFeatures(items: LtrInput[]): number[][] {
  const components = rankingComponents(items);
  return items.map((item, i) => {
    const c = components[i];
    const row: Record<LtrFeature, number> = {
      relevance: c.semantic,
      lexical: clamp01(item.lexical ?? 0),
      vector: clamp01(item.vector ?? 0),
      trigram: clamp01(item.trigram ?? 0),
      priceFit: c.priceFit,
      rating: c.rating,
      popularity: c.popularity,
      personal: c.personal,
    };
    return LTR_FEATURES.map((f) => row[f]);
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** onnxruntime-node'un kullandığımız en küçük yüzeyi (paket kurulu olmasa da derlenir). */
interface OrtTensor {
  data: ArrayLike<number | bigint>;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
}

export type OrtLoader = () => Promise<OrtModule>;

const ORT_PACKAGE = "onnxruntime-node";
const defaultLoader: OrtLoader = async () =>
  (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ ORT_PACKAGE)) as OrtModule;

let loader: OrtLoader = defaultLoader;
let sessionPromise: Promise<{ ort: OrtModule; session: OrtSession } | null> | null = null;

/** Yalnız testler: yükleyiciyi değiştirir ve önbelleği sıfırlar. */
export function setOrtLoaderForTests(next: OrtLoader | null): void {
  loader = next ?? defaultLoader;
  sessionPromise = null;
}

async function loadSession(): Promise<{ ort: OrtModule; session: OrtSession } | null> {
  const modelPath = path.resolve(process.cwd(), getConfig().LTR_MODEL_PATH);
  if (!existsSync(modelPath)) {
    logger.info({ modelPath }, "LTR modeli yok; ağırlıklı sıralama kullanılacak");
    return null;
  }
  try {
    const ort = await loader();
    const session = await ort.InferenceSession.create(modelPath);
    return { ort, session };
  } catch (error) {
    logger.warn(errorFields(error), "onnxruntime yüklenemedi; ağırlıklı sıralama kullanılacak");
    return null;
  }
}

/** Model + çalışma zamanı kullanılabilir mi? (sonuç süreç boyunca önbelleklenir) */
export async function ltrAvailable(): Promise<boolean> {
  sessionPromise ??= loadSession();
  return (await sessionPromise) !== null;
}

/**
 * LTR ile sıralar; `explain` açıklanabilirlik için ağırlıklı bileşenleri taşır, `score`
 * model çıktısıdır. Her hata yolunda ağırlıklı sıralamaya düşer.
 */
export async function rankWithLtr(items: LtrInput[], weights: RankingWeights): Promise<LtrRanking> {
  const weighted = rankResults(items, weights);
  if (items.length === 0) return { items: weighted, mode: "weighted" };
  sessionPromise ??= loadSession();
  const loaded = await sessionPromise;
  if (!loaded) return { items: weighted, mode: "weighted" };
  try {
    const features = buildFeatures(items);
    const flat = Float32Array.from(features.flat());
    const tensor = new loaded.ort.Tensor("float32", flat, [items.length, LTR_FEATURES.length]);
    const out = await loaded.session.run({ [loaded.session.inputNames[0]]: tensor });
    const scores = Array.from(out[loaded.session.outputNames[0]].data, Number);
    if (scores.length !== items.length || scores.some((s) => !Number.isFinite(s))) {
      throw new Error("LTR çıktısı beklenen boyutta değil");
    }
    const explainById = new Map(weighted.map((w) => [w.id, w.explain]));
    const ranked = items
      .map((item, i) => ({
        id: item.id,
        score: Math.round(scores[i] * 10_000) / 10_000,
        explain: explainById.get(item.id)!,
      }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { items: ranked, mode: "ltr" };
  } catch (error) {
    logger.warn(errorFields(error), "LTR çıkarımı başarısız; ağırlıklı sıralama");
    return { items: weighted, mode: "weighted" };
  }
}
