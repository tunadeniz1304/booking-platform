/** `npm run availability:rollover` — ileri 365 gecelik envanteri tamamlar (idempotent). */
import { loadEnv } from "../src/lib/config/load-env";
import { rollAvailabilityForward } from "../src/lib/booking/availability-rollover";

loadEnv();
rollAvailabilityForward(Number(process.argv[2] ?? 365))
  .then((n) => {
    console.log(`Oluşturulan gece satırı: ${n}`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("rollover hata:", (error as Error).message);
    process.exit(1);
  });
