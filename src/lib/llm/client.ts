import "server-only";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ZodType } from "zod";
import { logger, errorFields } from "@/lib/observability/logger";
import { getLlmSettings, type LlmSettings } from "./settings";
import { LlmJsonError, parseJsonWithSchema } from "./json";
import { Redactor, redactText } from "./redaction";
import { GuardError } from "./guards";
import {
  llmConcurrencyRejectedTotal,
  llmLatencySeconds,
  llmRequestsTotal,
  llmRouteFor,
  llmTokensTotal,
} from "./metrics";
import {
  createRedisBudget,
  currentLlmSubject,
  llmBudgetExceededTotal,
  type LlmBudget,
} from "./budget";
import { redis } from "@/lib/redis";
import type { Tracer } from "@opentelemetry/api";
import { getGenAiTracer, recordGenAiResult, withGenAiSpan } from "./telemetry";
import { createLimiter, LimiterRejectedError, type Limiter } from "@/lib/resilience/limit";

/**
 * LLM Sözleşmesi — tüm GenAI özellikleri LLM'e YALNIZCA bu istemci üzerinden erişir.
 *
 * - Mod `demo` (veya anahtar yok) → ağa hiç çıkılmaz, görev başına deterministik
 *   demo üreticisi çalışır (`llmMode: "demo"`).
 * - Canlı çağrıda timeout / 429 / 5xx / ağ / geçersiz JSON / şema / guard hatası →
 *   o çağrı için demo çıktısı, `llmMode: "fallback"` + kısa `reason` kodu. Asla fırlatmaz.
 * - Önce `response_format: json_object` denenir; sağlayıcı `response_format` ile ilgili
 *   400 dönerse aynı çağrı onsuz tekrarlanır ve JSON modu `LLM_JSON_MODE_RETRY_MINUTES`
 *   boyunca kapalı tutulur (v5#18). Başka 400'ler (ör. bağlam taşması) JSON modunu
 *   kapatmaz; yalnız o çağrı fallback'e düşer.
 * - Yalnızca `message.content` kullanılır (`reasoning_content` vb. yok sayılır).
 * - LLM'e giden her mesaj KVKK redaksiyonundan geçer (`Redactor`).
 * - LLM bağlayıcı karar VERMEZ: çıktılar öneri/açıklama/çeviridir.
 * - Süreç başına en fazla `LLM_MAX_CONCURRENCY` istek aynı anda uçuştadır (v4#3);
 *   fazlası sırada bekler (sağlayıcıya ani yük/harcama patlaması gitmez). Kuyruk
 *   `LLM_MAX_QUEUE` ile sınırlı, beklemesi `LLM_QUEUE_TIMEOUT_MS` ile kısıtlı; dolu kuyruk
 *   veya zaman aşımı → SDK'ya gitmeden fallback, reason "concurrency" (v2-P0-5).
 * - Her canlı istek (araç döngüsünün her adımı ve embeddings dahil) bir bütçe öznesine
 *   atomik token rezervasyonu ister; özne yoksa veya bütçe doluysa SDK'ya gidilmez
 *   (fail-closed, v2-P0-4).
 * - `openai` SDK'sı YALNIZCA bu dosyada içe aktarılır (ESLint kısıtı; embeddings dahil).
 */

export type LlmTask =
  | "smart_filter"
  | "review_summary"
  | "trip_plan"
  | "listing_copy"
  | "event_extraction"
  | "message_draft"
  | "moderation_explain"
  | "revenue_explain"
  | "review_highlights"
  | "listing_compare"
  | "message_risk"
  | "smoke";

export type LlmMode = "live" | "demo" | "fallback";

export type FallbackReason =
  | "timeout"
  | "rate_limited"
  | "upstream_5xx"
  | "http_4xx"
  | "network"
  | "invalid_json"
  | "schema_invalid"
  | "guard_failed"
  | "aborted"
  | "empty_response"
  | "tool_loop_exceeded"
  | "budget"
  | "no_subject"
  | "concurrency"
  | "unknown";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResult<T> {
  data: T;
  /** AI Act Md. 50: her AI çıktısı işaretlenir (UI "AI tarafından üretildi" rozeti). */
  aiGenerated: true;
  llmMode: LlmMode;
  model: string;
  latencyMs: number;
  usage?: LlmUsage;
  /** Yalnızca `fallback` modunda: anahtar/URL içermeyen kısa hata kodu. */
  reason?: FallbackReason;
}

export interface LlmCallOptions<T> {
  /** Demo/fallback çıktısını üreten deterministik fonksiyon (zorunlu). */
  demo: () => T | Promise<T>;
  /** Redaksiyonda tam adıyla maskelenecek kişi adları. */
  knownNames?: readonly string[];
  /** Guard'lar: veriyi doğrular (gerekirse dönüştürür); `GuardError` → fallback. */
  validate?: (data: T) => T | void;
  /** Yanıttaki takma adları orijinal değerlere çevir (varsayılan: true). */
  restorePii?: boolean;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /**
   * Bütçe öznesi; verilmezse istek bağlamından (`runWithLlmSubject`) alınır. İkisi de
   * yoksa canlı çağrı yapılmaz (fail-closed, `reason: "no_subject"`).
   */
  subject?: string;
}

/** Araç çağrılı (tool-calling) döngü için araç tanımı. */
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Aracı deterministik kodla çalıştırır; dönen değer JSON'a serileştirilir. */
  execute: (args: unknown) => Promise<unknown>;
}

export interface LlmToolRunResult<T> extends LlmResult<T> {
  /** Çalıştırılan araç çağrıları (ad + sonuç) — sayı guard'ı için olgu kaynağı. */
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
}

export interface LlmClient {
  readonly settings: LlmSettings;
  completeJson<T>(
    task: LlmTask,
    schema: ZodType<T>,
    messages: LlmMessage[],
    opts: LlmCallOptions<T>
  ): Promise<LlmResult<T>>;
  completeText(
    task: LlmTask,
    messages: LlmMessage[],
    opts: LlmCallOptions<string>
  ): Promise<LlmResult<string>>;
  runTools<T>(
    task: LlmTask,
    schema: ZodType<T>,
    messages: LlmMessage[],
    tools: LlmTool[],
    opts: LlmCallOptions<T> & {
      /** Nihai veri, araç sonuçlarıyla doğrulanır (ör. sayı guard'ı). */
      validateWithTools?: (data: T, calls: LlmToolRunResult<T>["toolCalls"]) => T | void;
    }
  ): Promise<LlmToolRunResult<T>>;
}

// --- Süreç-içi durum (/api/llm/status) ----------------------------------------

interface LlmRuntimeStatus {
  jsonModeSupported: boolean | null;
  lastError: FallbackReason | null;
}

const runtimeStatus: LlmRuntimeStatus = { jsonModeSupported: null, lastError: null };
const MS_PER_MINUTE = 60_000;
/** `host|model` → JSON modunun yeniden deneneceği an (epoch ms). */
const jsonModeUnsupportedUntil = new Map<string, number>();

/** 400'ün sebebi `response_format` (json_object desteklenmiyor) mu? Param veya mesajdan. */
function isResponseFormatRejection(error: InstanceType<typeof APIError>): boolean {
  if (error.param === "response_format") return true;
  return /response_format|json_object|json[ _-]?mode/i.test(error.message ?? "");
}

export function getLlmRuntimeStatus(): Readonly<LlmRuntimeStatus> {
  return { ...runtimeStatus };
}

/** Yalnızca testler için. */
export function resetLlmRuntimeForTests(): void {
  runtimeStatus.jsonModeSupported = null;
  runtimeStatus.lastError = null;
  jsonModeUnsupportedUntil.clear();
}

// --- Eşzamanlılık (v4#3) --------------------------------------------------------

const processLimiters = new Map<string, Limiter>();

type LlmLimiterSettings = Pick<LlmSettings, "maxConcurrency" | "maxQueue" | "queueTimeoutMs">;

/**
 * Aynı sınır değerleri için süreç-çapı tek sınırlayıcı (chat + embeddings ortak havuz).
 * Kuyruk sınırlı ve beklemesi zaman aşımlı (v2-P0-5): patlamada kapanışlar bellekte birikmez.
 */
export function getLlmLimiter(settings: LlmLimiterSettings): Limiter {
  const key = `${settings.maxConcurrency}|${settings.maxQueue}|${settings.queueTimeoutMs}`;
  let limiter = processLimiters.get(key);
  if (!limiter) {
    limiter = createLimiter(settings.maxConcurrency, {
      maxQueue: settings.maxQueue,
      queueTimeoutMs: settings.queueTimeoutMs,
    });
    processLimiters.set(key, limiter);
  }
  return limiter;
}

/** Sınırlayıcı reddi (dolu kuyruk / kuyrukta zaman aşımı) sayılır; hata aynen fırlatılır. */
function countLimiterRejection(task: LlmTask | "embedding", error: unknown): void {
  if (error instanceof LimiterRejectedError) {
    llmConcurrencyRejectedTotal.inc({ task, reason: error.reason });
  }
}

// --- Hata sınıflandırma --------------------------------------------------------

class EmptyResponseError extends Error {
  constructor() {
    super("Boş LLM yanıtı");
    this.name = "EmptyResponseError";
  }
}

/** Canlı istekten önce bütçe rezervasyonu reddedildi → SDK'ya gidilmez. */
class BudgetDeniedError extends Error {
  constructor(readonly reason: "budget" | "no_subject") {
    super(reason === "budget" ? "LLM token bütçesi dolu" : "LLM bütçe öznesi yok");
    this.name = "BudgetDeniedError";
  }
}

class ToolLoopExceededError extends Error {
  constructor() {
    super("Araç adım sınırı aşıldı");
    this.name = "ToolLoopExceededError";
  }
}

function classifyLlmError(error: unknown): FallbackReason {
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  if (error instanceof APIConnectionError) return "network";
  if (error instanceof APIError) {
    const status = error.status ?? 0;
    if (status === 429) return "rate_limited";
    if (status >= 500) return "upstream_5xx";
    if (status >= 400) return "http_4xx";
    return "unknown";
  }
  if (error instanceof LlmJsonError) return error.code;
  if (error instanceof GuardError) return "guard_failed";
  if (error instanceof EmptyResponseError) return "empty_response";
  if (error instanceof ToolLoopExceededError) return "tool_loop_exceeded";
  if (error instanceof BudgetDeniedError) return error.reason;
  if (error instanceof LimiterRejectedError) return "concurrency";
  if ((error as Error)?.name === "AbortError") return "aborted";
  return "unknown";
}

// --- Bütçe rezervasyonu (v2-P0-4) ----------------------------------------------

/** Rezervasyon miktarı: istek gövdesinden temkinli prompt tahmini + azami yanıt token'ı. */
function estimateTokens(request: unknown, maxCompletion: number, charsPerToken: number): number {
  return Math.ceil(JSON.stringify(request).length / charsPerToken) + maxCompletion;
}

/** Sağlayıcı isteği 4xx ile reddetti (faturalanmaz) → rezervasyon iade edilebilir. */
function rejectedByProvider(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  const status = error.status ?? 0;
  return status >= 400 && status < 500;
}

interface BudgetHold {
  subject: string;
  reserved: number;
  /** Rezervasyon anı; düzeltme aynı gün anahtarına yazılır. */
  at: Date;
}

/**
 * Canlı istekten ÖNCE atomik rezervasyon (fail-closed): özne yoksa veya bütçe doluysa
 * `BudgetDeniedError`. Eşzamanlı çağrılar bütçeyi en fazla bir rezervasyon kadar aşabilir.
 */
async function holdBudget(
  budget: LlmBudget,
  task: LlmTask | "embedding",
  subject: string | undefined,
  tokens: number
): Promise<BudgetHold> {
  if (!subject) {
    logger.warn({ task }, "llm call without budget subject; skipped");
    throw new BudgetDeniedError("no_subject");
  }
  const at = new Date();
  if (!(await budget.reserve(subject, tokens, at))) {
    llmBudgetExceededTotal.inc({ task });
    throw new BudgetDeniedError("budget");
  }
  return { subject, reserved: tokens, at };
}

/**
 * Rezervasyonlu istek: yanıt gelince rezervasyon gerçek kullanımla düzeltilir (kullanım
 * bilinmiyorsa rezervasyon kalır); sağlayıcı 4xx ile reddettiyse rezervasyon iade edilir.
 */
async function withBudgetHold<R>(
  budget: LlmBudget,
  hold: BudgetHold,
  send: () => Promise<R>,
  usedTokens: (res: R) => number | undefined
): Promise<R> {
  let res: R;
  try {
    res = await send();
  } catch (error) {
    // Sağlayıcı reddi veya sınırlayıcı reddi (istek hiç gönderilmedi) faturalanmaz.
    if (rejectedByProvider(error) || error instanceof LimiterRejectedError)
      await budget.consume(hold.subject, -hold.reserved, hold.at);
    throw error;
  }
  const used = usedTokens(res);
  if (used !== undefined) await budget.consume(hold.subject, used - hold.reserved, hold.at);
  return res;
}

// --- İstemci ------------------------------------------------------------------

export interface CreateLlmClientOptions {
  settings?: LlmSettings;
  /** Testler için: OpenAI SDK'nın kullanacağı `fetch`. */
  fetch?: typeof fetch;
  /** Günlük token bütçesi (varsayılan: Redis sayaçlı, `LLM_DAILY_TOKEN_BUDGET_PER_USER`). */
  budget?: LlmBudget;
  /** Eşzamanlılık sınırlayıcı (varsayılan: `LLM_MAX_CONCURRENCY` süreç havuzu). */
  limiter?: Limiter;
  /** Testler için: GenAI span'lerini alacak tracer (varsayılan: global OTel sağlayıcısı). */
  tracer?: Tracer;
}

type Completion = Pick<ChatCompletion, "choices" | "usage" | "model">;

export function createLlmClient(options: CreateLlmClientOptions = {}): LlmClient {
  const settings = options.settings ?? getLlmSettings();
  const jsonKey = `${settings.baseUrlHost}|${settings.model}`;
  const budget =
    options.budget ??
    createRedisBudget(redis, settings.dailyTokenBudgetPerUser, settings.dailyTokenBudgetSystem);
  const limit = options.limiter ?? getLlmLimiter(settings);
  const tracer = (): Tracer => options.tracer ?? getGenAiTracer();

  /**
   * `LLM_LOG_PROMPTS=true` (production dışı) iken YALNIZCA redakte edilmiş prompt debug
   * seviyesinde loglanır (§3 v3-c) — ham kişisel veri asla log'a girmez.
   */
  function logPrompt(task: LlmTask, messages: ChatCompletionMessageParam[]): void {
    if (!settings.logPrompts) return;
    logger.debug({ task, messages }, "llm prompt (redacted)");
  }

  let sdk: OpenAI | null = null;
  function getSdk(): OpenAI {
    if (!sdk) {
      sdk = new OpenAI({
        apiKey: settings.apiKey,
        baseURL: settings.baseUrl,
        timeout: settings.timeoutSeconds * 1000,
        maxRetries: settings.maxRetries,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    }
    return sdk;
  }

  function record(
    task: LlmTask,
    mode: LlmMode,
    outcome: string,
    latencyMs: number,
    usage?: LlmUsage,
    reason?: FallbackReason
  ): void {
    llmRequestsTotal.inc({ task, mode, outcome });
    llmLatencySeconds.observe({ task, mode }, latencyMs / 1000);
    if (usage) {
      const route = llmRouteFor(task);
      llmTokensTotal.inc({ route, task, kind: "prompt" }, usage.promptTokens);
      llmTokensTotal.inc({ route, task, kind: "completion" }, usage.completionTokens);
    }
    logger.info(
      {
        task,
        llmMode: mode,
        model: settings.model,
        latencyMs,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        reason,
      },
      "llm call"
    );
  }

  async function create(
    params: Omit<ChatCompletionCreateParamsNonStreaming, "model">,
    wantJson: boolean,
    signal?: AbortSignal
  ): Promise<Completion> {
    const base: ChatCompletionCreateParamsNonStreaming = { ...params, model: settings.model };
    const now = Date.now();
    const retryAt = jsonModeUnsupportedUntil.get(jsonKey);
    if (retryAt !== undefined && now >= retryAt) jsonModeUnsupportedUntil.delete(jsonKey);
    const useJsonMode = wantJson && !jsonModeUnsupportedUntil.has(jsonKey);
    if (useJsonMode) {
      try {
        const res = await limit(() =>
          getSdk().chat.completions.create(
            { ...base, response_format: { type: "json_object" } },
            { signal }
          )
        );
        runtimeStatus.jsonModeSupported = true;
        return res;
      } catch (error) {
        if (error instanceof APIError && error.status === 400 && isResponseFormatRejection(error)) {
          // Sağlayıcı json_object desteklemiyor → TTL boyunca hatırla, bu çağrıyı düz metinle dene.
          jsonModeUnsupportedUntil.set(
            jsonKey,
            Date.now() + settings.jsonModeRetryMinutes * MS_PER_MINUTE
          );
          runtimeStatus.jsonModeSupported = false;
        } else {
          // Diğer hatalar (bağlam taşması dahil) → çağıran fallback'e düşer; JSON modu açık kalır.
          throw error;
        }
      }
    }
    return limit(() => getSdk().chat.completions.create(base, { signal }));
  }

  function usageOf(res: Completion): LlmUsage | undefined {
    if (!res.usage) return undefined;
    return {
      promptTokens: res.usage.prompt_tokens ?? 0,
      completionTokens: res.usage.completion_tokens ?? 0,
    };
  }

  /** Bütçe rezervasyonlu tek SDK isteği (araç döngüsünde her adım ayrı rezervasyon). */
  async function metered(
    task: LlmTask,
    subject: string | undefined,
    params: Omit<ChatCompletionCreateParamsNonStreaming, "model">,
    wantJson: boolean,
    signal?: AbortSignal
  ): Promise<{ res: Completion; usage?: LlmUsage }> {
    const hold = await holdBudget(
      budget,
      task,
      subject,
      estimateTokens(params, params.max_tokens ?? settings.maxTokens, settings.promptCharsPerToken)
    );
    const res = await withBudgetHold(
      budget,
      hold,
      () =>
        withGenAiSpan(
          tracer(),
          {
            task,
            model: settings.model,
            provider: "openai",
            serverAddress: settings.baseUrlHost,
            mode: "live",
            temperature: params.temperature ?? undefined,
            maxTokens: params.max_tokens ?? undefined,
            messages: params.messages,
            captureContent: settings.otelCaptureContent,
          },
          async (span) => {
            const r = await create(params, wantJson, signal);
            const u = usageOf(r);
            recordGenAiResult(
              span,
              { captureContent: settings.otelCaptureContent },
              {
                responseModel: r.model,
                finishReasons: (r.choices ?? [])
                  .map((c) => c.finish_reason)
                  .filter((f): f is NonNullable<typeof f> => typeof f === "string"),
                inputTokens: u?.promptTokens,
                outputTokens: u?.completionTokens,
                output: r.choices?.[0]?.message?.content ?? null,
              }
            );
            return r;
          }
        ),
      (r) => {
        const u = usageOf(r);
        return u ? u.promptTokens + u.completionTokens : undefined;
      }
    );
    return { res, usage: usageOf(res) };
  }

  function contentOf(res: Completion): string {
    // Yalnızca `message.content`; `reasoning_content` gibi sağlayıcıya özgü alanlar yok sayılır.
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new EmptyResponseError();
    }
    return content;
  }

  function redactMessages(
    messages: LlmMessage[],
    redactor: Redactor
  ): ChatCompletionMessageParam[] {
    return messages.map((m) => ({ role: m.role, content: redactor.redact(m.content) }));
  }

  async function demoResult<T>(
    task: LlmTask,
    demo: () => T | Promise<T>,
    mode: "demo" | "fallback",
    started: number,
    reason?: FallbackReason
  ): Promise<LlmResult<T>> {
    const data =
      mode === "demo"
        ? await withGenAiSpan(
            tracer(),
            {
              task,
              model: settings.model,
              provider: "booking.demo",
              mode: "demo",
              captureContent: false,
            },
            async () => demo()
          )
        : await demo();
    const latencyMs = Date.now() - started;
    record(
      task,
      mode,
      mode === "demo" ? "demo" : `fallback_${reason ?? "unknown"}`,
      latencyMs,
      undefined,
      reason
    );
    return {
      data,
      aiGenerated: true,
      llmMode: mode,
      model: settings.model,
      latencyMs,
      ...(reason ? { reason } : {}),
    };
  }

  async function handleFailure<T>(
    task: LlmTask,
    error: unknown,
    demo: () => T | Promise<T>,
    started: number
  ): Promise<LlmResult<T>> {
    // Bütçe reddi sağlayıcı hatası değildir: süreç durumu (lastError) değişmez.
    if (error instanceof BudgetDeniedError) {
      return demoResult(task, demo, "fallback", started, error.reason);
    }
    countLimiterRejection(task, error);
    const reason = classifyLlmError(error);
    runtimeStatus.lastError = reason;
    logger.warn({ task, reason, ...errorFields(error) }, "llm fallback");
    return demoResult(task, demo, "fallback", started, reason);
  }

  const client: LlmClient = {
    settings,

    async completeJson<T>(
      task: LlmTask,
      schema: ZodType<T>,
      messages: LlmMessage[],
      opts: LlmCallOptions<T>
    ): Promise<LlmResult<T>> {
      const started = Date.now();
      if (settings.effectiveMode === "demo") {
        return demoResult(task, opts.demo, "demo", started);
      }
      const subject = opts.subject ?? currentLlmSubject();
      const redactor = new Redactor(opts.knownNames ?? []);
      try {
        const redacted = redactMessages(messages, redactor);
        logPrompt(task, redacted);
        const { res, usage } = await metered(
          task,
          subject,
          {
            messages: redacted,
            temperature: opts.temperature ?? settings.temperature,
            max_tokens: opts.maxTokens ?? settings.maxTokens,
          },
          true,
          opts.signal
        );
        let data = parseJsonWithSchema(contentOf(res), schema);
        if (opts.restorePii !== false) data = redactor.restoreDeep(data);
        if (opts.validate) data = opts.validate(data) ?? data;
        const latencyMs = Date.now() - started;
        runtimeStatus.lastError = null;
        record(task, "live", "success", latencyMs, usage);
        return {
          data,
          aiGenerated: true,
          llmMode: "live",
          model: settings.model,
          latencyMs,
          usage,
        };
      } catch (error) {
        return handleFailure(task, error, opts.demo, started);
      }
    },

    async completeText(
      task: LlmTask,
      messages: LlmMessage[],
      opts: LlmCallOptions<string>
    ): Promise<LlmResult<string>> {
      const started = Date.now();
      if (settings.effectiveMode === "demo") {
        return demoResult(task, opts.demo, "demo", started);
      }
      const subject = opts.subject ?? currentLlmSubject();
      const redactor = new Redactor(opts.knownNames ?? []);
      try {
        const redacted = redactMessages(messages, redactor);
        logPrompt(task, redacted);
        const { res, usage } = await metered(
          task,
          subject,
          {
            messages: redacted,
            temperature: opts.temperature ?? settings.temperature,
            max_tokens: opts.maxTokens ?? settings.maxTokens,
          },
          false,
          opts.signal
        );
        let text = contentOf(res).trim();
        if (opts.restorePii !== false) text = redactor.restore(text);
        if (opts.validate) text = opts.validate(text) ?? text;
        const latencyMs = Date.now() - started;
        runtimeStatus.lastError = null;
        record(task, "live", "success", latencyMs, usage);
        return {
          data: text,
          aiGenerated: true,
          llmMode: "live",
          model: settings.model,
          latencyMs,
          usage,
        };
      } catch (error) {
        return handleFailure(task, error, opts.demo, started);
      }
    },

    async runTools<T>(
      task: LlmTask,
      schema: ZodType<T>,
      messages: LlmMessage[],
      tools: LlmTool[],
      opts: LlmCallOptions<T> & {
        validateWithTools?: (data: T, calls: LlmToolRunResult<T>["toolCalls"]) => T | void;
      }
    ): Promise<LlmToolRunResult<T>> {
      const started = Date.now();
      const toolCalls: LlmToolRunResult<T>["toolCalls"] = [];
      if (settings.effectiveMode === "demo") {
        return { ...(await demoResult(task, opts.demo, "demo", started)), toolCalls };
      }
      const subject = opts.subject ?? currentLlmSubject();
      const redactor = new Redactor(opts.knownNames ?? []);
      const byName = new Map(tools.map((t) => [t.name, t]));
      const toolDefs: ChatCompletionTool[] = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      const convo: ChatCompletionMessageParam[] = redactMessages(messages, redactor);
      logPrompt(task, convo);
      const usage: LlmUsage = { promptTokens: 0, completionTokens: 0 };

      try {
        for (let step = 0; step <= settings.maxToolSteps; step++) {
          // Her adım ayrı rezervasyon: bütçe adım ortasında dolarsa sonraki istek yapılmaz.
          const { res, usage: u } = await metered(
            task,
            subject,
            {
              messages: convo,
              tools: toolDefs,
              temperature: opts.temperature ?? settings.temperature,
              max_tokens: opts.maxTokens ?? settings.maxTokens,
            },
            false,
            opts.signal
          );
          if (u) {
            usage.promptTokens += u.promptTokens;
            usage.completionTokens += u.completionTokens;
          }
          const message = res.choices?.[0]?.message;
          const calls = message?.tool_calls ?? [];
          if (calls.length === 0) {
            let data = parseJsonWithSchema(contentOf(res), schema);
            if (opts.restorePii !== false) data = redactor.restoreDeep(data);
            if (opts.validate) data = opts.validate(data) ?? data;
            if (opts.validateWithTools) data = opts.validateWithTools(data, toolCalls) ?? data;
            const latencyMs = Date.now() - started;
            runtimeStatus.lastError = null;
            record(task, "live", "success", latencyMs, usage);
            return {
              data,
              aiGenerated: true,
              llmMode: "live",
              model: settings.model,
              latencyMs,
              usage,
              toolCalls,
            };
          }
          if (step === settings.maxToolSteps) break;
          convo.push({
            role: "assistant",
            content: message?.content ?? null,
            tool_calls: calls,
          });
          for (const call of calls) {
            if (call.type !== "function") continue;
            const tool = byName.get(call.function.name);
            let result: unknown;
            let args: unknown = {};
            try {
              args = JSON.parse(call.function.arguments || "{}");
              result = tool ? await tool.execute(args) : { error: "Bilinmeyen araç" };
            } catch (error) {
              result = { error: (error as Error).message.slice(0, 200) };
            }
            toolCalls.push({ name: call.function.name, args, result });
            convo.push({
              role: "tool",
              tool_call_id: call.id,
              content: redactor.redact(JSON.stringify(result)),
            });
          }
        }
        throw new ToolLoopExceededError();
      } catch (error) {
        return { ...(await handleFailure(task, error, opts.demo, started)), toolCalls };
      }
    },
  };

  return client;
}

let defaultClient: LlmClient | null = null;

/** Uygulama-çapı varsayılan istemci (ayarlar `.env`'den). */
export function getLlmClient(): LlmClient {
  if (!defaultClient) defaultClient = createLlmClient();
  return defaultClient;
}

// --- Embeddings (§3: redaksiyon + bütçe + eşzamanlılık tüm yollarda) -----------------

/** OpenAI-uyumlu `/embeddings` çağrısı: metinler → vektörler. */
export type EmbedFn = (texts: string[], dimensions: number) => Promise<number[][]>;

export class LlmBudgetExceededError extends Error {
  constructor(readonly reason: "budget" | "no_subject" = "budget") {
    super(reason === "budget" ? "Günlük LLM token bütçesi aşıldı" : "LLM bütçe öznesi yok");
    this.name = "LlmBudgetExceededError";
  }
}

export interface RemoteEmbedOptions {
  settings?: LlmSettings;
  fetch?: typeof fetch;
  budget?: LlmBudget;
  limiter?: Limiter;
}

/**
 * Canlı mod + `EMBEDDING_MODEL` varsa uzak embedding fonksiyonu, yoksa `null`
 * (çağıran ağsız hash-embedder'a düşer). Giden her metin KVKK redaksiyonundan geçer;
 * istek bağlamındaki özneye atomik token rezervasyonu yapılır. Özne yoksa veya bütçe
 * doluysa ağa çıkılmaz: `LlmBudgetExceededError` → çağıran deterministik yola düşer.
 */
export function createRemoteEmbedFn(
  model: string | undefined,
  options: RemoteEmbedOptions = {}
): EmbedFn | null {
  const llm = options.settings ?? getLlmSettings();
  if (!model || llm.effectiveMode !== "live" || !llm.apiKey) return null;
  const budget =
    options.budget ??
    createRedisBudget(redis, llm.dailyTokenBudgetPerUser, llm.dailyTokenBudgetSystem);
  const limit = options.limiter ?? getLlmLimiter(llm);
  const client = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
    timeout: llm.timeoutSeconds * 1000,
    maxRetries: llm.maxRetries,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return async (texts, dimensions) => {
    const input = texts.map((t) => redactText(t));
    let hold: BudgetHold;
    try {
      hold = await holdBudget(
        budget,
        "embedding",
        currentLlmSubject(),
        estimateTokens(input, 0, llm.promptCharsPerToken)
      );
    } catch (error) {
      if (error instanceof BudgetDeniedError) throw new LlmBudgetExceededError(error.reason);
      throw error;
    }
    const res = await withBudgetHold(
      budget,
      hold,
      () =>
        limit(() => client.embeddings.create({ model, input, dimensions })).catch(
          (error: unknown) => {
            // Dolu kuyruk / zaman aşımı: sayılır ve fırlatılır (çağıran deterministik yola düşer).
            countLimiterRejection("embedding", error);
            throw error;
          }
        ),
      (r) => r.usage?.total_tokens
    );
    return res.data.map((d) => d.embedding);
  };
}
