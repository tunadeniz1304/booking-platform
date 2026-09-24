/**
 * Circuit Breaker (Resilience) — dış bağımlılıkları (Redis, PostgreSQL, gRPC,
 * Elasticsearch) arızalarda açarak sistemin çökmemesini sağlar.
 *
 * Durumlar:
 *  CLOSED    → istekler geçer; pencere içinde arıza sayısı eşiği aşınca OPEN olur.
 *  OPEN      → istekler anında reddedilir (fallback dener); soğuma süresi sonunda HALF_OPEN.
 *  HALF_OPEN → sınırlı deneme izni; başarı CLOSED'a, arıza OPEN'a döndürür.
 *
 * Ayrıca istatistik (success/failure/total) tutar; süreç-başı (süreç içi) durumdur —
 * çoklu instance'ta her işlemin kendi breaker'ı vardır (kabul edilen model).
 */

export class BreakerOpenError extends Error {
  constructor(public readonly name_: string) {
    super(`Circuit "${name_}" açık (OPEN) — istek reddedildi`);
    this.name = "BreakerOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Pencere içinde bu sayıda arızada devre açılır. */
  failureThreshold: number;
  /** Arıza sayma penceresi (ms). */
  windowMs: number;
  /** OPEN → HALF_OPEN soğuma beklemesi (ms). */
  cooldownMs: number;
  /** HALF_OPEN'da izin verilen deneme sayısı. */
  halfOpenThreshold: number;
}

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 15_000,
  halfOpenThreshold: 1,
};

export class CircuitBreaker {
  readonly name: string;
  private options: CircuitBreakerOptions;
  private state: BreakerState = "CLOSED";
  private failures: number[] = [];
  private openedAt = 0;
  private halfOpenUsed = 0;

  // Metrikler (izleme/degradasyon kararları için)
  totalCalls = 0;
  successCalls = 0;
  failureCalls = 0;

  constructor(name: string, options?: Partial<CircuitBreakerOptions>) {
    this.name = name;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getState(): BreakerState {
    if (this.state === "OPEN" && Date.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = "HALF_OPEN";
      this.halfOpenUsed = 0;
    }
    return this.state;
  }

  getStats(): { state: BreakerState; total: number; success: number; failure: number } {
    return {
      state: this.getState(),
      total: this.totalCalls,
      success: this.successCalls,
      failure: this.failureCalls,
    };
  }

  /**
   * fn'i devre üzerinden çağırır. Açıkken fallback çağrılır; fallback yoksa
   * BreakerOpenError fırlatılır.
   */
  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.totalCalls += 1;
    const state = this.getState();

    if (state === "OPEN") {
      return this.reject(fallback);
    }

    if (state === "HALF_OPEN") {
      if (this.halfOpenUsed >= this.options.halfOpenThreshold) {
        return this.reject(fallback);
      }
      this.halfOpenUsed += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      // Devre açılma durumunda dahi fallback denenir (graceful degrade)
      if (fallback) {
        try {
          return await fallback();
        } catch (fallbackError) {
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  private async reject<T>(fallback?: () => Promise<T>): Promise<T> {
    if (fallback) {
      try {
        return await fallback();
      } catch (error) {
        throw error;
      }
    }
    throw new BreakerOpenError(this.name);
  }

  private onSuccess(): void {
    this.successCalls += 1;
    this.failures = [];
    this.halfOpenUsed = 0;
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
    }
  }

  private onFailure(): void {
    this.failureCalls += 1;
    const now = Date.now();
    this.failures.push(now);
    // pencere dışı arızaları düş
    const windowStart = now - this.options.windowMs;
    this.failures = this.failures.filter((t) => t >= windowStart);

    if (this.state === "HALF_OPEN" || this.failures.length >= this.options.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = now;
    }
  }
}

/** Yaygın dış bağımlılıklar için uygulama-çapı breaker'lar. */
export const breakers = {
  search: new CircuitBreaker("search-pgvector", {
    failureThreshold: 3,
    windowMs: 20_000,
    cooldownMs: 10_000,
  }),
  pricing: new CircuitBreaker("pricing-engine", {
    failureThreshold: 5,
    windowMs: 20_000,
    cooldownMs: 10_000,
  }),
  grpc: new CircuitBreaker("grpc-internal", {
    failureThreshold: 3,
    windowMs: 15_000,
    cooldownMs: 10_000,
  }),
  redisCache: new CircuitBreaker("redis-cache", {
    failureThreshold: 8,
    windowMs: 30_000,
    cooldownMs: 15_000,
  }),
};
