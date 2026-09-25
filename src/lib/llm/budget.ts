import { AsyncLocalStorage } from "async_hooks";
import type { RedisClient } from "@/lib/redis";
import { counter } from "@/lib/observability/metrics";

/**
 * Kullanıcı başına günlük LLM token bütçesi (§3 v3-a).
 *
 * Özne (subject) istek bağlamından gelir: oturum açmış kullanıcı için `u:<id>`, anonim
 * uçlarda (akıllı arama, yorum özeti) istemci anahtarı (`ip:`/`anon:`). Bütçe aşıldıysa
 * canlı çağrı YAPILMAZ; aynı arayüzle deterministik demo çıktısı döner
 * (`llmMode: "fallback"`, `reason: "budget"`). Sayaç Redis'te gün (UTC) başına tutulur;
 * Redis erişilemezse maliyet kontrolü için güvenli taraf seçilir (demo).
 */

export const llmBudgetExceededTotal = counter(
  "llm_budget_exceeded_total",
  "Günlük token bütçesi aşıldığı için demo'ya düşen LLM çağrıları",
  ["task"] as const
);

const storage = new AsyncLocalStorage<{ subject: string }>();

/** `fn` içindeki tüm LLM çağrıları bu özneye faturalanır. */
export function runWithLlmSubject<T>(subject: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ subject }, fn);
}

export function currentLlmSubject(): string | undefined {
  return storage.getStore()?.subject;
}

export interface LlmBudget {
  /** Bu özne bugün bütçesini doldurdu mu? */
  exceeded(subject: string, now?: Date): Promise<boolean>;
  /** Kullanılan token'ları ekler. */
  consume(subject: string, tokens: number, now?: Date): Promise<void>;
}

const INCRBY_WITH_TTL = `
local v = redis.call('INCRBY', KEYS[1], ARGV[1])
if v == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return v`;

function dayKey(subject: string, now: Date): string {
  return `llm:budget:${subject}:${now.toISOString().slice(0, 10)}`;
}

/** Redis sayaçlı bütçe; `limit <= 0` → sınırsız. */
export function createRedisBudget(
  redis: Pick<RedisClient, "get" | "eval">,
  limit: number
): LlmBudget {
  return {
    async exceeded(subject, now = new Date()) {
      if (limit <= 0) return false;
      try {
        const used = Number((await redis.get(dayKey(subject, now))) ?? 0);
        return used >= limit;
      } catch {
        return true;
      }
    },
    async consume(subject, tokens, now = new Date()) {
      if (limit <= 0 || tokens <= 0) return;
      // İki güne yayılan TTL: gün sonunda anahtar kendiliğinden düşer.
      await redis
        .eval(INCRBY_WITH_TTL, [dayKey(subject, now)], [String(Math.round(tokens)), "172800"])
        .catch(() => undefined);
    },
  };
}
