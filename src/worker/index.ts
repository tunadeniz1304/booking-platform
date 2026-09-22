/**
 * Üretim arka-plan işçisi (bağımsız süreç):
 *
 *   npm run worker
 *
 * Görevler:
 *  - BullMQ pricing kuyruğunu işler (fiyat güncellemeleri).
 *  - Transactional Outbox'ı periyodik olarak boşaltır (at-least-once yayın).
 *
 * Docker Compose'ta ayrı bir replika olarak ölçeklenebilir; Next.js
 * sunucusuna bağımlı değildir.
 */
import { pricingWorker } from "@/lib/queue";
import { runOutboxRelay } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";

const OUTBOX_RELAY_INTERVAL_MS = 30_000;
const OUTBOX_RELAY_BATCH = 100;

let relayTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;

async function drainOutbox(): Promise<void> {
  if (shuttingDown) return;
  try {
    const published = await runOutboxRelay(OUTBOX_RELAY_BATCH);
    if (published > 0) {
      console.log(`[outbox] ${published} olay yayınlandı`);
    }
  } catch (error) {
    console.error("[outbox] relay hatası:", error);
  }
}

async function main(): Promise<void> {
  registerEventHandlers();

  // Başlangıçta birikmiş mesajları boşalt
  await drainOutbox();

  // Periyodik boşaltma
  relayTimer = setInterval(drainOutbox, OUTBOX_RELAY_INTERVAL_MS);

  pricingWorker.on("completed", (job) => {
    console.log(`[pricing] iş tamam: ${job.id}`);
  });
  pricingWorker.on("failed", (job, err) => {
    console.error(`[pricing] iş başarısız ${job?.id}:`, err.message);
  });

  console.log(`[worker] hazır — outbox her ${OUTBOX_RELAY_INTERVAL_MS / 1000}s denetleniyor`);
}

process.on("SIGINT", () => {
  shuttingDown = true;
  clearInterval(relayTimer);
  void pricingWorker.close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  shuttingDown = true;
  clearInterval(relayTimer);
  void pricingWorker.close().finally(() => process.exit(0));
});

main().catch((error) => {
  console.error("[worker] başlatma hatası:", error);
  process.exit(1);
});
