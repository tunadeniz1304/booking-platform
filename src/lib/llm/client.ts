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
import { Redactor } from "./redaction";
import { GuardError } from "./guards";
import { llmLatencySeconds, llmRequestsTotal, llmTokensTotal } from "./metrics";
import {
  createRedisBudget,
  currentLlmSubject,
  llmBudgetExceededTotal,
  type LlmBudget,
} from "./budget";
import { redis } from "@/lib/redis";

/**
 * LLM Sözleşmesi — tüm GenAI özellikleri LLM'e YALNIZCA bu istemci üzerinden erişir.
 *
 * - Mod `demo` (veya anahtar yok) → ağa hiç çıkılmaz, görev başına deterministik
 *   demo üreticisi çalışır (`llmMode: "demo"`).
 * - Canlı çağrıda timeout / 429 / 5xx / ağ / geçersiz JSON / şema / guard hatası →
 *   o çağrı için demo çıktısı, `llmMode: "fallback"` + kısa `reason` kodu. Asla fırlatmaz.
 * - Önce `response_format: json_object` denenir; sağlayıcı 400 dönerse aynı çağrı
 *   onsuz tekrarlanır ve sonuç süreç ömrü boyunca önbelleğe alınır.
 * - Yalnızca `message.content` kullanılır (`reasoning_content` vb. yok sayılır).
 * - LLM'e giden her mesaj KVKK redaksiyonundan geçer (`Redactor`).
 * - LLM bağlayıcı karar VERMEZ: çıktılar öneri/açıklama/çeviridir.
 */

export type LlmTask =
  "smart_filter" | "review_summary" | "trip_plan" | "listing_copy" | "event_extraction" | "smoke";

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
  /** Bütçe öznesi; verilmezse istek bağlamından (`runWithLlmSubject`) alınır. */
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
const jsonModeUnsupported = new Set<string>();

export function getLlmRuntimeStatus(): Readonly<LlmRuntimeStatus> {
  return { ...runtimeStatus };
}

/** Yalnızca testler için. */
export function resetLlmRuntimeForTests(): void {
  runtimeStatus.jsonModeSupported = null;
  runtimeStatus.lastError = null;
  jsonModeUnsupported.clear();
}

// --- Hata sınıflandırma --------------------------------------------------------

class EmptyResponseError extends Error {
  constructor() {
    super("Boş LLM yanıtı");
    this.name = "EmptyResponseError";
  }
}

class ToolLoopExceededError extends Error {
  constructor() {
    super("Araç adım sınırı aşıldı");
    this.name = "ToolLoopExceededError";
  }
}

export function classifyLlmError(error: unknown): FallbackReason {
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
  if ((error as Error)?.name === "AbortError") return "aborted";
  return "unknown";
}

// --- İstemci ------------------------------------------------------------------

export interface CreateLlmClientOptions {
  settings?: LlmSettings;
  /** Testler için: OpenAI SDK'nın kullanacağı `fetch`. */
  fetch?: typeof fetch;
  /** Günlük token bütçesi (varsayılan: Redis sayaçlı, `LLM_DAILY_TOKEN_BUDGET_PER_USER`). */
  budget?: LlmBudget;
}

type Completion = Pick<ChatCompletion, "choices" | "usage" | "model">;

export function createLlmClient(options: CreateLlmClientOptions = {}): LlmClient {
  const settings = options.settings ?? getLlmSettings();
  const jsonKey = `${settings.baseUrlHost}|${settings.model}`;
  const budget = options.budget ?? createRedisBudget(redis, settings.dailyTokenBudgetPerUser);

  /** Canlı çağrı öncesi: özne bütçesini doldurduysa `true` (→ demo, reason "budget"). */
  async function overBudget(task: LlmTask, subject: string | undefined): Promise<boolean> {
    if (!subject) return false;
    if (!(await budget.exceeded(subject))) return false;
    llmBudgetExceededTotal.inc({ task });
    return true;
  }

  async function charge(subject: string | undefined, usage?: LlmUsage): Promise<void> {
    if (subject && usage)
      await budget.consume(subject, usage.promptTokens + usage.completionTokens);
  }

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
      llmTokensTotal.inc({ task, kind: "prompt" }, usage.promptTokens);
      llmTokensTotal.inc({ task, kind: "completion" }, usage.completionTokens);
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
    const useJsonMode = wantJson && !jsonModeUnsupported.has(jsonKey);
    if (useJsonMode) {
      try {
        const res = await getSdk().chat.completions.create(
          { ...base, response_format: { type: "json_object" } },
          { signal }
        );
        runtimeStatus.jsonModeSupported = true;
        return res;
      } catch (error) {
        if (error instanceof APIError && error.status === 400) {
          // Sağlayıcı json_object desteklemiyor → süreç ömrü boyunca hatırla, düz metinle dene.
          jsonModeUnsupported.add(jsonKey);
          runtimeStatus.jsonModeSupported = false;
        } else {
          throw error;
        }
      }
    }
    return getSdk().chat.completions.create(base, { signal });
  }

  function usageOf(res: Completion): LlmUsage | undefined {
    if (!res.usage) return undefined;
    return {
      promptTokens: res.usage.prompt_tokens ?? 0,
      completionTokens: res.usage.completion_tokens ?? 0,
    };
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
    const data = await demo();
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
      if (await overBudget(task, subject)) {
        return demoResult(task, opts.demo, "fallback", started, "budget");
      }
      const redactor = new Redactor(opts.knownNames ?? []);
      try {
        const redacted = redactMessages(messages, redactor);
        logPrompt(task, redacted);
        const res = await create(
          {
            messages: redacted,
            temperature: opts.temperature ?? settings.temperature,
            max_tokens: opts.maxTokens ?? settings.maxTokens,
          },
          true,
          opts.signal
        );
        const usage = usageOf(res);
        await charge(subject, usage);
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
      if (await overBudget(task, subject)) {
        return demoResult(task, opts.demo, "fallback", started, "budget");
      }
      const redactor = new Redactor(opts.knownNames ?? []);
      try {
        const redacted = redactMessages(messages, redactor);
        logPrompt(task, redacted);
        const res = await create(
          {
            messages: redacted,
            temperature: opts.temperature ?? settings.temperature,
            max_tokens: opts.maxTokens ?? settings.maxTokens,
          },
          false,
          opts.signal
        );
        const usage = usageOf(res);
        await charge(subject, usage);
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
      if (await overBudget(task, subject)) {
        return {
          ...(await demoResult(task, opts.demo, "fallback", started, "budget")),
          toolCalls,
        };
      }
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
          const res = await create(
            {
              messages: convo,
              tools: toolDefs,
              temperature: opts.temperature ?? settings.temperature,
              max_tokens: opts.maxTokens ?? settings.maxTokens,
            },
            false,
            opts.signal
          );
          const u = usageOf(res);
          if (u) {
            usage.promptTokens += u.promptTokens;
            usage.completionTokens += u.completionTokens;
            await charge(subject, u);
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
