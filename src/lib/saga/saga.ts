import { Command, DomainEvent } from "../cqrs/types";

/**
 * Saga Orkestratörü (Choreography yerine Orchestration — merkezi koordinatör).
 *
 * Dağıtık/bileşik bir süreci adım adım yürütür; her adımın telafisi (compensate)
 * tanımlıdır. Bir adım başarısız olursa daha önce tamamlanan adımlar ters
 * sırayla "compensate" edilerek sistem tutarlı duruma döndürülür.
 *
 * Örnek: BookingCreated → PaymentCharged → BookingConfirmed.
 * Payment başarısızsa BookingCompensated (stok serbest, rezervasyon iptal).
 */
export type SagaContext<S> = {
  readonly correlationId: string;
  readonly command: Command;
  state: S;
};

export interface SagaStep<S> {
  readonly name: string;
  invoke(ctx: SagaContext<S>): Promise<void>;
  /** Başarısızlıkta geri-alma işlemi (yoksa adım telafi edilemez işlem yapmaz). */
  compensate?(ctx: SagaContext<S>): Promise<void>;
}

export type SagaEventEmitter = (event: DomainEvent) => Promise<void>;

export class SagaExecutionError extends Error {
  constructor(
    readonly stepName: string,
    readonly cause: unknown
  ) {
    super(`Saga step "${stepName}" failed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "SagaExecutionError";
  }
}

export class Saga<S> {
  constructor(
    private readonly steps: SagaStep<S>[],
    private readonly emit: SagaEventEmitter
  ) {}

  async execute(command: Command, initialState: S): Promise<S> {
    const ctx: SagaContext<S> = {
      correlationId: command.correlationId ?? "",
      command,
      state: initialState,
    };
    const completed: SagaStep<S>[] = [];

    for (const step of this.steps) {
      try {
        await step.invoke(ctx);
        completed.push(step);
      } catch (error) {
        // Telafi: tamamlanan adımları ters sırayla geri al.
        for (const done of [...completed].reverse()) {
          if (done.compensate) {
            try {
              await done.compensate(ctx);
            } catch (compError) {
              console.error(
                `Saga compensate "${done.name}" failed after "${step.name}" failure:`,
                compError
              );
            }
          }
        }
        throw new SagaExecutionError(step.name, error);
      }
    }

    return ctx.state;
  }
}
