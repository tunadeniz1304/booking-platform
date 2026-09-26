import { describe, expect, it, vi } from "vitest";
import type { Job, Queue } from "bullmq";

vi.mock("@/lib/compliance/takedown", () => ({
  TAKEDOWN_SLA_CHECK_JOB: "takedown-sla-check",
  TAKEDOWN_SLA_SWEEP_JOB: "takedown-sla-sweep",
  checkTakedownSla: vi.fn(async () => "breached"),
  sweepTakedownSla: vi.fn(async () => ({ breached: 0 })),
}));

import { processComplianceJob, scheduleTakedownSlaSweep } from "@/worker/jobs/compliance";
import { checkTakedownSla, sweepTakedownSla } from "@/lib/compliance/takedown";

const job = (name: string, data: Record<string, unknown> = {}) =>
  ({ name, data }) as unknown as Job<{ takedownId?: string }>;

describe("P1-13a compliance işçisi", () => {
  it("SLA kontrol işi talebi kontrol eder; süpürücü tümünü tarar", async () => {
    await expect(
      processComplianceJob(job("takedown-sla-check", { takedownId: "t1" }))
    ).resolves.toBe("breached");
    expect(checkTakedownSla).toHaveBeenCalledWith("t1");
    await processComplianceJob(job("takedown-sla-sweep"));
    expect(sweepTakedownSla).toHaveBeenCalled();
  });

  it("eksik kimlik ve bilinmeyen iş hata fırlatır", async () => {
    await expect(processComplianceJob(job("takedown-sla-check"))).rejects.toThrow("takedownId");
    await expect(processComplianceJob(job("nope"))).rejects.toThrow("Bilinmeyen");
  });

  it("süpürücü UTC cron ile idempotent planlanır", async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await scheduleTakedownSlaSweep({ upsertJobScheduler } as unknown as Queue);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "takedown-sla-sweep",
      { pattern: "*/10 * * * *", tz: "UTC" },
      expect.objectContaining({ name: "takedown-sla-sweep" })
    );
  });
});
