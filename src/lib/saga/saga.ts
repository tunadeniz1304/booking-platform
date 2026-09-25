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

async function compensate<C>(saga: string, steps: SagaStep<C, unknown>[], ctx: C): Promise<void> {
  for (const step of [...steps].reverse()) {
    if (!step.compensate) continue;
    try {
      const did = await step.compensate(ctx);
      if (did !== false) sagaCompensationTotal.inc({ saga, step: step.name, outcome: "ok" });
    } catch (error) {
      // Telafi başarısızsa diğerlerine devam edilir; alarm metriği + log ile elle müdahale.
      sagaCompensationTotal.inc({ saga, step: step.name, outcome: "failed" });
      logger.error({ saga, step: step.name, ...errorFields(error) }, "saga compensation failed");
    }
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
      await compensate(saga, steps.slice(0, upTo) as SagaStep<C, unknown>[], ctx);
      throw error;
    }
  }
  throw new SagaIncompleteError(saga);
}
