import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { updateAvailabilityPrices } from "./pricing-service";
import { ingestExternalSignal, ExternalSignalInput } from "./sentiment/trigger";

const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const pricingQueue = new Queue("pricing", { connection });

export const pricingWorker = new Worker(
  "pricing",
  async (job: Job) => {
    // Doğru imza: updateAvailabilityPrices(roomId, dates[], basePrice, currency)
    const data = job.data as {
      roomId?: string;
      dates?: string[];
      basePrice?: number;
      currency?: string;
    };

    if (!data.roomId || !data.dates || data.dates.length === 0) {
      throw new Error("Invalid pricing job payload: roomId and dates are required");
    }

    await updateAvailabilityPrices(
      data.roomId,
      data.dates,
      data.basePrice ?? 0,
      data.currency ?? "TRY"
    );
  },
  { connection }
);

export async function addPricingUpdateJob(
  roomId: string,
  dates: string[],
  basePrice: number,
  currency?: string
): Promise<Job> {
  return pricingQueue.add(
    "update-pricing",
    {
      roomId,
      dates,
      basePrice,
      currency: currency ?? "TRY",
    },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

export async function setupPricingCron(): Promise<void> {
  const repeatableJobs = await pricingQueue.getRepeatableJobs();
  const existing = repeatableJobs.find((job) => job.name === "update-pricing-cron");
  if (!existing) {
    await pricingQueue.add(
      "update-pricing-cron",
      {},
      {
        repeat: { pattern: "0 3 * * *" },
        jobId: "update-pricing-cron",
      }
    );
  }
}

// --- Global Sentiment & Event Trigger (asenkron sinyal kuyruğu) ---------------

export const eventSignalQueue = new Queue("event-signal", { connection });

export const eventSignalWorker = new Worker(
  "event-signal",
  async (job: Job) => {
    const signal = job.data as ExternalSignalInput;
    if (!signal?.title || !signal.startsOn || !signal.endsOn) {
      throw new Error("Invalid event-signal payload");
    }
    await ingestExternalSignal(signal);
  },
  { connection }
);

export async function addEventSignalJob(signal: ExternalSignalInput): Promise<Job> {
  return eventSignalQueue.add("apply-event-signal", signal, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
