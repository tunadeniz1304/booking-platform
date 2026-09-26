import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";

/**
 * Süreç-içi (orchestration) saga yürütücüsü (P0-7, ADR 0013).
 *
 * - Adımlar sırayla çalışır; bir adım `{ done }` dönerse saga erken biter (iş sonucu).
 * - Bir adım hata fırlatırsa: başarısız adım DAHİL, o ana kadarki adımların telafileri
 *   ters sırada çalışır. Telafiler idempotenttir ve bağlamdan (ctx) neyi geri alacağını
 *   kendisi anlar (ör. tahsil yoksa iade yapmaz) → kısmen uygulanmış adım da güvenle geri alınır.
 * - `pivot` adımı başarılı olduktan sonra geri dönüş yoktur; sonrası ileri-kurtarmadır
 *   (BullMQ FlowProducer ile yeniden denenen işler).
 * - `isOutcome(error)` true olan hatalar (ör. kart reddi) iş sonucudur → telafi çalışmaz.
 */
export interface SagaStep<C, R> {
  name: string;
  run(ctx: C): Promise<{ done: R } | void>;
  /** true/void → bir şey geri alındı (metriğe sayılır); false → yapılacak iş yoktu. */
  compensate?(ctx: C): Promise<boolean | void>;
  pivot?: boolean;
}

export interface SagaOptions {
  /**
   * Bu adımdan önceki adımlar saga dışında zaten tamamlanmıştır (ör. tutma ve provizyon):
   * çalıştırılmazlar ama herhangi bir hatada her zaman telafi edilirler.
   */
  from?: string;
  isOutcome?: (error: unknown) => boolean;
  /**
   * fix-sweep-3: en az bir telafi adımı başarısız olduysa (ör. void/iade PSP hatası) çağrılır;
   * saga bunu BullMQ `saga-compensation-retry` işine çevirir (idempotent yeniden deneme).
   * Kancanın kendi hatası yutulur (loglanır) — asıl hata çağırana yine fırlatılır.
   */
  onCompensationFailed?: (failedSteps: string[]) => Promise<void>;
}

export const sagaCompensationTotal = counter(
  "saga_compensation_total",
  "Saga telafi adımları (saga, adım, sonuç)",
  ["saga", "step", "outcome"] as const
);

export class SagaFaultError extends Error {
  constructor(
    readonly saga: string,
    readonly step: string
  ) {
    super(`Enjekte edilen saga hatası: ${saga}.${step}`);
    this.name = "SagaFaultError";
  }
}

export class SagaIncompleteError extends Error {
  constructor(readonly saga: string) {
    super(`Saga sonuç üretmeden bitti: ${saga}`);
    this.name = "SagaIncompleteError";
  }
}

/** Test amaçlı hata enjeksiyonu: `saga.step` çalışmak yerine hata fırlatır. */
const faults = new Set<string>();
export function injectSagaFaultForTests(saga: string, step: string | null): void {
  if (step === null) {
    for (const key of [...faults]) if (key.startsWith(`${saga}.`)) faults.delete(key);
    return;
  }
  faults.add(`${saga}.${step}`);
}

export function isSagaFaultInjected(saga: string, step: string): boolean {
  return faults.has(`${saga}.${step}`);
}

async function compensate<C>(
  saga: string,
  steps: SagaStep<C, unknown>[],
  ctx: C
): Promise<Array<{ step: string; error: unknown }>> {
  const failed: Array<{ step: string; error: unknown }> = [];
  for (const step of [...steps].reverse()) {
    if (!step.compensate) continue;
    try {
      const did = await step.compensate(ctx);
      if (did !== false) sagaCompensationTotal.inc({ saga, step: step.name, outcome: "ok" });
    } catch (error) {
      // Telafi başarısızsa diğerlerine devam edilir; alarm metriği + log + yeniden deneme işi.
      sagaCompensationTotal.inc({ saga, step: step.name, outcome: "failed" });
      logger.error({ saga, step: step.name, ...errorFields(error) }, "saga compensation failed");
      failed.push({ step: step.name, error });
    }
  }
  return failed;
}

export class SagaCompensationError extends Error {
  constructor(
    readonly saga: string,
    readonly steps: string[],
    readonly causes: unknown[]
  ) {
    super(`Saga telafisi tamamlanamadı: ${saga} (${steps.join(", ")})`);
    this.name = "SagaCompensationError";
  }
}

/**
 * fix-sweep-3: telafi adımlarını (idempotent) yeniden çalıştırır — `saga-compensation-retry`
 * işi kullanır. Herhangi biri yine başarısızsa `SagaCompensationError` (BullMQ yeniden dener).
 */
export async function rerunCompensations<C>(
  saga: string,
  steps: SagaStep<C, unknown>[],
  ctx: C
): Promise<void> {
  const failed = await compensate(saga, steps, ctx);
  if (failed.length > 0) {
    throw new SagaCompensationError(
      saga,
      failed.map((f) => f.step),
      failed.map((f) => f.error)
    );
  }
}

export async function runSaga<C, R>(
  saga: string,
  steps: SagaStep<C, R>[],
  ctx: C,
  options: SagaOptions = {}
): Promise<R> {
  const startIndex = options.from ? steps.findIndex((s) => s.name === options.from) : 0;
  if (startIndex < 0) throw new Error(`Bilinmeyen saga adımı: ${options.from}`);
  let pivoted = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      if (isSagaFaultInjected(saga, step.name)) throw new SagaFaultError(saga, step.name);
      if (i < startIndex) continue;
      const out = await step.run(ctx);
      if (step.pivot) pivoted = true;
      if (out) return out.done;
    } catch (error) {
      if (pivoted || options.isOutcome?.(error)) throw error;
      logger.warn({ saga, step: step.name, ...errorFields(error) }, "saga step failed");
      const upTo = Math.max(i + 1, startIndex);
      const failed = await compensate(saga, steps.slice(0, upTo) as SagaStep<C, unknown>[], ctx);
      if (failed.length > 0 && options.onCompensationFailed) {
        await options
          .onCompensationFailed(failed.map((f) => f.step))
          .catch((hookError) =>
            logger.error({ saga, ...errorFields(hookError) }, "compensation retry hook failed")
          );
      }
      throw error;
    }
  }
  throw new SagaIncompleteError(saga);
}
