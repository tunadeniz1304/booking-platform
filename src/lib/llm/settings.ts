import { z } from "zod";
import { loadEnv } from "@/lib/config/load-env";

/**
 * LLM ayarları — tek zod şeması, tek `getLlmSettings()`.
 *
 * Değişken önceliği (ilk bulunan kazanır):
 *  - Anahtar:  LLM_API_KEY → DEEPSEEK_API_KEY → EVREN_API_KEY → OPENAI_API_KEY
 *  - Base URL: LLM_BASE_URL → DEEPSEEK_BASE_URL → EVREN_BASE_URL → OPENAI_BASE_URL
 *  - Model:    LLM_MODEL → DEEPSEEK_MODEL
 *  - v4: LLM_MAX_CONCURRENCY (varsayılan 4), LLM_VISION_MODEL (opsiyonel)
 *  - Bütçe: LLM_DAILY_TOKEN_BUDGET_PER_USER, LLM_DAILY_TOKEN_BUDGET_SYSTEM,
 *    LLM_PROMPT_CHARS_PER_TOKEN (rezervasyon tahmini)
 *
 * Anahtarın kendisi yalnızca istemci oluşturulurken kullanılır; log, hata
 * mesajı, durum yanıtı veya telemetride asla yer almaz (yalnızca `hasKey`).
 */

export const DEFAULT_BASE_URL = "https://evren-llmapi.ssyz.org.tr/v1";
export const DEFAULT_MODEL = "deepseek-v4-flash";

export const LLM_DEFAULTS = {
  timeoutSeconds: 20,
  maxRetries: 2,
  temperature: 0.2,
  maxTokens: 800,
  maxToolSteps: 5,
  /** Kullanıcı (özne) başına günlük token bütçesi; 0 = sınırsız. */
  dailyTokenBudgetPerUser: 50_000,
  /** Sistem işleri (`sys:<iş>`, ör. embedding indeksleme) başına günlük bütçe; 0 = sınırsız. */
  dailyTokenBudgetSystem: 1_000_000,
  /** Bütçe rezervasyonunda prompt token tahmini: karakter / bu değer (Türkçe için temkinli). */
  promptCharsPerToken: 3,
  /** Süreç başına aynı anda uçuşta olabilecek azami LLM/embedding isteği (v4#3). */
  maxConcurrency: 4,
} as const;

const KEY_VARS = ["LLM_API_KEY", "DEEPSEEK_API_KEY", "EVREN_API_KEY", "OPENAI_API_KEY"] as const;
const BASE_URL_VARS = [
  "LLM_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "EVREN_BASE_URL",
  "OPENAI_BASE_URL",
] as const;
const MODEL_VARS = ["LLM_MODEL", "DEEPSEEK_MODEL"] as const;

const settingsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().default(DEFAULT_BASE_URL),
  model: z.string().min(1).default(DEFAULT_MODEL),
  mode: z.enum(["auto", "live", "demo"]).default("auto"),
  timeoutSeconds: z.coerce.number().min(1).max(120).default(LLM_DEFAULTS.timeoutSeconds),
  maxRetries: z.coerce.number().int().min(0).max(5).default(LLM_DEFAULTS.maxRetries),
  temperature: z.coerce.number().min(0).max(1.5).default(LLM_DEFAULTS.temperature),
  maxTokens: z.coerce.number().int().min(64).max(4096).default(LLM_DEFAULTS.maxTokens),
  maxToolSteps: z.coerce.number().int().min(1).max(10).default(LLM_DEFAULTS.maxToolSteps),
  dailyTokenBudgetPerUser: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .default(LLM_DEFAULTS.dailyTokenBudgetPerUser),
  dailyTokenBudgetSystem: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .default(LLM_DEFAULTS.dailyTokenBudgetSystem),
  promptCharsPerToken: z.coerce.number().min(1).max(8).default(LLM_DEFAULTS.promptCharsPerToken),
  maxConcurrency: z.coerce.number().int().min(1).max(64).default(LLM_DEFAULTS.maxConcurrency),
  /** Opsiyonel görsel (vision) model; yoksa görsel özellikler deterministik yola düşer. */
  visionModel: z.string().min(1).optional(),
  logPrompts: z.boolean().default(false),
});

export type LlmSettings = z.infer<typeof settingsSchema> & {
  /** Anahtar yoksa veya mod `demo` ise ağa hiç çıkılmaz. */
  effectiveMode: "live" | "demo";
  hasKey: boolean;
  /** Base URL'nin yalnızca host kısmı (log/durum için güvenli). */
  baseUrlHost: string;
  /** Geçersiz değer nedeniyle varsayılana dönen ayar adları (değerleri değil). */
  invalidKeys: string[];
};

type Env = Record<string, string | undefined>;

function firstDefined(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * Ortam değişkenlerinden ayarları üretir. Geçersiz sayısal/enum değerler
 * uygulamayı düşürmez: ilgili alan varsayılana döner ve adı `invalidKeys`'e yazılır.
 */
export function parseLlmSettings(env: Env): LlmSettings {
  const raw = {
    apiKey: firstDefined(env, KEY_VARS),
    baseUrl: firstDefined(env, BASE_URL_VARS),
    model: firstDefined(env, MODEL_VARS),
    mode: env.LLM_MODE?.trim().toLowerCase() || undefined,
    timeoutSeconds: env.LLM_TIMEOUT_SECONDS || undefined,
    maxRetries: env.LLM_MAX_RETRIES || undefined,
    temperature: env.LLM_TEMPERATURE || undefined,
    maxTokens: env.LLM_MAX_TOKENS || undefined,
    maxToolSteps: env.LLM_MAX_TOOL_STEPS || undefined,
    dailyTokenBudgetPerUser: env.LLM_DAILY_TOKEN_BUDGET_PER_USER || undefined,
    dailyTokenBudgetSystem: env.LLM_DAILY_TOKEN_BUDGET_SYSTEM || undefined,
    promptCharsPerToken: env.LLM_PROMPT_CHARS_PER_TOKEN || undefined,
    maxConcurrency: env.LLM_MAX_CONCURRENCY || undefined,
    visionModel: env.LLM_VISION_MODEL?.trim() || undefined,
    logPrompts: env.LLM_LOG_PROMPTS === "true" && env.NODE_ENV !== "production",
  };

  const invalidKeys: string[] = [];
  let parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const cleaned: Record<string, unknown> = { ...raw };
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      invalidKeys.push(key);
      cleaned[key] = undefined;
    }
    parsed = settingsSchema.safeParse(cleaned);
    if (!parsed.success) {
      // Savunmacı: temizlenmiş girdiyle de parse edilemezse tamamen varsayılanlar.
      parsed = settingsSchema.safeParse({});
    }
  }
  const data = parsed.success ? parsed.data : settingsSchema.parse({});

  const hasKey = Boolean(data.apiKey);
  const effectiveMode: "live" | "demo" = data.mode === "demo" || !hasKey ? "demo" : "live";

  return {
    ...data,
    effectiveMode,
    hasKey,
    baseUrlHost: hostOf(data.baseUrl),
    invalidKeys,
  };
}

let cached: LlmSettings | null = null;

/** Süreç ömrü boyunca tekil ayar nesnesi (`.env` yüklenerek). */
export function getLlmSettings(): LlmSettings {
  if (!cached) {
    loadEnv();
    cached = parseLlmSettings(process.env);
  }
  return cached;
}

/** Yalnızca testler için: önbelleği sıfırlar. */
export function resetLlmSettingsForTests(): void {
  cached = null;
}

/** Başlangıç logu için tek satırlık açıklama (anahtar içermez). */
export function describeLlmMode(settings: LlmSettings): string {
  return settings.effectiveMode === "live"
    ? `LLM: CANLI (${settings.model} @ ${settings.baseUrlHost})`
    : "LLM: DEMO modu";
}
