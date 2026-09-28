import { Prisma, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ConflictError, HttpError } from "@/lib/http/errors";
import { minorFromDb } from "@/lib/money/money";
import { logger, errorFields } from "@/lib/observability/logger";
import { audit } from "@/lib/admin/audit";
import { getPaymentProvider, type AuthorizeResult } from "./index";
import { PaymentProviderError } from "./provider";
import { assessPayment, type FraudDecision } from "@/lib/risk/fraud";
import { consumeStepUp, hasStepUpPasskey, type StepUpBinding } from "@/lib/auth/passkey";
import { getConfig } from "@/lib/config/app-config";
import { releaseBookingCredit, reserveCreditForCheckout } from "@/lib/wallet/wallet-service";
import { offSessionSetupFor } from "./psp-customer";
import {
  paymentsTotal,
  PROVIDER_ERROR_PREFIX,
  OPEN_STATUSES,
  SETTLED_STATUSES,
  PaymentDeclinedError,
  type PayOutcome,
  type PayableBooking,
  loadPayable,
  chargeOf,
  amountOf,
  transitionPayment,
  voidLoser,
  withPaymentLock,
} from "./payment-core";
import { captureAndConfirm, alreadyConfirmed } from "./confirm";

function assertPayable(booking: PayableBooking): void {
  if (booking.cartId) {
    throw new ConflictError("Bu rezervasyon sepetle birlikte ödenir", "CART_BOOKING");
  }
  if (booking.status !== "HELD") {
    throw new ConflictError("Bu rezervasyon ödeme beklemiyor", "INVALID_STATE");
  }
  if (!booking.holdExpiresAt || booking.holdExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Rezervasyon tutma süresi doldu", "HOLD_EXPIRED");
  }
}

/** Deneme sınırı aşıldı (v4#13): ödeme FAILED, bu rezervasyon için yeni deneme yok. */
export class PaymentAttemptsExceededError extends HttpError {
  constructor(maxAttempts: number) {
    super(
      429,
      "PAYMENT_ATTEMPTS_EXCEEDED",
      "Çok fazla başarısız ödeme denemesi. Bu rezervasyon için ödeme kapatıldı.",
      { maxAttempts }
    );
    this.name = "PaymentAttemptsExceededError";
  }
}

const attemptsKey = (bookingId: string) => `pay:attempts:${bookingId}`;

async function assertAttemptsLeft(bookingId: string): Promise<void> {
  const max = getConfig().PAYMENT_MAX_ATTEMPTS;
  if (Number((await redis.get(attemptsKey(bookingId))) ?? 0) >= max) {
    throw new PaymentAttemptsExceededError(max);
  }
}

/**
 * Başarısız yetkilendirme / 3DS denemesini sayar (v4#13). Sınıra ulaşılınca ödeme kalıcı
 * olarak FAILED(`ATTEMPTS_EXCEEDED`) işaretlenir; sonraki pay/confirm istekleri 429 alır.
 * Sayaç rezervasyon başınadır: yeni Idempotency-Key ile tekrar `pay` + `confirm` döngüsü
 * 3DS kodunu kaba kuvvetle denemeye izin vermez.
 */
async function recordFailedAttempt(booking: PayableBooking): Promise<void> {
  const { PAYMENT_MAX_ATTEMPTS, PAYMENT_ATTEMPTS_WINDOW_SECONDS } = getConfig();
  const attempts = await redis.incrWithTtl(
    attemptsKey(booking.id),
    PAYMENT_ATTEMPTS_WINDOW_SECONDS
  );
  if (attempts < PAYMENT_MAX_ATTEMPTS) return;
  await prisma.payment.updateMany({
    where: { bookingId: booking.id, status: { in: OPEN_STATUSES } },
    data: { status: PaymentStatus.FAILED, failureCode: "ATTEMPTS_EXCEEDED" },
  });
  paymentsTotal.inc({ outcome: "attempts_exceeded" });
  await audit("system:payment", "payment.attempts_exceeded", "Booking", booking.id, {
    attempts,
  });
  throw new PaymentAttemptsExceededError(PAYMENT_MAX_ATTEMPTS);
}

/** Kart BIN'i PSP token metadata'sından (v4#13); desteklenmiyorsa / hata → null. */
async function tokenBin(cardToken: string): Promise<string | null> {
  const provider = getPaymentProvider();
  if (!provider.describeToken) return null;
  try {
    return (await provider.describeToken(cardToken)).bin;
  } catch (error) {
    logger.warn(errorFields(error), "card token metadata unavailable");
    return null;
  }
}

/** Checkout ödemesi: kart token'ı ile yetkilendir; başarılıysa tahsil et ve onayla. */
export async function payForBooking(input: {
  bookingId: string;
  userId: string;
  cardToken: string;
  idempotencyKey: string;
  /** Passkey step-up token'ı (v4#2): bu rezervasyon + tutara bağlı, tek kullanımlık. */
  stepUpToken?: string | null;
  /** P1-7: cüzdan kredisinden kullanılacak tutar (minor-unit; 0/yok → yalnız kart). */
  creditMinor?: number;
  /** Risk sinyalleri (route'tan): istemci anahtarı ve ülke bilgisi. */
  context?: {
    ip?: string;
    ipCountry?: string | null;
    billingCountry?: string | null;
    /**
     * Sunucu imzalı cihaz kimliği (`did` çerezi, v4#13). İstemci gövdesinden ALINMAZ.
     * BIN de istemciden alınmaz: PSP token metadata'sından okunur (`describeToken`).
     */
    deviceId?: string | null;
  };
}): Promise<PayOutcome> {
  // IDOR kontrolü kilitten önce (başkasının rezervasyonuna kilit bile alınmaz).
  await loadPayable(input.bookingId, input.userId);
  try {
    return await withPaymentLock(input.bookingId, () => payLocked(input));
  } finally {
    // Ret / 3DS yolları da ödeme durumunu değiştirir → okuma önbelleği her sonuçta düşer.
    await redis.del(`booking:${input.bookingId}`).catch(() => 0);
  }
}

async function payLocked(input: Parameters<typeof payForBooking>[0]): Promise<PayOutcome> {
  const booking = await loadPayable(input.bookingId, input.userId);
  if (
    booking.status === "CONFIRMED" &&
    booking.payment &&
    SETTLED_STATUSES.includes(booking.payment.status)
  ) {
    return alreadyConfirmed(booking.id, input.userId);
  }
  assertPayable(booking);
  await assertAttemptsLeft(booking.id);

  // P1-8 fraud v2: allow / challenge_3ds / step_up_passkey / review / deny (yalnızca kurallar).
  const [account, recentFailed] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { createdAt: true } }),
    prisma.payment.count({
      where: {
        userId: input.userId,
        status: PaymentStatus.FAILED,
        updatedAt: { gte: new Date(Date.now() - 86_400_000) },
        // PSP kesintisi kullanıcının risk puanını artırmaz.
        OR: [
          { failureCode: null },
          { NOT: { failureCode: { startsWith: PROVIDER_ERROR_PREFIX } } },
        ],
      },
    }),
  ]);
  const risk = await assessPayment(redis, {
    userId: input.userId,
    ip: input.context?.ip ?? "unknown",
    cardToken: input.cardToken,
    amountMinor: amountOf(booking).amount,
    accountCreatedAt: account?.createdAt ?? new Date(),
    recentFailedPayments: recentFailed,
    ipCountry: input.context?.ipCountry,
    billingCountry: input.context?.billingCountry,
    cardBin: await tokenBin(input.cardToken),
    deviceId: input.context?.deviceId,
  });
  const gate = await resolveStepUp(
    input.userId,
    { bookingId: booking.id, amountMinor: amountOf(booking).amount },
    input.stepUpToken,
    risk.decision
  );
  if (gate === "fallback_3ds") {
    risk.hits.push({
      rule: "step_up_unavailable_3ds",
      points: 0,
      detail: "Step-up'a uygun passkey yok (yok ya da yeni eklendi); 3DS istendi",
    });
  }
  await prisma.fraudCheck.create({
    data: {
      bookingId: booking.id,
      userId: input.userId,
      score: risk.score,
      decision: risk.decision,
      reasons: risk.hits as unknown as Prisma.InputJsonValue,
    },
  });
  if (gate === "required") {
    paymentsTotal.inc({ outcome: "step_up_required" });
    throw new HttpError(
      403,
      "STEP_UP_REQUIRED",
      "Bu ödeme için passkey ile yeniden doğrulama gerekli",
      {
        score: risk.score,
      }
    );
  }
  if (risk.decision === "deny") {
    paymentsTotal.inc({ outcome: "fraud_blocked" });
    throw new HttpError(403, "FRAUD_BLOCKED", "Ödeme güvenlik kontrolünden geçemedi", {
      score: risk.score,
    });
  }

  // P1-7 saga adımı "credit": kart provizyonundan ÖNCE kredi rezervi (FIFO lot, FOR UPDATE).
  booking.creditMinor = BigInt(
    await reserveCreditForCheckout({
      bookingId: booking.id,
      userId: input.userId,
      currency: booking.currency,
      totalMinor: minorFromDb(booking.totalPriceMinor),
      creditMinor: input.creditMinor ?? 0,
    })
  );

  let result: AuthorizeResult;
  try {
    const provider = getPaymentProvider();
    // fix-sweep-2: depozito gereken rezervasyonda kart müşteriye kaydedilir (Stripe).
    const offSession = await offSessionSetupFor(provider, booking.userId, [
      { propertyId: booking.propertyId, roomTypeId: booking.roomId },
    ]);
    result = await provider.authorize({
      ...offSession,
      amount: chargeOf(booking),
      cardToken: input.cardToken,
      idempotencyKey: `auth:${booking.id}:${input.idempotencyKey}:${booking.creditMinor}`,
      metadata: {
        bookingId: booking.id,
        ...(gate === "force_3ds" || gate === "fallback_3ds" ? { force3ds: "1" } : {}),
      },
    });
  } catch (error) {
    await releaseBookingCredit(booking.id, "authorize_failed");
    if (error instanceof PaymentProviderError) {
      // Sağlayıcı hatası (ret değil): satır FAILED + `provider_error:<kod>` → açık durum,
      // aynı rezervasyon yeniden ödenebilir; deneme hakkından DÜŞMEZ (kullanıcı hatası değil).
      await transitionPayment(booking, OPEN_STATUSES, {
        status: PaymentStatus.FAILED,
        failureCode: `${PROVIDER_ERROR_PREFIX}${error.code}`.slice(0, 64),
      });
      paymentsTotal.inc({ outcome: "provider_error" });
    }
    throw error;
  }

  if (result.status === "declined") {
    // Kart reddi → kredi geri (saga dışı: provizyon hiç alınmadı).
    await releaseBookingCredit(booking.id, "card_declined");
    await transitionPayment(booking, OPEN_STATUSES, {
      status: PaymentStatus.FAILED,
      providerRef: result.providerRef,
      failureCode: result.declineCode,
    });
    paymentsTotal.inc({ outcome: "declined" });
    await recordFailedAttempt(booking);
    throw new PaymentDeclinedError(result.declineCode);
  }
  if (result.status === "requires_action") {
    const recorded = await transitionPayment(booking, OPEN_STATUSES, {
      status: PaymentStatus.REQUIRES_ACTION,
      providerRef: result.providerRef,
      failureCode: null,
    });
    if (!recorded) {
      await voidLoser(booking.id, result.providerRef);
      return alreadyConfirmed(booking.id, input.userId);
    }
    paymentsTotal.inc({ outcome: "requires_action" });
    return { status: "requires_action", bookingId: booking.id, challenge: result.challenge };
  }
  return captureAndConfirm(booking, result.providerRef);
}

type StepUpGate = "proceed" | "force_3ds" | "fallback_3ds" | "required";

/**
 * Karar → ödeme kapısı. step_up_passkey: bu rezervasyon + tutara bağlı geçerli step-up
 * token'ı varsa (GETDEL, tek kullanımlık) devam; yoksa step-up'a uygun (soğuma süresini
 * doldurmuş) passkey'i olan kullanıcıdan step-up istenir, olmayandan 3DS (v4#2).
 */
async function resolveStepUp(
  userId: string,
  binding: StepUpBinding,
  token: string | null | undefined,
  decision: FraudDecision
): Promise<StepUpGate> {
  if (decision === "challenge_3ds" || decision === "review") return "force_3ds";
  if (decision !== "step_up_passkey") return "proceed";
  if (await consumeStepUp(userId, binding, token)) return "proceed";
  return (await hasStepUpPasskey(userId)) ? "required" : "fallback_3ds";
}

/**
 * Step-up'ın bağlanacağı işlem (v4#2): rezervasyon sahibi ve ödenebilir olmalı; tutar
 * istemciden değil kayıtlı rezervasyondan hesaplanır.
 */
export async function stepUpBindingFor(bookingId: string, userId: string): Promise<StepUpBinding> {
  const booking = await loadPayable(bookingId, userId);
  assertPayable(booking);
  return { bookingId: booking.id, amountMinor: amountOf(booking).amount };
}

/** 3DS doğrulamasını tamamlar. */
export async function confirmPaymentChallenge(input: {
  bookingId: string;
  userId: string;
  code: string;
}): Promise<PayOutcome> {
  await loadPayable(input.bookingId, input.userId);
  return withPaymentLock(input.bookingId, async () => {
    const booking = await loadPayable(input.bookingId, input.userId);
    if (booking.payment?.status !== PaymentStatus.REQUIRES_ACTION || !booking.payment.providerRef) {
      throw new ConflictError("Doğrulama bekleyen ödeme yok", "NO_PENDING_CHALLENGE");
    }
    assertPayable(booking);
    await assertAttemptsLeft(booking.id);
    const ref = booking.payment.providerRef;
    const result = await getPaymentProvider().confirmChallenge(ref, input.code);
    if (result.status !== "authorized") {
      const code = result.status === "declined" ? result.declineCode : "authentication_required";
      await transitionPayment(
        booking,
        [PaymentStatus.REQUIRES_ACTION],
        { status: PaymentStatus.FAILED, failureCode: code },
        { providerRef: ref }
      );
      await releaseBookingCredit(booking.id, "challenge_failed");
      paymentsTotal.inc({ outcome: "declined" });
      await recordFailedAttempt(booking);
      throw new PaymentDeclinedError(code);
    }
    return captureAndConfirm(booking, result.providerRef, [PaymentStatus.REQUIRES_ACTION]);
  }).finally(() => redis.del(`booking:${input.bookingId}`).catch(() => 0));
}
