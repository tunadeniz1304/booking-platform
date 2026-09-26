-- CreateEnum
CREATE TYPE "PaymentShareStatus" AS ENUM ('INVITED', 'REQUIRES_ACTION', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOIDED', 'REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SplitFallbackMode" AS ENUM ('ORGANIZER_PAYS', 'REFUND_ALL');

-- CreateEnum
CREATE TYPE "SplitPlanStatus" AS ENUM ('COLLECTING', 'FALLBACK', 'SETTLED', 'ABORTED');

-- CreateTable
CREATE TABLE "SplitPlan" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "cartPaymentId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "fallbackMode" "SplitFallbackMode" NOT NULL,
    "status" "SplitPlanStatus" NOT NULL DEFAULT 'COLLECTING',
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "abortedAt" TIMESTAMP(3),
    "abortReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentShare" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cartPaymentId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isOrganizer" BOOLEAN NOT NULL DEFAULT false,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "participantEmail" TEXT,
    "payerUserId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentShareStatus" NOT NULL DEFAULT 'INVITED',
    "provider" TEXT,
    "providerRef" TEXT,
    "failureCode" TEXT,
    "refundedAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "inviteNonce" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentShareRefund" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refundRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentShareRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SplitPlan_cartId_idx" ON "SplitPlan"("cartId");

-- CreateIndex
CREATE INDEX "SplitPlan_status_deadlineAt_idx" ON "SplitPlan"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentShare_providerRef_key" ON "PaymentShare"("providerRef");

-- CreateIndex
CREATE INDEX "PaymentShare_cartId_idx" ON "PaymentShare"("cartId");

-- CreateIndex
CREATE INDEX "PaymentShare_payerUserId_idx" ON "PaymentShare"("payerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentShare_planId_position_key" ON "PaymentShare"("planId", "position");

-- CreateIndex
CREATE INDEX "PaymentShareRefund_bookingId_idx" ON "PaymentShareRefund"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentShareRefund_shareId_bookingId_key" ON "PaymentShareRefund"("shareId", "bookingId");

-- AddForeignKey
ALTER TABLE "SplitPlan" ADD CONSTRAINT "SplitPlan_cartPaymentId_fkey" FOREIGN KEY ("cartPaymentId") REFERENCES "CartPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentShare" ADD CONSTRAINT "PaymentShare_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SplitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentShareRefund" ADD CONSTRAINT "PaymentShareRefund_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "PaymentShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sepet başına en fazla bir aktif (toplanan / yedek / tamamlanmış) bölünmüş ödeme planı.
CREATE UNIQUE INDEX "SplitPlan_one_active_per_cart" ON "SplitPlan"("cartId") WHERE "status" IN ('COLLECTING', 'FALLBACK', 'SETTLED');

-- Plan başına en fazla bir yedek (organizatör) payı.
CREATE UNIQUE INDEX "PaymentShare_one_fallback_per_plan" ON "PaymentShare"("planId") WHERE "isFallback";

-- Tutar doğrulaması (uygulama katmanına ek savunma): pay pozitif, iade payı aşamaz.
ALTER TABLE "PaymentShare" ADD CONSTRAINT "PaymentShare_amount_check" CHECK ("amountMinor" > 0 AND "refundedAmountMinor" >= 0 AND "refundedAmountMinor" <= "amountMinor");
ALTER TABLE "PaymentShareRefund" ADD CONSTRAINT "PaymentShareRefund_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "PaymentShareRefund" ADD CONSTRAINT "PaymentShareRefund_status_check" CHECK ("status" IN ('PENDING', 'DONE'));
