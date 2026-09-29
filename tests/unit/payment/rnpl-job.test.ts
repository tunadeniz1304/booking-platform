import { describe, expect, it, vi } from "vitest";
import type { Job, Queue } from "bullmq";

vi.mock("@/lib/payment/rnpl", () => ({
  RNPL_CHARGE_JOB: "rnpl-charge",
  RNPL_SWEEP_JOB: "rnpl-sweep",
  chargeRnplSchedule: vi.fn(async () => "charged"),
  sweepRnplCharges: vi.fn(async () => ({ enqueued: 0 })),
}));

import { processRnplJob, scheduleRnplSweep } from "@/worker/jobs/rnpl";
import { chargeRnplSchedule, sweepRnplCharges } from "@/lib/payment/rnpl";

const job = (name: string, data: Record<string, unknown> = {}) =>
  ({ name, data }) as unknown as Job<{ scheduleId?: string }>;

describe("P1-3 rnpl işçisi", () => {
  it("tahsilat işi takvimi tahsil eder; süpürücü tümünü tarar", async () => {
    await expect(processRnplJob(job("rnpl-charge", { scheduleId: "s1" }))).resolves.toBe("charged");
    expect(chargeRnplSchedule).toHaveBeenCalledWith("s1");
    await expect(processRnplJob(job("rnpl-sweep"))).resolves.toEqual({ enqueued: 0 });
    expect(sweepRnplCharges).toHaveBeenCalled();
  });

  it("eksik scheduleId ve bilinmeyen iş hata fırlatır", async () => {
    await expect(processRnplJob(job("rnpl-charge"))).rejects.toThrow("scheduleId");
    await expect(processRnplJob(job("nope"))).rejects.toThrow("Bilinmeyen RNPL işi: nope");
  });

  it("süpürücü UTC cron ile idempotent planlanır", async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await scheduleRnplSweep({ upsertJobScheduler } as unknown as Queue);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "rnpl-sweep",
      { pattern: "*/15 * * * *", tz: "UTC" },
      expect.objectContaining({ name: "rnpl-sweep", data: {} })
    );
  });
});
