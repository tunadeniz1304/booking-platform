import { PaymentProviderError, type PaymentProvider } from "./provider";

/**
 * P2-3 kaos sarmalayıcısı — YALNIZCA MockPsp'ye uygulanır (bkz. `index.ts`).
 *
 * Gerçek bir PSP'nin yavaşlamasını / kısmi kesintisini ağ proxy'si (toxiproxy) olmadan taklit
 * eder: MockPsp süreç-içi olduğundan araya ağ katmanı koyulamaz; env ile açılan bu dekoratör
 * her PSP çağrısından ÖNCE gecikme ekler ve seçili işlemlerde `psp_unavailable` fırlatır.
 * Varsayılanlar (0 / 0 / 0) davranışı değiştirmez; Stripe sağlayıcısı hiç sarılmaz.
 */
export interface ChaosSettings {
  latencyMs: number;
  jitterMs: number;
  failureRate: number;
  failureOps: ReadonlySet<string>;
}

type Op =
  | "authorize"
  | "confirmChallenge"
  | "capture"
  | "refund"
  | "void"
  | "authorizeHold"
  | "setupCard"
  | "chargeSaved";

export function parseChaosOps(raw: string): ReadonlySet<string> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function chaosEnabled(s: ChaosSettings): boolean {
  return s.latencyMs > 0 || s.jitterMs > 0 || s.failureRate > 0;
}

export function withChaos(
  inner: PaymentProvider,
  settings: ChaosSettings,
  deps: { random?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): PaymentProvider {
  if (!chaosEnabled(settings)) return inner;
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function disturb(op: Op): Promise<void> {
    const delay = settings.latencyMs + Math.floor(random() * settings.jitterMs);
    if (delay > 0) await sleep(delay);
    if (settings.failureOps.has(op) && random() < settings.failureRate) {
      throw new PaymentProviderError("psp_unavailable", `PSP geçici olarak yanıt vermiyor (${op})`);
    }
  }

  const wrapped: PaymentProvider = {
    name: inner.name,
    authorize: async (input) => {
      await disturb("authorize");
      return inner.authorize(input);
    },
    confirmChallenge: async (ref, code) => {
      await disturb("confirmChallenge");
      return inner.confirmChallenge(ref, code);
    },
    capture: async (ref, amount, key) => {
      await disturb("capture");
      return inner.capture(ref, amount, key);
    },
    refund: async (ref, amount, key) => {
      await disturb("refund");
      return inner.refund(ref, amount, key);
    },
    void: async (ref) => {
      await disturb("void");
      return inner.void(ref);
    },
  };
  if (inner.describeToken) wrapped.describeToken = inner.describeToken.bind(inner);
  if (inner.authorizeHold) {
    const hold = inner.authorizeHold.bind(inner);
    wrapped.authorizeHold = async (input) => {
      await disturb("authorizeHold");
      return hold(input);
    };
  }
  if (inner.setupCard) {
    const setup = inner.setupCard.bind(inner);
    wrapped.setupCard = async (input) => {
      await disturb("setupCard");
      return setup(input);
    };
  }
  if (inner.chargeSaved) {
    const charge = inner.chargeSaved.bind(inner);
    wrapped.chargeSaved = async (input) => {
      await disturb("chargeSaved");
      return charge(input);
    };
  }
  return wrapped;
}
