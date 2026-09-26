import { describe, expect, it, vi } from "vitest";
import { rerunCompensations, runSaga, SagaCompensationError, type SagaStep } from "@/lib/saga/saga";

// fix-sweep-3: başarısız telafi kancası ve katı yeniden çalıştırma.
describe("saga telafi yeniden denemesi", () => {
  type Ctx = { log: string[]; failVoid: boolean };
  const steps = (): SagaStep<Ctx, string>[] => [
    {
      name: "hold",
      run: async () => undefined,
      compensate: async (ctx) => {
        ctx.log.push("release");
      },
    },
    {
      name: "authorize",
      run: async () => undefined,
      compensate: async (ctx) => {
        if (ctx.failVoid) throw new Error("void düştü");
        ctx.log.push("void");
      },
    },
    {
      name: "capture",
      run: async () => {
        throw new Error("capture düştü");
      },
    },
  ];

  it("telafi düşerse kancayı başarısız adımlarla çağırır; diğer telafiler yine çalışır", async () => {
    const hook = vi.fn(async () => undefined);
    const ctx: Ctx = { log: [], failVoid: true };
    await expect(runSaga("t", steps(), ctx, { onCompensationFailed: hook })).rejects.toThrow(
      "capture düştü"
    );
    expect(hook).toHaveBeenCalledWith(["authorize"]);
    expect(ctx.log).toEqual(["release"]);
  });

  it("telafiler başarılıysa kanca çağrılmaz; kancanın kendi hatası asıl hatayı gölgelemez", async () => {
    const hook = vi.fn(async () => undefined);
    await expect(
      runSaga("t", steps(), { log: [], failVoid: false }, { onCompensationFailed: hook })
    ).rejects.toThrow("capture düştü");
    expect(hook).not.toHaveBeenCalled();
    const broken = vi.fn(async () => {
      throw new Error("kuyruk yok");
    });
    await expect(
      runSaga("t", steps(), { log: [], failVoid: true }, { onCompensationFailed: broken })
    ).rejects.toThrow("capture düştü");
  });

  it("rerunCompensations: yine düşen adım → SagaCompensationError; başarılıysa sessiz", async () => {
    const all = steps() as SagaStep<Ctx, unknown>[];
    const failing: Ctx = { log: [], failVoid: true };
    const error = await rerunCompensations("t", all, failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SagaCompensationError);
    expect((error as SagaCompensationError).steps).toEqual(["authorize"]);
    const ok: Ctx = { log: [], failVoid: false };
    await rerunCompensations("t", all, ok);
    expect(ok.log).toEqual(["void", "release"]);
  });
});
