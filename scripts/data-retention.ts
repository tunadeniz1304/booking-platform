/** `npm run data:retention` — saklama süresi dolan kayıtları bir kez budar (worker işiyle aynı). */
import { loadEnv } from "../src/lib/config/load-env";
import { pruneExpiredData } from "../src/lib/privacy/retention";

loadEnv();
pruneExpiredData()
  .then((result) => {
    console.log("Silinen satırlar:", JSON.stringify(result));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("data-retention hata:", (error as Error).message);
    process.exit(1);
  });
