import { logger } from "@/lib/observability/logger";
import { describeLlmMode, getLlmSettings } from "./settings";

let logged = false;

/**
 * Başlangıç logu: `LLM: CANLI (model @ host)` veya `LLM: DEMO modu`.
 * `LLM_MODE=live` iken anahtar yoksa açık hata logu yazılır ve demo'ya düşülür.
 */
export function logLlmStartup(component: string): void {
  if (logged) return;
  logged = true;
  const settings = getLlmSettings();
  if (settings.invalidKeys.length > 0) {
    logger.warn(
      { component, invalidKeys: settings.invalidKeys },
      "LLM ayarlarında geçersiz değer; varsayılanlar kullanılıyor"
    );
  }
  if (settings.mode === "live" && !settings.hasKey) {
    logger.error(
      { component },
      "LLM_MODE=live ancak LLM anahtarı bulunamadı; DEMO moduna düşülüyor"
    );
  }
  logger.info({ component }, describeLlmMode(settings));
}
