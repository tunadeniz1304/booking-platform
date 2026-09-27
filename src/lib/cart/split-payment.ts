import { randomBytes } from "crypto";
import {
  Prisma,
  CartStatus,
  PaymentShareStatus,
  PaymentStatus,
  SplitFallbackMode,
  SplitPlanStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type SplitShareInvitedPayload } from "@/lib/events/events";
import { ConflictError, ForbiddenError, HttpError, NotFoundError } from "@/lib/http/errors";
import {
  isSerializationFailure,
  withConfirmRetry,
  withSerializableRetry,
} from "@/lib/db/transactions";
import { rerunCompensations, runSaga, type SagaStep } from "@/lib/saga/saga";
import { scheduleCompensationRetry } from "@/lib/saga/compensation-retry";
import { SAGA_STEPS } from "@/lib/saga/booking-saga";
import { getPaymentProvider } from "@/lib/payment";
import type { PaymentChallenge } from "@/lib/payment/provider";
import { CaptureRaceLostError, PaymentDeclinedError } from "@/lib/payment/payment-service";
import { assessPayment } from "@/lib/risk/fraud";
import { getConfig } from "@/lib/config/app-config";
import { assertCurrency, minorFromDb, minorToDb, money } from "@/lib/money/money";
import { resolveSplitAmounts, SplitAmountError } from "@/lib/money/split";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { invalidatePropertySearchCache } from "@/lib/search";
import { counter, histogram } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";
import { audit } from "@/lib/admin/audit";
import { CompensationMarkers, postCaptureCompensation } from "@/lib/ledger";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { fromDate } from "@/lib/time/nights";
import {
  CartNotFoundError,
  getActiveCart,
  loadOwnedCart,
  releaseCart,
  releaseCartHolds,
  cancelCart,
  type CartDTO,
} from "./cart-service";
import {
  confirmCartBookingsInTx,
  assertPayableCart,
  loadConfirmableCartBookings,
  loadPayableCart,
  withCartPaymentLock,
} from "./cart-payment";
import { ShareLinkInvalidError, shareUrl, signShareToken, verifyShareToken } from "./split-token";
import { deferConfirmation } from "./confirm-pending";
import { offSessionSetupFor } from "@/lib/payment/psp-customer";

/**
 * Bölünmüş ödeme (P1-2). Organizatör sepeti HELD'e alınca payları tanımlar (eşit ya da özel
 * tutar; Σ pay = sepet toplamı, kalan kuruş organizatöre — `resolveSplitAmounts`). Her pay
 * AYRI PSP yetkilendirmesidir (katılımcı hesabıyla, doğrulanmış e-posta). Tüm paylar
 * yetkilenince saga hepsini tahsil eder ve sepet tek işlemde onaylanır (P1-1 onay çekirdeği:
 * rezervasyon başına pay `Payment` + `booking-captured` jurnali).
 *
 * Süre sonu (`SPLIT_PAY_DEADLINE_MINUTES`, BullMQ gecikmeli iş + dakikalık süpürücü):
 *  (a) ORGANIZER_PAYS → ödenmemiş paylar EXPIRED, toplamları organizatöre tek "yedek pay";
 *      yedek süresi de dolarsa (b).
 *  (b) REFUND_ALL → tüm yetkilendirmeler void, tahsilatlar iade, tutmalar serbest.
 * Yarışlar: pay ödemesi, süre sonu işi ve onay aynı `pay:cart:<id>` kilidinde; ayrıca DB'de
 * sepet satırı `FOR UPDATE` + koşullu pay geçişi → aynı pay iki kez tahsil edilemez, süre
 * sonundan sonra yetkilendirme kabul edilmez (void edilir).
 */

export const SPLIT_PAYMENT_SAGA = "split_payment";
export const SPLIT_DEADLINE_JOB = "split-pay-deadline";

const ACTIVE_PLAN: SplitPlanStatus[] = [SplitPlanStatus.COLLECTING, SplitPlanStatus.FALLBACK];
const PAYABLE: PaymentShareStatus[] = [
  PaymentShareStatus.INVITED,
  PaymentShareStatus.FAILED,
  PaymentShareStatus.REQUIRES_ACTION,
];
const FUNDED: PaymentShareStatus[] = [PaymentShareStatus.AUTHORIZED, PaymentShareStatus.CAPTURED];

export const splitShareTotal = counter(
  "split_share_payment_total",
  "Bölünmüş ödeme pay ödemeleri (sonuç)",
  ["outcome"] as const
);
export const splitPlanTotal = counter(
  "split_plan_total",
  "Bölünmüş ödeme planları (sonuç: created|settled|fallback|aborted)",
  ["outcome"] as const
);

/** P0-6: plan kuruluşundan tüm payların tahsil edilip sepetin onaylanmasına kadar geçen süre. */
export const splitSettlementSeconds = histogram(
  "split_settlement_duration_seconds",
  "Bölünmüş ödeme planının kuruluştan onaya süresi (saniye)",
  [],
  [5, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14400]
);

export class SplitNotFoundError extends NotFoundError {
  constructor() {
    super("Bölünmüş ödeme bulunamadı");
    this.name = "SplitNotFoundError";
  }
}

export class ShareAlreadyPaidError extends ConflictError {
  constructor() {
    super("Bu pay zaten ödendi", "SHARE_ALREADY_PAID");
    this.name = "ShareAlreadyPaidError";
  }
}

const deadlinePassed = () =>
  new ConflictError("Bölünmüş ödemenin süresi doldu", "SPLIT_DEADLINE_PASSED");
const splitClosed = () => new ConflictError("Bölünmüş ödeme artık açık değil", "SPLIT_CLOSED");

const newNonce = () => randomBytes(16).toString("base64url");
const minutes = (n: number) => n * 60_000;

// ───────────────────────────── DTO ─────────────────────────────

const shareSelect = {
  id: true,
  planId: true,
  cartId: true,
  cartPaymentId: true,
  position: true,
  isOrganizer: true,
  isFallback: true,
  participantEmail: true,
  payerUserId: true,
  amountMinor: true,
  currency: true,
  status: true,
  providerRef: true,
  failureCode: true,
  refundedAmountMinor: true,
  inviteNonce: true,
} satisfies Prisma.PaymentShareSelect;

type ShareRow = Prisma.PaymentShareGetPayload<{ select: typeof shareSelect }>;

const planInclude = {
  shares: { select: shareSelect, orderBy: { position: "asc" } },
} satisfies Prisma.SplitPlanInclude;

export type PlanRow = Prisma.SplitPlanGetPayload<{ include: typeof planInclude }>;

export interface ShareDTO {
  id: string;
  position: number;
  isOrganizer: boolean;
  isFallback: boolean;
  participantEmail: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentShareStatus;
  /** Yalnızca organizatör görünümünde ve ödenebilir paylarda. */
  inviteUrl: string | null;
}

export interface SplitPlanDTO {
  id: string;
  cartId: string;
  status: SplitPlanStatus;
  fallbackMode: SplitFallbackMode;
  deadlineAt: string;
  currency: string;
  totalMinor: number;
  fundedMinor: number;
  shares: ShareDTO[];
}

function tokenFor(share: Pick<ShareRow, "id" | "inviteNonce">, plan: { deadlineAt: Date }) {
  return signShareToken({ s: share.id, n: share.inviteNonce, e: plan.deadlineAt.getTime() });
}

function presentPlan(plan: PlanRow, withLinks: boolean): SplitPlanDTO {
  const open = ACTIVE_PLAN.includes(plan.status);
  const required = plan.shares.filter((s) => s.status !== PaymentShareStatus.EXPIRED);
  return {
    id: plan.id,
    cartId: plan.cartId,
    status: plan.status,
    fallbackMode: plan.fallbackMode,
    deadlineAt: plan.deadlineAt.toISOString(),
    currency: plan.shares[0]?.currency ?? "TRY",
    totalMinor: required.reduce((s, x) => s + minorFromDb(x.amountMinor), 0),
    fundedMinor: required
      .filter((s) => FUNDED.includes(s.status))
      .reduce((s, x) => s + minorFromDb(x.amountMinor), 0),
    shares: plan.shares.map((s) => ({
      id: s.id,
      position: s.position,
      isOrganizer: s.isOrganizer,
      isFallback: s.isFallback,
      participantEmail: s.participantEmail,
      amountMinor: minorFromDb(s.amountMinor),
      currency: s.currency,
      status: s.status,
      inviteUrl:
        withLinks && open && PAYABLE.includes(s.status) ? shareUrl(tokenFor(s, plan)) : null,
    })),
  };
}

export async function loadPlan(planId: string): Promise<PlanRow> {
  const plan = await prisma.splitPlan.findUnique({ where: { id: planId }, include: planInclude });
  if (!plan) throw new SplitNotFoundError();
  return plan;
}

/** Sepetin güncel planı: aktif/tamamlanmış varsa o, yoksa en son (iptal edilmiş) plan. */
async function currentPlanFor(cartId: string): Promise<PlanRow | null> {
  const plans = await prisma.splitPlan.findMany({
    where: { cartId },
    include: planInclude,
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return plans.find((p) => p.status !== SplitPlanStatus.ABORTED) ?? plans[0] ?? null;
}

// ─────────────────────────── plan kurulumu ───────────────────────────

export interface SplitParticipantInput {
  email?: string | null;
  amountMinor?: number;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Organizatör payları tanımlar (sepet HELD olmalı). Eşit bölmede n = katılımcı + organizatör;
 * özel tutarda organizatör kalanı öder. Sepet ve kalem tutmaları son ödeme + yedek + pay
 * kadar uzatılır (son ödeme anı tutma bitişini asla aşmaz). E-postası verilen katılımcılara
 * davet outbox'tan gider.
 */
export async function createSplitPlan(input: {
  cartId: string;
  userId: string;
  mode: "equal" | "custom";
  participants: SplitParticipantInput[];
}): Promise<SplitPlanDTO> {
  const config = getConfig();
  if (
    input.participants.length < 1 ||
    input.participants.length + 1 > config.SPLIT_PAY_MAX_SHARES
  ) {
    throw new HttpError(400, "SPLIT_SHARE_COUNT", "Katılımcı sayısı geçersiz", {
      maxShares: config.SPLIT_PAY_MAX_SHARES,
    });
  }
  const emails = input.participants.map((p) => normalizeEmail(p.email));
  const named = emails.filter((e): e is string => !!e);
  if (new Set(named).size !== named.length) {
    throw new HttpError(400, "SPLIT_DUPLICATE_EMAIL", "Aynı e-posta birden çok paya yazılamaz");
  }
  await loadPayableCart(input.cartId, input.userId); // IDOR: kilitten önce
  const planId = await withCartPaymentLock(input.cartId, async () => {
    const cart = await loadPayableCart(input.cartId, input.userId);
    await assertPayableCart(cart);
    if (
      cart.payment &&
      (
        [PaymentStatus.REQUIRES_ACTION, PaymentStatus.AUTHORIZED, PaymentStatus.PAID] as string[]
      ).includes(cart.payment.status)
    ) {
      throw new ConflictError("Sepet için ödeme sürüyor", "CART_PAYMENT_IN_PROGRESS");
    }
    let amounts: { organizer: number; participants: number[] };
    try {
      amounts = resolveSplitAmounts(
        cart.amount.amount,
        input.mode === "equal"
          ? { mode: "equal", participants: input.participants.length }
          : {
              mode: "custom",
              participantAmounts: input.participants.map((p) => p.amountMinor ?? 0),
            }
      );
    } catch (error) {
      if (error instanceof SplitAmountError) {
        throw new HttpError(400, "SPLIT_AMOUNT_INVALID", error.message, {
          totalMinor: cart.amount.amount,
        });
      }
      throw error;
    }

    const now = Date.now();
    const fallbackMode =
      config.SPLIT_PAY_FALLBACK === "refund"
        ? SplitFallbackMode.REFUND_ALL
        : SplitFallbackMode.ORGANIZER_PAYS;
    const deadlineAt = new Date(now + minutes(config.SPLIT_PAY_DEADLINE_MINUTES));
    const holdUntil = new Date(
      deadlineAt.getTime() +
        (fallbackMode === SplitFallbackMode.ORGANIZER_PAYS
          ? minutes(config.SPLIT_PAY_FALLBACK_MINUTES)
          : 0) +
        minutes(config.SPLIT_PAY_HOLD_GRACE_MINUTES)
    );
    const currency = cart.amount.currency;
    const provider = getPaymentProvider().name;

    try {
      return await withSerializableRetry(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cart.id} FOR UPDATE`;
        const current = await tx.cart.findUnique({
          where: { id: cart.id },
          select: { status: true, holdExpiresAt: true },
        });
        if (current?.status !== CartStatus.HELD) {
          throw new ConflictError("Sepet ödeme beklemiyor", "CART_NOT_HELD");
        }
        const cp = await tx.cartPayment.upsert({
          where: { cartId: cart.id },
          create: {
            cartId: cart.id,
            userId: input.userId,
            amountMinor: minorToDb(cart.amount.amount),
            currency,
            provider,
          },
          update: {
            amountMinor: minorToDb(cart.amount.amount),
            currency,
            provider,
            status: PaymentStatus.PENDING,
            failureCode: null,
          },
          select: { id: true },
        });
        const plan = await tx.splitPlan.create({
          data: {
            cartId: cart.id,
            cartPaymentId: cp.id,
            organizerId: input.userId,
            fallbackMode,
            deadlineAt,
          },
          select: { id: true },
        });
        const rows: Array<Omit<Prisma.PaymentShareUncheckedCreateInput, "planId">> = [];
        if (amounts.organizer > 0) {
          rows.push({
            cartPaymentId: cp.id,
            cartId: cart.id,
            position: 0,
            isOrganizer: true,
            payerUserId: input.userId,
            amountMinor: minorToDb(amounts.organizer),
            currency,
            inviteNonce: newNonce(),
          });
        }
        amounts.participants.forEach((amount, i) => {
          rows.push({
            cartPaymentId: cp.id,
            cartId: cart.id,
            position: i + 1,
            participantEmail: emails[i],
            amountMinor: minorToDb(amount),
            currency,
            inviteNonce: newNonce(),
          });
        });
        for (const row of rows) {
          const share = await tx.paymentShare.create({
            data: { ...row, planId: plan.id },
            select: { id: true },
          });
          if (row.participantEmail) {
            await appendOutbox(
              tx,
              makeEvent<SplitShareInvitedPayload>(
                EventTypes.SplitShareInvited,
                share.id,
                "payment_share",
                { shareId: share.id, planId: plan.id, kind: "INVITE", sendId: newNonce() }
              )
            );
          }
        }
        // Tutma uzatması: son ödeme (+ yedek) anı tutma bitişinden önce kalır.
        const until =
          current.holdExpiresAt && current.holdExpiresAt > holdUntil
            ? current.holdExpiresAt
            : holdUntil;
        await tx.cart.update({
          where: { id: cart.id },
          data: { holdExpiresAt: until, version: { increment: 1 } },
        });
        await tx.booking.updateMany({
          where: { cartId: cart.id, status: "HELD" },
          data: { holdExpiresAt: until },
        });
        return plan.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Bu sepet için bölünmüş ödeme zaten var", "SPLIT_EXISTS");
      }
      throw error;
    }
  });

  const plan = await loadPlan(planId);
  splitPlanTotal.inc({ outcome: "created" });
  await scheduleSplitDeadline(plan.id, plan.deadlineAt);
  await audit(input.userId, "cart.split_created", "Cart", input.cartId, {
    planId,
    shares: plan.shares.length,
    fallbackMode: plan.fallbackMode,
    deadlineAt: plan.deadlineAt.toISOString(),
  }).catch((error) => logger.warn(errorFields(error), "audit failed"));
  return presentPlan(plan, true);
}

/** Organizatör görünümü: pay durumları + ödenebilir paylar için davet linkleri. */
export async function getSplitPlan(cartId: string, userId: string): Promise<SplitPlanDTO | null> {
  await loadOwnedCart(cartId, userId);
  const plan = await currentPlanFor(cartId);
  return plan ? presentPlan(plan, plan.organizerId === userId) : null;
}

/** Davet e-postasını (yeniden) gönderir; e-posta verilirse paya yazılır (yalnız ödenmemiş pay). */
export async function sendShareInvite(input: {
  cartId: string;
  userId: string;
  shareId: string;
  email?: string | null;
}): Promise<SplitPlanDTO> {
  await loadOwnedCart(input.cartId, input.userId);
  const email = normalizeEmail(input.email);
  await withCartPaymentLock(input.cartId, async () => {
    const share = await prisma.paymentShare.findUnique({
      where: { id: input.shareId },
      select: { ...shareSelect, plan: { select: { status: true, organizerId: true } } },
    });
    if (!share || share.cartId !== input.cartId || share.plan.organizerId !== input.userId) {
      throw new SplitNotFoundError();
    }
    if (!ACTIVE_PLAN.includes(share.plan.status)) throw splitClosed();
    if (share.isOrganizer || !PAYABLE.includes(share.status)) {
      throw new ConflictError("Bu pay için davet gönderilemez", "SHARE_NOT_INVITABLE");
    }
    const to = email ?? share.participantEmail;
    if (!to) throw new HttpError(400, "SHARE_EMAIL_REQUIRED", "Davet için e-posta gerekli");
    try {
      await prisma.$transaction(async (tx) => {
        if (email && email !== share.participantEmail) {
          // E-posta değişince eski link (başka birine gitmiş olabilir) geçersizleşir.
          await tx.paymentShare.update({
            where: { id: share.id },
            data: { participantEmail: email, inviteNonce: newNonce() },
          });
        }
        await appendOutbox(
          tx,
          makeEvent<SplitShareInvitedPayload>(
            EventTypes.SplitShareInvited,
            share.id,
            "payment_share",
            { shareId: share.id, planId: share.planId, kind: "INVITE", sendId: newNonce() }
          )
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(400, "SPLIT_DUPLICATE_EMAIL", "Aynı e-posta birden çok paya yazılamaz");
      }
      throw error;
    }
  });
  const plan = await currentPlanFor(input.cartId);
  if (!plan) throw new SplitNotFoundError();
  return presentPlan(plan, true);
}

// ─────────────────────────── katılımcı ───────────────────────────

interface Payer {
  id: string;
  email: string;
}

async function loadShareByToken(token: string) {
  const payload = verifyShareToken(token);
  const share = await prisma.paymentShare.findUnique({
    where: { id: payload.s },
    select: {
      ...shareSelect,
      plan: { select: { id: true, status: true, organizerId: true, deadlineAt: true } },
    },
  });
  // Nonce değiştiyse (e-posta güncellendi) eski link geçersiz.
  if (!share || share.inviteNonce !== payload.n) throw new ShareLinkInvalidError();
  return share;
}

type TokenShare = Awaited<ReturnType<typeof loadShareByToken>>;

function assertPayer(share: TokenShare, payer: Payer): void {
  if (share.isOrganizer) {
    if (share.plan.organizerId !== payer.id) {
      throw new ForbiddenError("Bu pay organizatöre aittir");
    }
    return;
  }
  if (share.participantEmail && share.participantEmail !== payer.email.trim().toLowerCase()) {
    throw new HttpError(
      403,
      "SHARE_EMAIL_MISMATCH",
      "Bu ödeme linki başka bir e-postaya gönderildi"
    );
  }
  // E-postasız pay: linki alan doğrulanmış her hesap (organizatör dahil) ödeyebilir.
}

async function loadPayer(userId: string): Promise<Payer> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError("Kullanıcı bulunamadı");
  return { id: userId, email: user.email };
}

export interface ShareViewDTO {
  shareId: string;
  amountMinor: number;
  currency: string;
  status: PaymentShareStatus;
  isOrganizer: boolean;
  isFallback: boolean;
  planStatus: SplitPlanStatus;
  deadlineAt: string;
  organizerName: string;
  cartTotalMinor: number;
  items: Array<{ propertyTitle: string; roomTypeName: string; checkIn: string; checkOut: string }>;
  canPay: boolean;
  paidByMe: boolean;
}

/** Katılımcı ödeme sayfası: link + oturum + (varsa) e-posta eşleşmesi. */
export async function getShareView(token: string, userId: string): Promise<ShareViewDTO> {
  const share = await loadShareByToken(token);
  assertPayer(share, await loadPayer(userId));
  const [organizer, items] = await Promise.all([
    prisma.user.findUnique({ where: { id: share.plan.organizerId }, select: { firstName: true } }),
    prisma.cartItem.findMany({
      where: { cartId: share.cartId },
      select: {
        checkIn: true,
        checkOut: true,
        quotedTotalMinor: true,
        roomType: { select: { name: true, property: { select: { title: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const open =
    ACTIVE_PLAN.includes(share.plan.status) && share.plan.deadlineAt.getTime() > Date.now();
  return {
    shareId: share.id,
    amountMinor: minorFromDb(share.amountMinor),
    currency: share.currency,
    status: share.status,
    isOrganizer: share.isOrganizer,
    isFallback: share.isFallback,
    planStatus: share.plan.status,
    deadlineAt: share.plan.deadlineAt.toISOString(),
    organizerName: organizer?.firstName ?? "",
    cartTotalMinor: items.reduce((s, i) => s + minorFromDb(i.quotedTotalMinor), 0),
    items: items.map((i) => ({
      propertyTitle: i.roomType.property.title,
      roomTypeName: i.roomType.name,
      checkIn: fromDate(i.checkIn),
      checkOut: fromDate(i.checkOut),
    })),
    canPay: open && PAYABLE.includes(share.status),
    paidByMe: FUNDED.includes(share.status) && share.payerUserId === userId,
  };
}

export type ShareOutcome =
  | { status: "authorized" | "confirmed"; shareId: string; planStatus: SplitPlanStatus }
  | { status: "requires_action"; shareId: string; challenge: PaymentChallenge };

const attemptsKey = (shareId: string) => `pay:attempts:share:${shareId}`;

async function assertAttemptsLeft(shareId: string): Promise<void> {
  const max = getConfig().PAYMENT_MAX_ATTEMPTS;
  if (Number((await redis.get(attemptsKey(shareId))) ?? 0) >= max) {
    throw new HttpError(
      429,
      "PAYMENT_ATTEMPTS_EXCEEDED",
      "Çok fazla başarısız ödeme denemesi. Bu pay için ödeme kapatıldı.",
      { maxAttempts: max }
    );
  }
}

async function recordFailedAttempt(shareId: string): Promise<void> {
  const { PAYMENT_ATTEMPTS_WINDOW_SECONDS } = getConfig();
  await redis.incrWithTtl(attemptsKey(shareId), PAYMENT_ATTEMPTS_WINDOW_SECONDS).catch(() => 0);
}

function assertShareOpen(share: TokenShare, now = Date.now()): void {
  if (!ACTIVE_PLAN.includes(share.plan.status)) throw splitClosed();
  if (share.plan.deadlineAt.getTime() <= now) throw deadlinePassed();
  if (!PAYABLE.includes(share.status)) {
    if (share.status === PaymentShareStatus.EXPIRED) throw deadlinePassed();
    throw new ShareAlreadyPaidError();
  }
}

async function outcomeAfterFunding(share: TokenShare): Promise<ShareOutcome> {
  const plan = await prisma.splitPlan.findUnique({
    where: { id: share.planId },
    select: { status: true },
  });
  const planStatus = plan?.status ?? share.plan.status;
  return {
    status: planStatus === SplitPlanStatus.SETTLED ? "confirmed" : "authorized",
    shareId: share.id,
    planStatus,
  };
}

/**
 * Payı öder: PSP yetkilendirmesi (tahsilat YOK) → koşullu pay geçişi (sepet satırı kilidi +
 * süre/plan kontrolü; kaybeden yetkilendirme void). Son pay da yetkilenince saga hepsini tahsil
 * eder ve sepet onaylanır ("confirmed").
 */
export async function payShare(input: {
  token: string;
  userId: string;
  cardToken: string;
  idempotencyKey: string;
  context?: { ip?: string; ipCountry?: string | null; deviceId?: string | null };
}): Promise<ShareOutcome> {
  const first = await loadShareByToken(input.token);
  const payer = await loadPayer(input.userId);
  assertPayer(first, payer);
  return withCartPaymentLock(first.cartId, async () => {
    const share = await loadShareByToken(input.token);
    if (FUNDED.includes(share.status)) {
      // Aynı ödeyenin tekrarı idempotent; başkası aynı payı ödeyemez.
      if (share.payerUserId === input.userId) return outcomeAfterFunding(share);
      splitShareTotal.inc({ outcome: "duplicate" });
      throw new ShareAlreadyPaidError();
    }
    assertShareOpen(share);
    await assertAttemptsLeft(share.id);

    const [account, recentFailed] = await Promise.all([
      prisma.user.findUnique({ where: { id: input.userId }, select: { createdAt: true } }),
      prisma.payment.count({
        where: {
          userId: input.userId,
          status: PaymentStatus.FAILED,
          updatedAt: { gte: new Date(Date.now() - 86_400_000) },
        },
      }),
    ]);
    const amount = money(minorFromDb(share.amountMinor), assertCurrency(share.currency));
    const risk = await assessPayment(redis, {
      userId: input.userId,
      ip: input.context?.ip ?? "unknown",
      cardToken: input.cardToken,
      amountMinor: amount.amount,
      accountCreatedAt: account?.createdAt ?? new Date(),
      recentFailedPayments: recentFailed,
      ipCountry: input.context?.ipCountry,
      cardBin: null,
      deviceId: input.context?.deviceId,
    });
    if (risk.decision === "deny") {
      splitShareTotal.inc({ outcome: "fraud_blocked" });
      throw new HttpError(403, "FRAUD_BLOCKED", "Ödeme güvenlik kontrolünden geçemedi", {
        score: risk.score,
      });
    }
    const force3ds = risk.decision === "challenge_3ds" || risk.decision === "step_up_passkey";
    const provider = getPaymentProvider();
    if (share.status === PaymentShareStatus.REQUIRES_ACTION && share.providerRef) {
      // Yarım kalan 3DS yetkilendirmesi yenisiyle değişir.
      await provider.void(share.providerRef).catch(() => undefined);
    }
    // fix-sweep-2: depozitonun kaynağı organizatörün payıdır (asıl ya da yedek pay) → yalnız
    // onun kartı, depozito gereken kalem varsa müşteriye kaydedilir (Stripe).
    const organizerShare = share.position === 0 || share.isFallback;
    const offSession = organizerShare
      ? await offSessionSetupFor(
          provider,
          input.userId,
          await prisma.cartItem.findMany({
            where: { cartId: share.cartId },
            select: { propertyId: true, roomTypeId: true },
          })
        )
      : {};
    const result = await provider.authorize({
      ...offSession,
      amount,
      cardToken: input.cardToken,
      idempotencyKey: `auth:share:${share.id}:${input.idempotencyKey}`,
      metadata: {
        cartId: share.cartId,
        shareId: share.id,
        ...(force3ds ? { force3ds: "1" } : {}),
      },
    });
    if (result.status === "declined") {
      await prisma.paymentShare.updateMany({
        where: { id: share.id, status: { in: PAYABLE } },
        data: {
          status: PaymentShareStatus.FAILED,
          providerRef: result.providerRef,
          provider: provider.name,
          failureCode: result.declineCode,
        },
      });
      splitShareTotal.inc({ outcome: "declined" });
      await recordFailedAttempt(share.id);
      throw new PaymentDeclinedError(result.declineCode);
    }
    if (result.status === "requires_action") {
      const recorded = await prisma.paymentShare.updateMany({
        where: { id: share.id, status: { in: PAYABLE } },
        data: {
          status: PaymentShareStatus.REQUIRES_ACTION,
          providerRef: result.providerRef,
          provider: provider.name,
          payerUserId: input.userId,
          failureCode: null,
        },
      });
      if (recorded.count !== 1) {
        await provider.void(result.providerRef).catch(() => undefined);
        throw new ShareAlreadyPaidError();
      }
      splitShareTotal.inc({ outcome: "requires_action" });
      return { status: "requires_action", shareId: share.id, challenge: result.challenge };
    }
    await claimAuthorizedShare(share.id, result.providerRef, input.userId, provider.name, PAYABLE);
    return settleIfComplete(share);
  });
}

/** 3DS doğrulamasını tamamlar ve payı yetkilendirilmiş sayar. */
export async function confirmShareChallenge(input: {
  token: string;
  userId: string;
  code: string;
}): Promise<ShareOutcome> {
  const first = await loadShareByToken(input.token);
  assertPayer(first, await loadPayer(input.userId));
  return withCartPaymentLock(first.cartId, async () => {
    const share = await loadShareByToken(input.token);
    if (FUNDED.includes(share.status) && share.payerUserId === input.userId) {
      return outcomeAfterFunding(share);
    }
    if (
      share.status !== PaymentShareStatus.REQUIRES_ACTION ||
      !share.providerRef ||
      share.payerUserId !== input.userId
    ) {
      throw new ConflictError("Doğrulama bekleyen ödeme yok", "NO_PENDING_CHALLENGE");
    }
    assertShareOpen(share);
    await assertAttemptsLeft(share.id);
    const provider = getPaymentProvider();
    const ref = share.providerRef;
    const result = await provider.confirmChallenge(ref, input.code);
    if (result.status === "declined") {
      await prisma.paymentShare.updateMany({
        where: { id: share.id, status: PaymentShareStatus.REQUIRES_ACTION },
        data: { status: PaymentShareStatus.FAILED, failureCode: result.declineCode },
      });
      splitShareTotal.inc({ outcome: "declined" });
      await recordFailedAttempt(share.id);
      throw new PaymentDeclinedError(result.declineCode);
    }
    if (result.status === "requires_action") {
      await recordFailedAttempt(share.id);
      throw new ConflictError("Doğrulama kodu hatalı", "CHALLENGE_FAILED");
    }
    await claimAuthorizedShare(share.id, result.providerRef, input.userId, provider.name, [
      PaymentShareStatus.REQUIRES_ACTION,
    ]);
    return settleIfComplete(share);
  });
}

/**
 * Yetkilendirilmiş payı tek işlemde sahiplenir: sepet satırı `FOR UPDATE` (süre sonu işi de
 * aynı satırı kilitler) → plan açık, süre dolmamış, sepet HELD ve pay hâlâ ödenebilir olmalı.
 * Kaybeden yetkilendirme void edilir.
 */
async function claimAuthorizedShare(
  shareId: string,
  providerRef: string,
  userId: string,
  providerName: string,
  from: readonly PaymentShareStatus[]
): Promise<void> {
  const verdict = await withSerializableRetry(
    async (tx) => {
      const share = await tx.paymentShare.findUnique({
        where: { id: shareId },
        select: { cartId: true, planId: true },
      });
      if (!share) return "missing" as const;
      await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${share.cartId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PaymentShare" WHERE id = ${shareId} FOR UPDATE`;
      const [cart, plan] = await Promise.all([
        tx.cart.findUnique({ where: { id: share.cartId }, select: { status: true } }),
        tx.splitPlan.findUnique({
          where: { id: share.planId },
          select: { status: true, deadlineAt: true },
        }),
      ]);
      if (!plan || !ACTIVE_PLAN.includes(plan.status) || cart?.status !== CartStatus.HELD) {
        return "closed" as const;
      }
      if (plan.deadlineAt.getTime() <= Date.now()) return "deadline" as const;
      const claimed = await tx.paymentShare.updateMany({
        where: { id: shareId, status: { in: [...from] } },
        data: {
          status: PaymentShareStatus.AUTHORIZED,
          providerRef,
          provider: providerName,
          payerUserId: userId,
          authorizedAt: new Date(),
          failureCode: null,
        },
      });
      return claimed.count === 1 ? ("ok" as const) : ("taken" as const);
    },
    { label: "split.claim_share" }
  ).catch(async (error: unknown) => {
    // fix-sweep-3 (yük testi): sahiplenme işlemi çakışmada tükenirse yetkilendirme PSP'de açık
    // kalmasın → void, hata (409 TRANSACTION_CONFLICT) çağırana; pay ödenebilir kalır.
    await getPaymentProvider()
      .void(providerRef)
      .catch((e) => logger.warn({ providerRef, ...errorFields(e) }, "share void failed"));
    throw error;
  });
  if (verdict === "ok") {
    splitShareTotal.inc({ outcome: "authorized" });
    return;
  }
  await getPaymentProvider()
    .void(providerRef)
    .catch((error) => logger.warn({ providerRef, ...errorFields(error) }, "share void failed"));
  splitShareTotal.inc({ outcome: `lost_${verdict}` });
  if (verdict === "deadline") throw deadlinePassed();
  if (verdict === "taken") throw new ShareAlreadyPaidError();
  throw splitClosed();
}

async function settleIfComplete(share: TokenShare): Promise<ShareOutcome> {
  const plan = await loadPlan(share.planId);
  if (isFullyFunded(plan)) await settleSplit(plan);
  return outcomeAfterFunding(share);
}

/** Webhook yolu (sepet kilidi çağıranda): son eksik pay geldiyse tahsilat + onay. */
export async function settleSplitIfFundedLocked(shareId: string): Promise<boolean> {
  const share = await prisma.paymentShare.findUnique({
    where: { id: shareId },
    select: { planId: true },
  });
  if (!share) return false;
  const plan = await loadPlan(share.planId);
  if (!isFullyFunded(plan)) return false;
  await settleSplit(plan);
  return true;
}

function isFullyFunded(plan: PlanRow): boolean {
  const required = plan.shares.filter((s) => s.status !== PaymentShareStatus.EXPIRED);
  return (
    ACTIVE_PLAN.includes(plan.status) &&
    required.length > 0 &&
    required.every((s) => FUNDED.includes(s.status))
  );
}

// ─────────────────────────── tahsilat sagası ───────────────────────────

interface SplitSagaCtx {
  plan: PlanRow;
}

async function planShares(planId: string): Promise<ShareRow[]> {
  return prisma.paymentShare.findMany({
    where: { planId },
    select: shareSelect,
    orderBy: { position: "asc" },
  });
}

/**
 * Tahsil edilmiş payları iade eder (anahtar providerRef'e bağlı → tekrar güvenli). fix-sweep-3:
 * bir payın PSP iadesi düşse de diğerleri denenir; sonunda hata fırlatılır (düşen pay CAPTURED
 * kalır → `saga-compensation-retry` yeniden dener).
 */
async function refundCapturedShares(planId: string, reason: string): Promise<number> {
  let n = 0;
  const failures: unknown[] = [];
  for (const share of await planShares(planId)) {
    if (share.status !== PaymentShareStatus.CAPTURED || !share.providerRef) continue;
    const amount = minorFromDb(share.amountMinor) - minorFromDb(share.refundedAmountMinor);
    if (amount > 0) {
      try {
        await getPaymentProvider().refund(
          share.providerRef,
          money(amount, assertCurrency(share.currency)),
          `compensate:${share.providerRef}`
        );
      } catch (error) {
        logger.warn({ shareId: share.id, ...errorFields(error) }, "share refund failed");
        failures.push(error);
        continue;
      }
    }
    const now = new Date();
    const ref = share.providerRef;
    await withSerializableRetry(async (tx) => {
      const marked = await tx.paymentShare.updateMany({
        where: { id: share.id, status: PaymentShareStatus.CAPTURED },
        data: {
          status: PaymentShareStatus.REFUNDED,
          refundedAmountMinor: share.amountMinor,
          refundedAt: now,
          failureCode: reason,
        },
      });
      await tx.paymentEvent.upsert({
        where: { id: `comp:${ref}` },
        create: { id: `comp:${ref}`, type: CompensationMarkers.splitShare, providerRef: ref },
        update: {},
      });
      // v2-P0-3: payın tahsilatı + iadesi jurnale (geç pay iadesiyle aynı anahtar → çoğalmaz).
      if (marked.count === 1) {
        await postCaptureCompensation(tx, {
          refundRef: `compensate:${ref}`,
          paymentId: share.id,
          currency: share.currency,
          amountMinor: share.amountMinor,
          occurredAt: now,
        });
      }
    });
    n++;
  }
  if (failures.length > 0) throw failures[0];
  return n;
}

/**
 * Yetkilendirilmiş / 3DS bekleyen payları void eder; ödenmemişleri EXPIRED yapar. fix-sweep-3:
 * void düşerse pay VOIDED işaretlenMEZ (PSP'de açık yetkilendirme kalmasın); diğerleri
 * denenir, sonunda hata fırlatılır → `saga-compensation-retry`.
 */
async function voidOpenShares(planId: string, reason: string): Promise<number> {
  let n = 0;
  const failures: unknown[] = [];
  for (const share of await planShares(planId)) {
    if (
      share.providerRef &&
      (share.status === PaymentShareStatus.AUTHORIZED ||
        share.status === PaymentShareStatus.REQUIRES_ACTION)
    ) {
      try {
        await getPaymentProvider().void(share.providerRef);
      } catch (error) {
        logger.warn({ shareId: share.id, ...errorFields(error) }, "share void failed");
        failures.push(error);
        continue;
      }
      await prisma.paymentShare.updateMany({
        where: { id: share.id, status: share.status },
        data: { status: PaymentShareStatus.VOIDED, failureCode: reason },
      });
      n++;
    } else if (
      share.status === PaymentShareStatus.INVITED ||
      share.status === PaymentShareStatus.FAILED
    ) {
      await prisma.paymentShare.updateMany({
        where: { id: share.id, status: share.status },
        data: { status: PaymentShareStatus.EXPIRED, failureCode: reason },
      });
    }
  }
  if (failures.length > 0) throw failures[0];
  return n;
}

/** Planı kapatır (yeni pay kabul edilmez); sepet ödemesi başarısız. */
async function markPlanAborted(planId: string, reason: string): Promise<boolean> {
  return withSerializableRetry(async (tx) => {
    const plan = await tx.splitPlan.findUnique({
      where: { id: planId },
      select: { cartId: true, cartPaymentId: true },
    });
    if (!plan) return false;
    await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${plan.cartId} FOR UPDATE`;
    const moved = await tx.splitPlan.updateMany({
      where: { id: planId, status: { in: ACTIVE_PLAN } },
      data: { status: SplitPlanStatus.ABORTED, abortedAt: new Date(), abortReason: reason },
    });
    if (moved.count !== 1) return false;
    await tx.cartPayment.updateMany({
      where: { id: plan.cartPaymentId, status: { not: PaymentStatus.PAID } },
      data: { status: PaymentStatus.FAILED, failureCode: reason },
    });
    return true;
  });
}

const SPLIT_SAGA_STEPS: SagaStep<SplitSagaCtx, true>[] = [
  {
    name: SAGA_STEPS.hold,
    run: async () => undefined,
    compensate: async (ctx) => {
      if (await markPlanAborted(ctx.plan.id, "SPLIT_NOT_CONFIRMABLE")) {
        splitPlanTotal.inc({ outcome: "aborted" });
      }
      return (await releaseCartHolds(ctx.plan.cartId, CartStatus.OPEN, "payment_failed")) !== null;
    },
  },
  {
    name: SAGA_STEPS.authorize,
    run: async () => undefined,
    compensate: async (ctx) => (await voidOpenShares(ctx.plan.id, "saga_aborted")) > 0,
  },
  {
    name: SAGA_STEPS.capture,
    run: async (ctx) => {
      const provider = getPaymentProvider();
      for (const share of await planShares(ctx.plan.id)) {
        if (share.status !== PaymentShareStatus.AUTHORIZED || !share.providerRef) continue;
        await provider.capture(
          share.providerRef,
          money(minorFromDb(share.amountMinor), assertCurrency(share.currency))
        );
        await prisma.paymentShare.updateMany({
          where: { id: share.id, status: PaymentShareStatus.AUTHORIZED },
          data: { status: PaymentShareStatus.CAPTURED, capturedAt: new Date() },
        });
      }
    },
    compensate: async (ctx) => {
      const n = await refundCapturedShares(ctx.plan.id, "CART_NOT_CONFIRMABLE");
      if (n > 0) {
        await audit("system:payment", "cart.split_compensated", "Cart", ctx.plan.cartId, {
          planId: ctx.plan.id,
          refundedShares: n,
        }).catch((error) => logger.warn(errorFields(error), "audit failed"));
      }
      return n > 0;
    },
  },
  {
    name: SAGA_STEPS.confirm,
    pivot: true,
    run: async (ctx) => {
      try {
        await withConfirmRetry((tx) => confirmSplitInTransaction(tx, ctx.plan.id), {
          timeout: 30_000,
          maxWait: 10_000,
          label: `${SPLIT_PAYMENT_SAGA}.confirm`,
        });
      } catch (error) {
        // fix-sweep-3: tüm paylar tahsil edildi; geçici çakışma iade sebebi DEĞİL (P2-3'te
        // ödenmiş planların %64–74'ü bu yüzden iade ediliyordu) → onay `confirm-retry` işine.
        if (!isSerializationFailure(error)) throw error;
        await deferConfirmation({ kind: "split", planId: ctx.plan.id, cartId: ctx.plan.cartId });
        return { done: true };
      }
      splitPlanTotal.inc({ outcome: "settled" });
      splitSettlementSeconds.observe((Date.now() - ctx.plan.createdAt.getTime()) / 1000);
      await afterCartConfirmed(ctx.plan.cartId);
      return { done: true };
    },
  },
];

export async function afterCartConfirmed(cartId: string): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where: { cartId },
    select: { id: true, propertyId: true },
  });
  for (const propertyId of new Set(bookings.map((b) => b.propertyId))) {
    await invalidatePropertySearchCache(propertyId).catch(() => undefined);
  }
  for (const b of bookings) await invalidateBookingCache(b.id).catch(() => 0);
}

/** Tüm paylar yetkilendi → hepsi tahsil → tek işlemde onay (hata → iade/void + tutmalar serbest). */
async function settleSplit(plan: PlanRow): Promise<void> {
  await runSaga(
    SPLIT_PAYMENT_SAGA,
    SPLIT_SAGA_STEPS,
    { plan },
    {
      from: SAGA_STEPS.capture,
      onCompensationFailed: (steps) =>
        scheduleCompensationRetry({ saga: "split_payment", planId: plan.id }, steps),
    }
  );
}

/**
 * fix-sweep-3: planın telafisini (plan kapat + tahsilatları iade + yetkilendirmeleri void +
 * tutmaları bırak) idempotent olarak yeniden çalıştırır (`saga-compensation-retry`). Plan
 * SETTLED ise (onay kazandı) hiçbir şey yapılmaz. Yine başarısızsa fırlatır.
 */
export async function compensateSplitPlan(planId: string): Promise<"compensated" | "noop"> {
  const head = await prisma.splitPlan.findUnique({
    where: { id: planId },
    select: { cartId: true, status: true },
  });
  if (!head || head.status === SplitPlanStatus.SETTLED) return "noop";
  return withCartPaymentLock(head.cartId, async () => {
    const plan = await loadPlan(planId);
    if (plan.status === SplitPlanStatus.SETTLED) return "noop";
    const steps = SPLIT_SAGA_STEPS.filter((s) => s.name !== SAGA_STEPS.confirm);
    await rerunCompensations(SPLIT_PAYMENT_SAGA, steps as SagaStep<SplitSagaCtx, unknown>[], {
      plan,
    });
    return "compensated" as const;
  });
}

/**
 * Pivot (tek işlem): plan SETTLED, CartPayment PAID (Σ tahsil edilmiş pay = sepet toplamı),
 * her kalem için pay `Payment` + onay (jurnal, defter, outbox), sepet CHECKED_OUT.
 */
export async function confirmSplitInTransaction(
  tx: Prisma.TransactionClient,
  planId: string
): Promise<string[]> {
  const head = await tx.splitPlan.findUnique({ where: { id: planId }, select: { cartId: true } });
  if (!head) throw new SplitNotFoundError();
  await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${head.cartId} FOR UPDATE`;
  const plan = await tx.splitPlan.findUnique({
    where: { id: planId },
    include: {
      shares: { select: { status: true, amountMinor: true } },
      cartPayment: { select: { id: true, status: true, amountMinor: true, provider: true } },
    },
  });
  if (!plan) throw new SplitNotFoundError();
  if (plan.status === SplitPlanStatus.SETTLED) {
    const paid = await tx.payment.findMany({
      where: { cartPaymentId: plan.cartPaymentId },
      select: { id: true },
    });
    return paid.map((p) => p.id); // idempotent
  }
  if (!ACTIVE_PLAN.includes(plan.status)) throw splitClosed();
  const cart = await tx.cart.findUnique({ where: { id: plan.cartId }, select: { status: true } });
  if (cart?.status !== CartStatus.HELD) {
    throw new ConflictError("Sepet artık onaylanamaz", "CART_NOT_CONFIRMABLE");
  }
  const required = plan.shares.filter((s) => s.status !== PaymentShareStatus.EXPIRED);
  if (required.length === 0 || required.some((s) => s.status !== PaymentShareStatus.CAPTURED)) {
    throw new ConflictError("Tüm paylar tahsil edilmedi", "SPLIT_INCOMPLETE");
  }
  const captured = required.reduce((s, x) => s + x.amountMinor, 0n);
  if (captured !== plan.cartPayment.amountMinor) {
    throw new ConflictError("Payların toplamı sepetle uyuşmuyor", "SPLIT_AMOUNT_MISMATCH");
  }
  const bookings = await loadConfirmableCartBookings(tx, plan.cartId, plan.cartPayment.amountMinor);
  const now = new Date();
  const claimed = await tx.cartPayment.updateMany({
    where: { id: plan.cartPayment.id, status: { not: PaymentStatus.PAID } },
    data: { status: PaymentStatus.PAID, authorizedAt: now, paidAt: now, failureCode: null },
  });
  if (claimed.count !== 1) throw new CaptureRaceLostError();
  const moved = await tx.splitPlan.updateMany({
    where: { id: plan.id, status: { in: ACTIVE_PLAN } },
    data: { status: SplitPlanStatus.SETTLED, settledAt: now },
  });
  if (moved.count !== 1) throw splitClosed();
  return confirmCartBookingsInTx(tx, plan.cartId, bookings, plan.cartPayment, `split:${plan.id}`);
}

// ─────────────────────────── süre sonu ───────────────────────────

export async function scheduleSplitDeadline(planId: string, at: Date): Promise<void> {
  try {
    await getQueue(QUEUE_NAMES.maintenance).add(
      SPLIT_DEADLINE_JOB,
      { planId },
      {
        jobId: `split-deadline-${planId}-${at.getTime()}`,
        delay: Math.max(0, at.getTime() - Date.now()),
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    logger.warn(
      { planId, ...errorFields(error) },
      "split deadline job could not be scheduled; sweep will pick it up"
    );
  }
}

export type SplitDeadlineOutcome = "noop" | "not_due" | "settled" | "fallback" | "aborted";

/**
 * Süre sonu (gecikmeli iş + süpürücü, idempotent). Tüm paylar yetkilendiyse tahsil + onay;
 * yoksa ORGANIZER_PAYS'te (ilk süre sonu) kalan organizatöre yedek pay olur, değilse plan
 * iptal: void/iade + tutmalar serbest (sepet EXPIRED → yeniden açılabilir).
 */
export async function processSplitDeadline(
  planId: string,
  now: Date = new Date()
): Promise<SplitDeadlineOutcome> {
  const head = await prisma.splitPlan.findUnique({
    where: { id: planId },
    select: { cartId: true, status: true, deadlineAt: true },
  });
  if (!head || !ACTIVE_PLAN.includes(head.status)) return "noop";
  if (head.deadlineAt > now) return "not_due";
  return withCartPaymentLock(head.cartId, async () => {
    const plan = await loadPlan(planId);
    if (!ACTIVE_PLAN.includes(plan.status)) return "noop";
    if (plan.deadlineAt > now) return "not_due";
    if (isFullyFunded(plan)) {
      try {
        await settleSplit(plan);
        return "settled";
      } catch (error) {
        logger.warn({ planId, ...errorFields(error) }, "split settle at deadline failed");
        return "aborted";
      }
    }
    if (
      plan.status === SplitPlanStatus.COLLECTING &&
      plan.fallbackMode === SplitFallbackMode.ORGANIZER_PAYS &&
      (await startFallback(plan, now))
    ) {
      return "fallback";
    }
    await abortPlan(plan, "SPLIT_DEADLINE", CartStatus.EXPIRED);
    return "aborted";
  });
}

/** Ödenmemiş paylar EXPIRED; toplamları organizatörün yedek payı olur. */
async function startFallback(plan: PlanRow, now: Date): Promise<boolean> {
  const config = getConfig();
  const cart = await prisma.cart.findUnique({
    where: { id: plan.cartId },
    select: { holdExpiresAt: true },
  });
  const latest =
    (cart?.holdExpiresAt?.getTime() ?? 0) - minutes(config.SPLIT_PAY_HOLD_GRACE_MINUTES);
  const deadline = new Date(
    Math.min(now.getTime() + minutes(config.SPLIT_PAY_FALLBACK_MINUTES), latest)
  );
  if (deadline.getTime() <= now.getTime()) return false;

  const pending3ds: string[] = [];
  const fallback = await withSerializableRetry(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${plan.cartId} FOR UPDATE`;
    const shares = await tx.paymentShare.findMany({
      where: { planId: plan.id },
      select: { id: true, status: true, amountMinor: true, position: true, providerRef: true },
    });
    const unpaid = shares.filter((s) => PAYABLE.includes(s.status));
    if (unpaid.length === 0) return null;
    const moved = await tx.splitPlan.updateMany({
      where: { id: plan.id, status: SplitPlanStatus.COLLECTING },
      data: { status: SplitPlanStatus.FALLBACK, deadlineAt: deadline },
    });
    if (moved.count !== 1) return null;
    await tx.paymentShare.updateMany({
      where: { id: { in: unpaid.map((s) => s.id) } },
      data: { status: PaymentShareStatus.EXPIRED, failureCode: "SPLIT_DEADLINE" },
    });
    for (const s of unpaid) {
      if (s.status === PaymentShareStatus.REQUIRES_ACTION && s.providerRef) {
        pending3ds.push(s.providerRef);
      }
    }
    const share = await tx.paymentShare.create({
      data: {
        planId: plan.id,
        cartPaymentId: plan.cartPaymentId,
        cartId: plan.cartId,
        position: Math.max(...shares.map((s) => s.position)) + 1,
        isOrganizer: true,
        isFallback: true,
        payerUserId: plan.organizerId,
        amountMinor: unpaid.reduce((sum, s) => sum + s.amountMinor, 0n),
        currency: plan.shares[0].currency,
        inviteNonce: newNonce(),
      },
      select: { id: true, amountMinor: true },
    });
    await appendOutbox(
      tx,
      makeEvent<SplitShareInvitedPayload>(EventTypes.SplitShareInvited, share.id, "payment_share", {
        shareId: share.id,
        planId: plan.id,
        kind: "FALLBACK",
        sendId: newNonce(),
      })
    );
    return share;
  });
  if (!fallback) return false;
  for (const ref of pending3ds)
    await getPaymentProvider()
      .void(ref)
      .catch(() => undefined);
  splitPlanTotal.inc({ outcome: "fallback" });
  await scheduleSplitDeadline(plan.id, deadline);
  await audit("system:split-pay", "cart.split_fallback", "Cart", plan.cartId, {
    planId: plan.id,
    fallbackShareId: fallback.id,
    amountMinor: minorFromDb(fallback.amountMinor),
    deadlineAt: deadline.toISOString(),
  }).catch((error) => logger.warn(errorFields(error), "audit failed"));
  return true;
}

/**
 * Planı iptal eder: yeni pay kapanır → tahsilatlar iade, yetkilendirmeler void, tutmalar serbest.
 * fix-sweep-3: PSP iade/void hatası tutmaların bırakılmasını engellemez; kalan telafi
 * `saga-compensation-retry` işine verilir.
 */
export async function abortPlan(
  plan: PlanRow,
  reason: string,
  cartTo: CartStatus
): Promise<boolean> {
  if (!(await markPlanAborted(plan.id, reason))) return false;
  const failed: string[] = [];
  await refundCapturedShares(plan.id, reason).catch(() => failed.push(SAGA_STEPS.capture));
  await voidOpenShares(plan.id, reason).catch(() => failed.push(SAGA_STEPS.authorize));
  if (failed.length > 0) {
    await scheduleCompensationRetry({ saga: "split_payment", planId: plan.id }, failed);
  }
  await releaseCartHolds(
    plan.cartId,
    cartTo,
    cartTo === CartStatus.EXPIRED ? "hold_timeout" : "cart_released"
  );
  splitPlanTotal.inc({ outcome: "aborted" });
  await audit("system:split-pay", "cart.split_aborted", "Cart", plan.cartId, {
    planId: plan.id,
    reason,
  }).catch((error) => logger.warn(errorFields(error), "audit failed"));
  return true;
}

/** Süresi geçmiş aktif planlar (gecikmeli iş kaybolsa da); expire-holds işinde sepetlerden önce. */
export async function sweepSplitDeadlines(now: Date = new Date(), limit = 50): Promise<number> {
  const due = await prisma.splitPlan.findMany({
    where: { status: { in: ACTIVE_PLAN }, deadlineAt: { lte: now } },
    select: { id: true },
    orderBy: { deadlineAt: "asc" },
    take: limit,
  });
  let handled = 0;
  for (const { id } of due) {
    try {
      const outcome = await processSplitDeadline(id, now);
      if (outcome !== "noop" && outcome !== "not_due") handled++;
    } catch (error) {
      logger.error({ planId: id, ...errorFields(error) }, "split deadline processing failed");
    }
  }
  return handled;
}

// ─────────────────────────── organizatör: bırak / iptal ───────────────────────────

async function activePlanRow(cartId: string): Promise<PlanRow | null> {
  return prisma.splitPlan.findFirst({
    where: { cartId, status: { in: ACTIVE_PLAN } },
    include: planInclude,
  });
}

/** Tutmayı bırak: aktif bölünmüş ödeme varsa önce tüm paylar void/iade. */
export async function releaseCartWithSplit(userId: string, cartId: string): Promise<CartDTO> {
  await loadOwnedCart(cartId, userId);
  const plan = await activePlanRow(cartId);
  if (!plan) return releaseCart(userId, cartId);
  await withCartPaymentLock(cartId, () => abortPlan(plan, "CART_RELEASED", CartStatus.OPEN));
  const cart = await getActiveCart(userId);
  if (!cart) throw new CartNotFoundError();
  return cart;
}

/** Sepeti iptal et: aktif bölünmüş ödeme varsa önce void/iade. */
export async function cancelCartWithSplit(userId: string, cartId: string): Promise<void> {
  await loadOwnedCart(cartId, userId);
  const plan = await activePlanRow(cartId);
  if (!plan) return cancelCart(userId, cartId);
  await withCartPaymentLock(cartId, () => abortPlan(plan, "CART_CANCELLED", CartStatus.CANCELLED));
}

/** Test/iş: gecikmeli işin gövdesi. */
export async function runSplitDeadlineJob(data: { planId: string }): Promise<SplitDeadlineOutcome> {
  return processSplitDeadline(data.planId);
}
