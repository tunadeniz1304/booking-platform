import { SpanKind, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { redactText } from "./redaction";

/**
 * P1-5 — GenAI OpenTelemetry span'leri.
 *
 * OpenTelemetry GenAI semantic conventions "Development" statüsündedir; öznitelik adları
 * semconv **v1.37.0**'a sabitlenmiştir (ADR 0030). Sürüm yükseltmesi bilinçli yapılır.
 *
 * Gizlilik: prompt/yanıt içeriği span'e YALNIZCA `LLM_OTEL_CAPTURE_CONTENT=true` iken
 * yazılır ve yazılmadan önce KVKK redaksiyonundan (bir kez daha) geçer. Varsayılan kapalı →
 * span'de yalnız model, token sayıları, bitiş nedenleri gibi içeriksiz metaveri bulunur.
 */
export const GENAI_SEMCONV_VERSION = "1.37.0";

export const GENAI_ATTR = {
  operationName: "gen_ai.operation.name",
  providerName: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  requestTemperature: "gen_ai.request.temperature",
  requestMaxTokens: "gen_ai.request.max_tokens",
  responseModel: "gen_ai.response.model",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  inputMessages: "gen_ai.input.messages",
  outputMessages: "gen_ai.output.messages",
  serverAddress: "server.address",
  errorType: "error.type",
  /** Uygulamaya özgü (semconv dışı) öznitelikler `booking.` önekiyle. */
  task: "booking.llm.task",
  mode: "booking.llm.mode",
} as const;

const TRACER_NAME = "booking.llm";

export function getGenAiTracer(): Tracer {
  // Her çağrıda global sağlayıcıdan alınır: izleme sonradan kaydedilse de span'ler akar.
  return trace.getTracer(TRACER_NAME, GENAI_SEMCONV_VERSION);
}

export interface GenAiSpanInput {
  task: string;
  model: string;
  provider: string;
  serverAddress?: string;
  mode: "live" | "demo";
  temperature?: number;
  maxTokens?: number;
  /** Zaten redakte edilmiş mesajlar; yalnız içerik yakalama açıkken span'e yazılır. */
  messages?: ReadonlyArray<{ role: string; content?: unknown }>;
  captureContent: boolean;
}

export interface GenAiSpanResult {
  responseModel?: string;
  finishReasons?: string[];
  inputTokens?: number;
  outputTokens?: number;
  /** Model çıktısı (redakte takma adlı biçim); yalnız içerik yakalama açıkken yazılır. */
  output?: string | null;
}

function contentJson(messages: ReadonlyArray<{ role: string; content?: unknown }>): string {
  return redactText(
    JSON.stringify(
      messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : null,
      }))
    )
  );
}

/** Span'e çağrı sonucunu yazar (içerik yalnız `captureContent` ile). */
export function recordGenAiResult(
  span: Span,
  input: Pick<GenAiSpanInput, "captureContent">,
  result: GenAiSpanResult
): void {
  if (result.responseModel) span.setAttribute(GENAI_ATTR.responseModel, result.responseModel);
  if (result.finishReasons && result.finishReasons.length > 0) {
    span.setAttribute(GENAI_ATTR.responseFinishReasons, result.finishReasons);
  }
  if (result.inputTokens !== undefined) {
    span.setAttribute(GENAI_ATTR.usageInputTokens, result.inputTokens);
  }
  if (result.outputTokens !== undefined) {
    span.setAttribute(GENAI_ATTR.usageOutputTokens, result.outputTokens);
  }
  if (input.captureContent && typeof result.output === "string") {
    span.setAttribute(
      GENAI_ATTR.outputMessages,
      contentJson([{ role: "assistant", content: result.output }])
    );
  }
}

/**
 * Tek bir çıkarım isteğini `chat <model>` span'i içinde çalıştırır (semconv: CLIENT span,
 * ad `{operation} {model}`). Hata → span ERROR + `error.type`, hata yeniden fırlatılır.
 */
export async function withGenAiSpan<R>(
  tracer: Tracer,
  input: GenAiSpanInput,
  fn: (span: Span) => Promise<R>
): Promise<R> {
  const attributes: Record<string, string | number> = {
    [GENAI_ATTR.operationName]: "chat",
    [GENAI_ATTR.providerName]: input.provider,
    [GENAI_ATTR.requestModel]: input.model,
    [GENAI_ATTR.task]: input.task,
    [GENAI_ATTR.mode]: input.mode,
  };
  if (input.serverAddress) attributes[GENAI_ATTR.serverAddress] = input.serverAddress;
  if (input.temperature !== undefined) {
    attributes[GENAI_ATTR.requestTemperature] = input.temperature;
  }
  if (input.maxTokens !== undefined) attributes[GENAI_ATTR.requestMaxTokens] = input.maxTokens;
  if (input.captureContent && input.messages) {
    attributes[GENAI_ATTR.inputMessages] = contentJson(input.messages);
  }
  return tracer.startActiveSpan(
    `chat ${input.model}`,
    { kind: SpanKind.CLIENT, attributes },
    async (span) => {
      try {
        const out = await fn(span);
        span.setStatus({ code: SpanStatusCode.UNSET });
        return out;
      } catch (error) {
        span.setAttribute(GENAI_ATTR.errorType, (error as Error)?.name || "Error");
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    }
  );
}
