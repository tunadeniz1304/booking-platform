import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { Prisma, BookingStatus, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { HttpError } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingTransferredPayload } from "@/lib/events/events";
import {
  money,
  multiplyRate,
  toDecimalString,
  assertCurrency,
  type Money,
  minorToDb,
  minorFromDb,
} from "@/lib/money/money";
import { fromDate } from "@/lib/time/nights";
import { getPaymentProvider } from "@/lib/payment";
import { isAlreadyCapturedError, type PaymentProvider } from "@/lib/payment/provider";
import { runSaga, type SagaStep } from "@/lib/saga/saga";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { audit } from "@/lib/admin/audit";
import { CompensationMarkers, post, postCaptureCompensation } from "@/lib/ledger";
import { assessPayment } from "@/lib/risk/fraud";

/**
 * P2P rezervasyon devri (ikincil pazar).
 *
 *  1. Satıcı CONFIRMED rezervasyonunu listeler → sunucu `TRANSFER_SIGNING_SECRET` ile
 *     imzalı tek kullanımlık CLAIM LİNKİ üretir ve YALNIZCA satıcıya bir kez gösterir;
 *     veritabanında yalnızca sha256(token) tutulur (token sızdırılamaz).
 *  2. Alıcı linki açar → imza (timing-safe) + süre + özet eşleşmesi doğrulanır.
 *  3. `askPrice` alıcıdan PSP ile yetkilendirilir; reddedilirse hiçbir şey değişmez.
 *  4. İlan LISTED→CAPTURE_PENDING (nonce tüketilir), ardından PSP capture; YALNIZCA capture
 *     başarılıysa tek SERIALIZABLE işlemde ilan COMPLETED, rezervasyon sahipliği alıcıya geçer,
 *     payout + defter yazılır (v4#1). Capture/commit düşerse ilan FAILED, sahiplik değişmez,
 *     yetkilendirme void edilir ya da tahsilat iade edilir (saga telafisi).
 *
 * Karaborsa önleme: askPrice ≤ TRANSFER_MAX_ASK_RATIO × ödenen tutar.
 * Yalnızca check-in'e TRANSFER_MIN_HOURS_BEFORE_CHECKIN saatten fazla kalan rezervasyonlar.
 */

export class TransferError extends HttpError {
  constructor(message: string, status = 422, code = "TRANSFER_ERROR") {
    super(status, code, message);
    this.name = "TransferError";
  }
}

function signingSecret(): string {
  const secret = process.env.TRANSFER_SIGNING_SECRET ?? "";
  if (secret.length < 32) {
    // Fallback YOK: zayıf/eksik sırla devir özelliği kapalıdır.
    throw new TransferError("Devir özelliği yapılandırılmamış", 503, "TRANSFER_UNAVAILABLE");
  }
  return secret;
}

function assertEnabled(): void {
  if (!getConfig().FEATURE_TRANSFER) {
    throw new TransferError("Devir özelliği kapalı", 404, "TRANSFER_DISABLED");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface TokenPayload {
  transferId: string;
  bookingId: string;
  exp: number;
  nonce: string;
}

function signClaimToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** İmza (timing-safe) ve süre doğrulaması; geçersizse `null`. */
function verifyClaimToken(token: string, now = Date.now()): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

function maskName(first: string, last: string): string {
  return `${first.charAt(0)}*** ${last.charAt(0)}.`;
}

export interface ListedTransfer {
  id: string;
  bookingId: string;
  status: TransferStatus;
  askPriceMinor: number;
  currency: string;
  expiresAt: string;
  /** Yalnızca listeleme yanıtında BİR KEZ döner; tekrar üretilemez. */
  claimToken: string;
}

export async function listBookingForTransfer(
  bookingId: string,
  sellerId: string,
  askPriceMinor: number,
  now = new Date()
): Promise<ListedTransfer> {
  assertEnabled();
  const config = getConfig();
  if (!Number.isSafeInteger(askPriceMinor) || askPriceMinor <= 0) {
    throw new TransferError("Geçersiz istek fiyatı", 400);
  }

  return withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, userId: sellerId },
      select: { id: true, status: true, totalPriceMinor: true, currency: true, checkIn: true },
    });
    if (!booking) throw new TransferError("Rezervasyon bulunamadı", 404, "NOT_FOUND");
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new TransferError(
        "Yalnızca onaylı rezervasyonlar devredilebilir",
        409,
        "INVALID_STATE"
      );
    }
    const hoursLeft = (booking.checkIn.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft <= config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN) {
      throw new TransferError(
        `Girişe ${config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN} saatten az kalan rezervasyon devredilemez`,
        400,
        "TOO_LATE"
      );
    }
    const currency = assertCurrency(booking.currency);
    const paid = money(minorFromDb(booking.totalPriceMinor), currency);
    const maxAsk = multiplyRate(paid, config.TRANSFER_MAX_ASK_RATIO);
    if (askPriceMinor > maxAsk.amount) {
      throw new TransferError(
        `İstek fiyatı üst sınırı aşıyor (en fazla ${toDecimalString(maxAsk)} ${currency})`,
        400,
        "ASK_TOO_HIGH"
      );
    }

    // v4#1: tahsilatı süren bir devir varken yeniden listeleme yok (çift satış önlenir).
    const pending = await tx.bookingTransfer.count({
      where: { bookingId, status: TransferStatus.CAPTURE_PENDING },
    });
    if (pending > 0) {
      throw new TransferError("Bu rezervasyon için devir ödemesi sürüyor", 409, "TRANSFER_PENDING");
    }

    await tx.bookingTransfer.updateMany({
      where: { bookingId, status: TransferStatus.LISTED },
      data: { status: TransferStatus.CANCELLED, cancelledAt: now },
    });

    const expiresAt = new Date(
      Math.min(
        now.getTime() + config.TRANSFER_LINK_TTL_HOURS * 3_600_000,
        booking.checkIn.getTime()
      )
    );
    const transferId = `tr_${randomBytes(12).toString("hex")}`;
    const token = signClaimToken({
      transferId,
      bookingId,
      exp: expiresAt.getTime(),
      nonce: randomBytes(16).toString("hex"),
    });
    const transfer = await tx.bookingTransfer.create({
      data: {
        id: transferId,
        bookingId,
        sellerId,
        askPriceMinor: minorToDb(askPriceMinor),
        currency,
        tokenHash: hashToken(token),
        expiresAt,
        status: TransferStatus.LISTED,
      },
    });
    return {
      id: transfer.id,
      bookingId,
      status: transfer.status,
      askPriceMinor,
      currency,
      expiresAt: expiresAt.toISOString(),
      claimToken: token,
    };
  });
}

export interface ClaimResult {
  transferId: string;
  bookingId: string;
  status: TransferStatus;
  paidMinor: number;
  currency: string;
}

/** Devir sagası adları (v4#1) — test hata enjeksiyonu `injectSagaFaultForTests` ile. */
export const TRANSFER_SAGA = "booking_transfer";
export const TRANSFER_SAGA_STEPS = {
  authorize: "authorize",
  reserve: "reserve",
  capture: "capture",
  commit: "commit",
} as const;

interface ClaimContext {
  transfer: { id: string; bookingId: string; sellerId: string };
  buyerId: string;
  cardToken: string;
  /** Denemeye özgü authorize idempotency anahtarı (eşzamanlı/yeniden denemeler paylaşmaz). */
  authorizeKey: string;
  ask: Money;
  now: Date;
  providerRef?: string;
  /** Bu denemenin provizyonu telafide void edildi (anahtarı bir daha kullanılamaz). */
  authVoided: boolean;
  reserved: boolean;
  captured: boolean;
  failureCode: string;
}

/** Rezervasyon hâlâ devredilebilir mi (satıcıda, CONFIRMED, girişe yeterli süre)? */
async function loadTransferableBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  sellerId: string,
  now: Date
) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      propertyId: true,
      roomId: true,
    },
  });
  const config = getConfig();
  if (
    !booking ||
    booking.userId !== sellerId ||
    booking.status !== BookingStatus.CONFIRMED ||
    (booking.checkIn.getTime() - now.getTime()) / 3_600_000 <=
      config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN
  ) {
    throw new TransferError("Rezervasyon artık devredilemez", 409, "BOOKING_CHANGED");
  }
  return booking;
}

/**
 * Capture'ı alınmış devir ödemesinin iadesi (saga capture telafisi, takılı devir süpürücüsü ve
 * jurnal tamamlama). Tüm yollar AYNI iade anahtarını (`transfer-refund:<id>`) kullanır → PSP'de
 * çift iade yok; jurnal anahtarları da aynı olduğundan yarışan ikinci yol yeniden yazmaz.
 *
 * v2-P0-3: telafi işareti (`comp:<buyerPaymentRef>`, mutabakatın PSP tarafı) PSP çağrısından
 * ÖNCE yazılır. İade PSP'de işlenip jurnal yazılamazsa (yanıt kaybı, çökme, serileştirme
 * tükenmesi) işaret kalır → mutabakat jurnalsiz capture/iadeyi fark olarak raporlar ve
 * süpürücü (`rejournalTransferRefunds`) iadeyi aynı anahtarla yeniden deneyip jurnali tamamlar.
 *
 * v5#1: işaret YALNIZ capture kesinken önceden yazılır (`captureCertain`: saga capture'ı gördü
 * ya da PSP void'i `already_captured` ile reddetti). Capture belirsizse (void geçici hatayla
 * düştü) önce iade denenir; iade başarılıysa capture kanıtlanmıştır → işaret + jurnal. İade
 * reddedilirse (capture yok) işaret yazılmaz → mutabakatta hayali fark, süpürücüde sonsuz
 * yeniden deneme olmaz.
 */
async function refundTransferCapture(
  provider: PaymentProvider,
  i: { transferId: string; bookingId: string; buyerPaymentRef: string; ask: Money },
  captureCertain = true
): Promise<void> {
  const refundRef = `transfer-refund:${i.transferId}`;
  const markerId = `comp:${i.buyerPaymentRef}`;
  const mark = () =>
    prisma.paymentEvent.upsert({
      where: { id: markerId },
      create: {
        id: markerId,
        type: CompensationMarkers.transferCapture,
        providerRef: i.buyerPaymentRef,
      },
      update: {},
    });
  if (captureCertain) await mark();
  await provider.refund(i.buyerPaymentRef, i.ask, refundRef);
  if (!captureCertain) await mark();
  await withSerializableRetry((tx) =>
    postCaptureCompensation(tx, {
      refundRef,
      bookingId: i.bookingId,
      transferId: i.transferId,
      currency: i.ask.currency,
      amountMinor: minorToDb(i.ask.amount),
    })
  );
}

/**
 * Devir sagası (v4#1). Sahiplik, payout ve defter YALNIZCA capture başarılı olduktan sonra
 * yazılır; öncesinde ilan `CAPTURE_PENDING` ara durumunda tutulur (ikinci alıcı giremez).
 *
 *   authorize → reserve (LISTED→CAPTURE_PENDING) → capture → commit (pivot, tek SERIALIZABLE tx)
 *
 * Telafiler ters sırada: capture yapıldıysa iade, ilan FAILED, yetkilendirme void.
 */
function claimSteps(provider: PaymentProvider): SagaStep<ClaimContext, string>[] {
  return [
    {
      name: TRANSFER_SAGA_STEPS.authorize,
      async run(ctx) {
        const auth = await provider.authorize({
          amount: ctx.ask,
          cardToken: ctx.cardToken,
          idempotencyKey: ctx.authorizeKey,
        });
        if (auth.status !== "authorized") {
          throw new HttpError(402, "PAYMENT_DECLINED", "Ödeme onaylanmadı; devir gerçekleşmedi");
        }
        ctx.providerRef = auth.providerRef;
      },
      async compensate(ctx) {
        if (!ctx.providerRef || ctx.captured) return false;
        // Aynı anahtarla gelen başka bir deneme bu provizyonla ilanı ayırdıysa o denemenin
        // provizyonudur (PSP aynı anahtara aynı provizyonu döner) — kaybeden ona dokunamaz.
        if (!ctx.reserved) {
          const owned = await prisma.bookingTransfer.count({
            where: { id: ctx.transfer.id, buyerPaymentRef: ctx.providerRef },
          });
          if (owned > 0) return false;
        }
        await provider.void(ctx.providerRef);
        ctx.authVoided = true;
      },
    },
    {
      name: TRANSFER_SAGA_STEPS.reserve,
      async run(ctx) {
        await withSerializableRetry(async (tx) => {
          const claimed = await tx.bookingTransfer.updateMany({
            where: {
              id: ctx.transfer.id,
              status: TransferStatus.LISTED,
              expiresAt: { gt: ctx.now },
            },
            data: {
              status: TransferStatus.CAPTURE_PENDING,
              claimedById: ctx.buyerId,
              claimedAt: ctx.now,
              buyerPaymentRef: ctx.providerRef,
            },
          });
          if (claimed.count !== 1)
            throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");
          await loadTransferableBooking(tx, ctx.transfer.bookingId, ctx.transfer.sellerId, ctx.now);
        });
        ctx.reserved = true;
        ctx.failureCode = "CAPTURE_FAILED";
      },
      async compensate(ctx) {
        if (!ctx.reserved) return false;
        // Sahiplik hiç değişmedi; ilan kalıcı olarak FAILED (satıcı yeniden listeleyebilir).
        await prisma.bookingTransfer.updateMany({
          where: { id: ctx.transfer.id, status: TransferStatus.CAPTURE_PENDING },
          data: {
            status: TransferStatus.FAILED,
            failedAt: new Date(),
            failureCode: ctx.failureCode,
          },
        });
      },
    },
    {
      name: TRANSFER_SAGA_STEPS.capture,
      async run(ctx) {
        await provider.capture(ctx.providerRef!, ctx.ask);
        ctx.captured = true;
        ctx.failureCode = "COMMIT_FAILED";
      },
      async compensate(ctx) {
        if (!ctx.captured || !ctx.providerRef) return false;
        await refundTransferCapture(provider, {
          transferId: ctx.transfer.id,
          bookingId: ctx.transfer.bookingId,
          buyerPaymentRef: ctx.providerRef,
          ask: ctx.ask,
        });
      },
    },
    {
      name: TRANSFER_SAGA_STEPS.commit,
      pivot: true,
      async run(ctx) {
        const { transfer, buyerId, now, ask } = ctx;
        const currency = ask.currency;
        const bookingId = await withSerializableRetry(async (tx) => {
          const done = await tx.bookingTransfer.updateMany({
            where: {
              id: transfer.id,
              status: TransferStatus.CAPTURE_PENDING,
              claimedById: buyerId,
            },
            data: { status: TransferStatus.COMPLETED, completedAt: now },
          });
          if (done.count !== 1)
            throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");

          const booking = await loadTransferableBooking(
            tx,
            transfer.bookingId,
            transfer.sellerId,
            now
          );
          const owned = await tx.booking.updateMany({
            where: { id: booking.id, userId: transfer.sellerId, status: BookingStatus.CONFIRMED },
            data: { userId: buyerId, version: { increment: 1 } },
          });
          if (owned.count !== 1)
            throw new TransferError("Rezervasyon sahipliği değişti", 409, "BOOKING_CHANGED");

          // Asıl ödeme (satıcının kartı) satıcıda kalır; satıcı bedelini payout ile alır.
          // İptal iadesi alıcının devir ödemesine (buyerPaymentRef) yapılır — yalnızca COMPLETED
          // devir iade hedefi olur, yani capture'ı kesinleşmiş ödeme (bkz. cancelAndRefund).
          const amount = minorToDb(ask.amount);
          await tx.payout.create({
            data: {
              userId: transfer.sellerId,
              bookingId: booking.id,
              transferId: transfer.id,
              amountMinor: amount,
              currency,
            },
          });
          // Çift girişli defter (ADR 0020): alıcının ödemesi satıcıya borç.
          await post.transferSettled(tx, {
            transferId: transfer.id,
            bookingId: booking.id,
            sellerId: transfer.sellerId,
            currency,
            askMinor: amount,
            occurredAt: now,
          });
          await appendOutbox(
            tx,
            makeEvent<BookingTransferredPayload>(
              EventTypes.BookingTransferred,
              booking.id,
              "booking",
              {
                bookingId: booking.id,
                propertyId: booking.propertyId,
                roomId: booking.roomId,
                checkIn: fromDate(booking.checkIn),
                checkOut: fromDate(booking.checkOut),
                userId: buyerId,
                fromUserId: transfer.sellerId,
                toUserId: buyerId,
                transferId: transfer.id,
              }
            )
          );
          return booking.id;
        });
        return { done: bookingId };
      },
    },
  ];
}

const redlock = createRedlock(redis);

const DAY_SECONDS = 86_400;

/**
 * v5#5: ödeme yollarıyla ortak `payment_attempts_total`; devir talebi `flow="transfer"`
 * etiketiyle sayılır (declined / fraud_denied / fraud_review / attempts_exhausted / claimed).
 */
const paymentAttemptsTotal = counter("payment_attempts_total", "Ödeme denemeleri", [
  "outcome",
  "flow",
] as const);

const claimAttemptsKey = (transferId: string, buyerId: string) =>
  `transfer:claim:attempts:${transferId}:${buyerId}`;
const claimDailyKey = (buyerId: string) => `transfer:claim:attempts:day:${buyerId}`;

/**
 * v5#5 kart test kahini koruması: (devir, alıcı) başına `PAYMENT_MAX_ATTEMPTS` (pencere
 * `PAYMENT_ATTEMPTS_WINDOW_SECONDS`) ve alıcı başına günlük `TRANSFER_CLAIM_MAX_ATTEMPTS_PER_DAY`
 * başarısız deneme. Sınırdaysa PSP'ye gidilmeden 429 ATTEMPTS_EXHAUSTED.
 */
async function assertClaimAttemptsLeft(transferId: string, buyerId: string): Promise<void> {
  const cfg = getConfig();
  const [pair, daily] = await Promise.all([
    redis.get(claimAttemptsKey(transferId, buyerId)),
    redis.get(claimDailyKey(buyerId)),
  ]);
  const exhausted =
    Number(pair ?? 0) >= cfg.PAYMENT_MAX_ATTEMPTS ||
    Number(daily ?? 0) >= cfg.TRANSFER_CLAIM_MAX_ATTEMPTS_PER_DAY;
  if (!exhausted) return;
  paymentAttemptsTotal.inc({ flow: "transfer", outcome: "attempts_exhausted" });
  throw new TransferError(
    "Çok fazla başarısız devir denemesi; lütfen daha sonra tekrar deneyin",
    429,
    "ATTEMPTS_EXHAUSTED"
  );
}

/** Başarısız (reddedilen) talep denemesini iki sayaca yazar ve metriği artırır. */
async function recordFailedClaim(
  transferId: string,
  buyerId: string,
  outcome: "declined" | "fraud_denied" | "fraud_review"
): Promise<void> {
  paymentAttemptsTotal.inc({ flow: "transfer", outcome });
  const window = getConfig().PAYMENT_ATTEMPTS_WINDOW_SECONDS;
  await Promise.all([
    redis.incrWithTtl(claimAttemptsKey(transferId, buyerId), window),
    redis.incrWithTtl(claimDailyKey(buyerId), DAY_SECONDS),
  ]).catch((error) =>
    logger.error({ transferId, ...errorFields(error) }, "claim attempt counter failed")
  );
}

/**
 * v5#5: ödeme yollarıyla aynı fraud skoru. `deny` → 403 FRAUD_BLOCKED, `review` → 403
 * TRANSFER_REVIEW_REQUIRED (devirde manuel inceleme kuyruğu yok → fail-closed); ikisi de PSP'ye
 * gitmez ve başarısız deneme sayılır. `challenge_3ds` / `step_up_passkey`: devir talebinde
 * etkileşimli doğrulama adımı olmadığından PSP'nin kendi 3DS kararı geçerlidir (`requires_action`
 * → ret); karar FraudCheck'e yazılır.
 */
async function assessClaimRisk(
  transfer: { id: string; bookingId: string },
  input: { buyerId: string; cardToken: string; context?: ClaimRequestContext },
  amountMinor: number
): Promise<void> {
  const [account, recentFailed] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.buyerId }, select: { createdAt: true } }),
    prisma.payment.count({
      where: {
        userId: input.buyerId,
        status: "FAILED",
        updatedAt: { gte: new Date(Date.now() - DAY_SECONDS * 1000) },
      },
    }),
  ]);
  const risk = await assessPayment(redis, {
    userId: input.buyerId,
    ip: input.context?.ip ?? "unknown",
    cardToken: input.cardToken,
    amountMinor,
    accountCreatedAt: account?.createdAt ?? new Date(),
    recentFailedPayments: recentFailed,
    ipCountry: input.context?.ipCountry,
    cardBin: null,
    deviceId: input.context?.deviceId,
  });
  await prisma.fraudCheck.create({
    data: {
      bookingId: transfer.bookingId,
      userId: input.buyerId,
      score: risk.score,
      decision: risk.decision,
      reasons: [
        ...risk.hits,
        { rule: "transfer", points: 0, detail: `transfer:${transfer.id}` },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  if (risk.decision === "deny") {
    await recordFailedClaim(transfer.id, input.buyerId, "fraud_denied");
    throw new HttpError(403, "FRAUD_BLOCKED", "Ödeme güvenlik kontrolünden geçemedi", {
      score: risk.score,
    });
  }
  if (risk.decision === "review") {
    await recordFailedClaim(transfer.id, input.buyerId, "fraud_review");
    throw new TransferError(
      "Bu devir talebi güvenlik incelemesi gerektiriyor",
      403,
      "TRANSFER_REVIEW_REQUIRED"
    );
  }
}

/** İstemci bağlamı (fraud sinyalleri); route'tan gelir, doğrudan çağrılarda opsiyonel. */
export interface ClaimRequestContext {
  ip?: string;
  ipCountry?: string | null;
  deviceId?: string | null;
}

/**
 * Devir başına talep kilidi: aynı ilana gelen talepler (aynı alıcının çift gönderimi dahil)
 * sıralanır; kilidi sonra alan istek durumu yeniden okur ve 409 alır — hiçbir zaman PSP'ye
 * gitmez, dolayısıyla başkasının provizyonuna dokunamaz. Bütçe aşılırsa 409 CLAIM_IN_PROGRESS.
 */
async function withClaimLock<T>(transferId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await redlock.withLock(`transfer:claim:${transferId}`, fn, {
      waitMs: getConfig().LOCK_WAIT_BUDGET_MS,
    });
  } catch (error) {
    if (error instanceof LockError) {
      throw new TransferError("Bu devir için talep işleniyor", 409, "TRANSFER_CLAIM_IN_PROGRESS");
    }
    throw error;
  }
}

export async function claimTransfer(input: {
  token: string;
  buyerId: string;
  cardToken: string;
  /**
   * İsteğin Idempotency-Key'i (varsa): aynı isteğin (aynı kartla) tekrarı aynı provizyonu kullanır.
   * Yoksa deneme başına rastgele — reddedilen karttan sonra başka kartla yeniden deneme mümkün.
   */
  idempotencyKey?: string;
  context?: ClaimRequestContext;
  now?: Date;
}): Promise<ClaimResult> {
  assertEnabled();
  const now = input.now ?? new Date();
  const payload = verifyClaimToken(input.token, now.getTime());
  if (!payload)
    throw new TransferError("Devir linki geçersiz veya süresi dolmuş", 403, "INVALID_TOKEN");

  return withClaimLock(payload.transferId, () => claimLocked(input, payload, now));
}

/** Kilit altında: ilan durumu burada (yeniden) okunur. */
async function claimLocked(
  input: {
    token: string;
    buyerId: string;
    cardToken: string;
    idempotencyKey?: string;
    context?: ClaimRequestContext;
  },
  payload: TokenPayload,
  now: Date
): Promise<ClaimResult> {
  const transfer = await prisma.bookingTransfer.findUnique({ where: { id: payload.transferId } });
  if (
    !transfer ||
    transfer.tokenHash !== hashToken(input.token) ||
    transfer.bookingId !== payload.bookingId
  ) {
    throw new TransferError("Devir linki geçersiz", 403, "INVALID_TOKEN");
  }
  if (transfer.status !== TransferStatus.LISTED) {
    throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");
  }
  if (transfer.sellerId === input.buyerId) {
    throw new TransferError("Kendi rezervasyonunuzu devralamazsınız", 400, "SELF_CLAIM");
  }

  const currency = assertCurrency(transfer.currency);
  const ask = money(minorFromDb(transfer.askPriceMinor), currency);
  // v5#5: deneme sınırı ve fraud kapısı PSP'den ÖNCE.
  await assertClaimAttemptsLeft(transfer.id, input.buyerId);
  await assessClaimRisk(transfer, input, ask.amount);
  // İstemci anahtarı kart özetiyle birleşir: aynı istek tekrarı aynı provizyonu kullanır,
  // aynı anahtarla başka kart ise yeni deneme sayılır (PSP idempotency çakışması olmaz).
  // Nesil sayacı: provizyonu telafide void edilen anahtar yakılır; aynı anahtarla yeniden
  // deneme void edilmiş provizyonu PSP önbelleğinden geri almaz, yeni provizyon açar.
  const clientAttempt = input.idempotencyKey
    ? `${input.idempotencyKey}:${createHash("sha256").update(input.cardToken).digest("hex").slice(0, 16)}`
    : null;
  const generationKey = clientAttempt
    ? `transfer:claim:gen:${transfer.id}:${input.buyerId}:${clientAttempt}`
    : null;
  const attempt = generationKey
    ? `${clientAttempt}:${(await redis.get(generationKey)) ?? "0"}`
    : randomUUID();
  const ctx: ClaimContext = {
    transfer: { id: transfer.id, bookingId: transfer.bookingId, sellerId: transfer.sellerId },
    buyerId: input.buyerId,
    cardToken: input.cardToken,
    authorizeKey: `transfer:${transfer.id}:${input.buyerId}:${attempt}`,
    ask,
    now,
    authVoided: false,
    reserved: false,
    captured: false,
    failureCode: "RESERVE_FAILED",
  };

  let bookingId: string;
  try {
    bookingId = await runSaga(TRANSFER_SAGA, claimSteps(getPaymentProvider()), ctx, {
      // Kart reddi iş sonucudur: yetkilendirme yok → telafi edilecek bir şey yok.
      isOutcome: (e) => e instanceof HttpError && e.code === "PAYMENT_DECLINED",
    });
  } catch (error) {
    if (ctx.authVoided && generationKey) {
      await redis
        .incrWithTtl(generationKey, getConfig().TRANSFER_LINK_TTL_HOURS * 3600)
        .catch((e) =>
          logger.error({ transferId: transfer.id, ...errorFields(e) }, "claim key burn failed")
        );
    }
    if (error instanceof HttpError && error.code === "PAYMENT_DECLINED") {
      await recordFailedClaim(transfer.id, input.buyerId, "declined");
    }
    if (error instanceof HttpError) throw error;
    logger.error({ transferId: transfer.id, ...errorFields(error) }, "transfer saga failed");
    throw new TransferError(
      "Ödeme tahsil edilemedi; devir gerçekleşmedi",
      502,
      "TRANSFER_PAYMENT_FAILED"
    );
  }

  paymentAttemptsTotal.inc({ flow: "transfer", outcome: "claimed" });
  await invalidateBookingCache(bookingId);
  return {
    transferId: transfer.id,
    bookingId,
    status: TransferStatus.COMPLETED,
    paidMinor: ask.amount,
    currency,
  };
}

export async function cancelTransferListing(transferId: string, sellerId: string): Promise<void> {
  const res = await prisma.bookingTransfer.updateMany({
    where: { id: transferId, sellerId, status: TransferStatus.LISTED },
    data: { status: TransferStatus.CANCELLED, cancelledAt: new Date() },
  });
  if (res.count !== 1) throw new TransferError("İlan bulunamadı", 404, "NOT_FOUND");
}

/** Kullanıcının satıcı/alıcı olduğu devirler — token veya özeti ASLA dönmez. */
export async function listMyTransfers(userId: string) {
  return prisma.bookingTransfer.findMany({
    where: { OR: [{ sellerId: userId }, { claimedById: userId }] },
    orderBy: { listedAt: "desc" },
    take: 50,
    select: {
      id: true,
      bookingId: true,
      status: true,
      askPriceMinor: true,
      currency: true,
      listedAt: true,
      expiresAt: true,
      completedAt: true,
      sellerId: true,
      claimedById: true,
      booking: { select: { propertyId: true, checkIn: true, checkOut: true } },
    },
  });
}

/** Keşif listesi (public): satıcı kimliği maskeli, token yok. */
export async function discoverTransfers(now = new Date()) {
  assertEnabled();
  const rows = await prisma.bookingTransfer.findMany({
    where: { status: TransferStatus.LISTED, expiresAt: { gt: now } },
    orderBy: { listedAt: "desc" },
    take: 50,
    select: {
      id: true,
      askPriceMinor: true,
      currency: true,
      expiresAt: true,
      seller: { select: { firstName: true, lastName: true } },
      booking: {
        select: {
          checkIn: true,
          checkOut: true,
          guestCount: true,
          totalPriceMinor: true,
          property: { select: { id: true, title: true, location: { select: { city: true } } } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    askPriceMinor: minorFromDb(r.askPriceMinor),
    originalPriceMinor: minorFromDb(r.booking.totalPriceMinor),
    currency: r.currency,
    expiresAt: r.expiresAt.toISOString(),
    seller: maskName(r.seller.firstName, r.seller.lastName),
    checkIn: fromDate(r.booking.checkIn),
    checkOut: fromDate(r.booking.checkOut),
    guestCount: r.booking.guestCount,
    property: {
      id: r.booking.property.id,
      title: r.booking.property.title,
      city: r.booking.property.location.city,
    },
  }));
}

export const transferSweepTotal = counter(
  "transfer_sweep_total",
  "CAPTURE_PENDING'de takılıp süpürülen devirler",
  ["outcome"] as const
);

export type SweepOutcome = "voided" | "refunded" | "unresolved";

/** Süpürücünün tek koşuda işlediği azami kayıt (takılı devir / jurnal tamamlama ayrı ayrı). */
const SWEEP_BATCH = 100;

/**
 * Takılı devir süpürücüsü (v4#1 ek): süreç capture ile commit arasında çökerse ilan
 * `CAPTURE_PENDING`'de kalır ve yeniden listelemeyi bloklar. Eşikten
 * (`TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS`) eski kayıtlar önce koşullu olarak FAILED'a
 * çekilir (geç biten bir saga commit'i artık tutmaz; kendi telafisiyle iade eder), sonra
 * yetkilendirme void edilir; void olmazsa (capture yapılmış) saga ile AYNI idempotency
 * anahtarıyla iade edilir — çift iade olmaz; iade saga ile aynı anahtarlarla jurnale yazılır
 * (v2-P0-3). Sahiplik hiç değişmemiştir. Her kayıt audit'lenir. Ardından iadesi jurnale
 * yazılamamış (telafi işareti var, jurnal yok) eşikten eski FAILED devirlerin jurnali tamamlanır.
 */
export async function sweepStuckTransfers(
  now = new Date(),
  provider: PaymentProvider = getPaymentProvider()
): Promise<{ swept: number; outcomes: Record<SweepOutcome, number>; rejournaled: number }> {
  const cutoff = new Date(
    now.getTime() - getConfig().TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS * 1000
  );
  const stuck = await prisma.bookingTransfer.findMany({
    where: { status: TransferStatus.CAPTURE_PENDING, claimedAt: { lt: cutoff } },
    orderBy: { claimedAt: "asc" },
    take: SWEEP_BATCH,
    select: {
      id: true,
      bookingId: true,
      askPriceMinor: true,
      currency: true,
      buyerPaymentRef: true,
    },
  });
  const outcomes: Record<SweepOutcome, number> = { voided: 0, refunded: 0, unresolved: 0 };
  let swept = 0;
  for (const t of stuck) {
    const marked = await prisma.bookingTransfer.updateMany({
      where: { id: t.id, status: TransferStatus.CAPTURE_PENDING, claimedAt: { lt: cutoff } },
      data: { status: TransferStatus.FAILED, failedAt: now, failureCode: "CAPTURE_TIMEOUT" },
    });
    if (marked.count !== 1) continue; // başka süpürücü/saga önce davrandı
    swept += 1;
    let outcome: SweepOutcome = "unresolved";
    if (t.buyerPaymentRef) {
      try {
        await provider.void(t.buyerPaymentRef);
        outcome = "voided";
      } catch (voidError) {
        try {
          const currency = assertCurrency(t.currency);
          await refundTransferCapture(
            provider,
            {
              transferId: t.id,
              bookingId: t.bookingId,
              buyerPaymentRef: t.buyerPaymentRef,
              ask: money(minorFromDb(t.askPriceMinor), currency),
            },
            isAlreadyCapturedError(voidError)
          );
          outcome = "refunded";
        } catch (refundError) {
          logger.error(
            { transferId: t.id, void: errorFields(voidError).err, ...errorFields(refundError) },
            "stuck transfer compensation failed; manual review required"
          );
        }
      }
    }
    if (outcome === "unresolved") {
      await prisma.bookingTransfer.update({
        where: { id: t.id },
        data: { failureCode: "CAPTURE_TIMEOUT_UNRESOLVED" },
      });
    }
    outcomes[outcome] += 1;
    transferSweepTotal.inc({ outcome });
    await audit("system:transfer-sweep", "transfer.capture_timeout", "BookingTransfer", t.id, {
      bookingId: t.bookingId,
      outcome,
    });
  }
  if (swept > 0) logger.warn({ swept, outcomes }, "stuck CAPTURE_PENDING transfers swept");
  const rejournaled = await rejournalTransferRefunds(cutoff, provider);
  return { swept, outcomes, rejournaled };
}

/**
 * v2-P0-3: telafi işareti olup iade jurnali olmayan FAILED devirler (iade PSP'de işlendi ya da
 * yarıda kaldı, jurnal yazılamadı). Eşikten (`cutoff`) önce düşmüş olanlar — sürmekte olan saga
 * telafisiyle yarışılmaz — aynı iade anahtarıyla yeniden iade edilip jurnale yazılır; PSP iadeyi
 * en fazla bir kez uygular, jurnal anahtarları çift kaydı engeller. Düşen kayıt işaretli kalır
 * (mutabakat farkı + bir sonraki süpürmede yeniden deneme).
 */
async function rejournalTransferRefunds(cutoff: Date, provider: PaymentProvider): Promise<number> {
  const pending = await prisma.$queryRaw<
    Array<{
      id: string;
      bookingId: string;
      askPriceMinor: bigint;
      currency: string;
      buyerPaymentRef: string;
    }>
  >`
    SELECT t."id", t."bookingId", t."askPriceMinor", t."currency", t."buyerPaymentRef"
      FROM "BookingTransfer" t
      JOIN "PaymentEvent" e
        ON e."id" = 'comp:' || t."buyerPaymentRef" AND e."type" = ${CompensationMarkers.transferCapture}
     WHERE t."status" = 'FAILED'
       AND t."failedAt" < ${cutoff}
       AND NOT EXISTS (
         SELECT 1 FROM "JournalEntry" j
          WHERE j."idempotencyKey" = 'refund-issued:transfer-refund:' || t."id"
       )
     ORDER BY t."failedAt" ASC
     LIMIT ${SWEEP_BATCH}`;
  let done = 0;
  for (const t of pending) {
    try {
      await refundTransferCapture(provider, {
        transferId: t.id,
        bookingId: t.bookingId,
        buyerPaymentRef: t.buyerPaymentRef,
        ask: money(minorFromDb(t.askPriceMinor), assertCurrency(t.currency)),
      });
      done += 1;
    } catch (error) {
      logger.error(
        { transferId: t.id, ...errorFields(error) },
        "transfer refund journal completion failed; will retry on next sweep"
      );
    }
  }
  if (done > 0) logger.warn({ rejournaled: done }, "transfer refund journals completed");
  return done;
}
