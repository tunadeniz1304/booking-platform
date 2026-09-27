import { AsyncLocalStorage } from "async_hooks";
import type { RedisClient } from "@/lib/redis";
import { counter } from "@/lib/observability/metrics";

/**
 * Özne başına günlük LLM token bütçesi (§3 v3-a, v2-P0-4).
 *
 * Özne (subject) istek bağlamından gelir: oturum açmış kullanıcı için `u:<id>`, anonim
 * uçlarda (akıllı arama, yorum özeti) istemci anahtarı (`ip:`/`anon:`), sistem işleri
 * (embedding indeksleme, duman testi) için açıkça verilen `sys:<iş>`. Özne yoksa canlı
 * çağrı YAPILMAZ (fail-closed, `reason: "no_subject"`).
 *
 * Kontrol + düşüm tek atomik rezervasyondur: canlı istekten önce `max_tokens + tahmini
 * prompt` kadar ayrılır (Redis Lua), yanıttan sonra gerçek kullanımla düzeltilir. Böylece
 * eşzamanlı çağrılar bütçeyi en fazla tek bir rezervasyon kadar aşabilir. Bütçe doluysa
 * aynı arayüzle deterministik demo çıktısı döner (`llmMode: "fallback"`, `reason: "budget"`).
 * Sayaç Redis'te gün (UTC) başına tutulur; Redis erişilemezse rezervasyon yapılmaz (demo).
 */

export const llmBudgetExceededTotal = counter(
  "llm_budget_exceeded_total",
  "Günlük token bütçesi aşıldığı için demo'ya düşen LLM çağrıları",
  ["task"] as const
);

/** Sistem işlerinin öznesi bu önekle başlar ve ayrı (sistem) limitine tabidir. */
export const SYSTEM_SUBJECT_PREFIX = "sys:";

export function userLlmSubject(userId: string): string {
  return `u:${userId}`;
}

export function systemLlmSubject(job: string): string {
  return `${SYSTEM_SUBJECT_PREFIX}${job}`;
}

const storage = new AsyncLocalStorage<{ subject: string }>();

/** `fn` içindeki tüm LLM çağrıları bu özneye faturalanır. */
export function runWithLlmSubject<T>(subject: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ subject }, fn);
}

/** `fn` içindeki LLM çağrıları `sys:<job>` sistem bütçesine faturalanır. */
export function runWithSystemLlmSubject<T>(job: string, fn: () => Promise<T>): Promise<T> {
  return runWithLlmSubject(systemLlmSubject(job), fn);
}

export function currentLlmSubject(): string | undefined {
  return storage.getStore()?.subject;
}

export interface LlmBudget {
  /**
   * Salt-okuma: bu özne bugün bütçesini doldurdu mu? Yalnız gözlem/test içindir; çağrı
   * izni için KULLANILMAZ (kontrol + düşüm ayrık olur, yarışa açıktır) — izin `reserve` ile.
   */
  exceeded(subject: string, now?: Date): Promise<boolean>;
  /**
   * Atomik rezervasyon: özne limitin altındaysa `tokens` kadar ayırır → `true`;
   * doluysa veya sayaç erişilemezse hiçbir şey ayırmaz → `false` (fail-closed).
   */
  reserve(subject: string, tokens: number, now?: Date): Promise<boolean>;
  /** Sayacı `tokens` kadar düzeltir (negatif → iade; sayaç 0'ın altına inmez). */
  consume(subject: string, tokens: number, now?: Date): Promise<void>;
}

/** İki güne yayılan TTL: gün sonunda anahtar kendiliğinden düşer. */
const KEY_TTL_SECONDS = "172800";

const RESERVE = `-- llm-budget-reserve
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur >= tonumber(ARGV[3]) then return 0 end
redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1`;

const ADJUST = `-- llm-budget-adjust
local v = redis.call('INCRBY', KEYS[1], ARGV[1])
if v < 0 then redis.call('SET', KEYS[1], '0') v = 0 end
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return v`;

function dayKey(subject: string, now: Date): string {
  return `llm:budget:${subject}:${now.toISOString().slice(0, 10)}`;
}

/**
 * Redis sayaçlı bütçe; `limit <= 0` → sınırsız. `sys:` özneleri `systemLimit`'e tabidir
 * (verilmezse `limit`).
 */
export function createRedisBudget(
  redis: Pick<RedisClient, "get" | "eval">,
  limit: number,
  systemLimit: number = limit
): LlmBudget {
  const limitFor = (subject: string) =>
    subject.startsWith(SYSTEM_SUBJECT_PREFIX) ? systemLimit : limit;
  return {
    async exceeded(subject, now = new Date()) {
      const max = limitFor(subject);
      if (max <= 0) return false;
      try {
        const used = Number((await redis.get(dayKey(subject, now))) ?? 0);
        return used >= max;
      } catch {
        return true;
      }
    },
    async reserve(subject, tokens, now = new Date()) {
      const max = limitFor(subject);
      if (max <= 0) return true;
      try {
        const ok = await redis.eval(
          RESERVE,
          [dayKey(subject, now)],
          [String(Math.max(0, Math.ceil(tokens))), KEY_TTL_SECONDS, String(max)]
        );
        return Number(ok) === 1;
      } catch {
        return false;
      }
    },
    async consume(subject, tokens, now = new Date()) {
      const delta = Math.round(tokens);
      if (limitFor(subject) <= 0 || delta === 0) return;
      await redis
        .eval(ADJUST, [dayKey(subject, now)], [String(delta), KEY_TTL_SECONDS])
        .catch(() => undefined);
    },
  };
}
