-- P1-7: sadakat seviyesi + cashback + cüzdan kredi lot'ları / harcamaları (ADR 0020 §Kredi)

-- CreateEnum
CREATE TYPE "LoyaltyCashbackStatus" AS ENUM ('PENDING', 'ISSUED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WalletCreditSource" AS ENUM ('CASHBACK', 'REFUND');

-- CreateEnum
CREATE TYPE "CreditSpendStatus" AS ENUM ('RESERVED', 'SPENT', 'RELEASED');

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "userId" TEXT NOT NULL,
    "completedStays" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LoyaltyCashback" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "bps" INTEGER NOT NULL,
    "amountMinor" BIGINT,
    "status" "LoyaltyCashbackStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "creditId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyCashback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" "WalletCreditSource" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "remainingMinor" BIGINT NOT NULL,
    "expiredMinor" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditSpend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,
    "status" "CreditSpendStatus" NOT NULL DEFAULT 'RESERVED',
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "CreditSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditSpendAllocation" (
    "id" TEXT NOT NULL,
    "spendId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "CreditSpendAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCashback_bookingId_key" ON "LoyaltyCashback"("bookingId");

-- CreateIndex
CREATE INDEX "LoyaltyCashback_status_dueAt_idx" ON "LoyaltyCashback"("status", "dueAt");

-- CreateIndex
CREATE INDEX "LoyaltyCashback_userId_idx" ON "LoyaltyCashback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletCredit_sourceRef_key" ON "WalletCredit"("sourceRef");

-- CreateIndex
CREATE INDEX "WalletCredit_userId_currency_expiresAt_idx" ON "WalletCredit"("userId", "currency", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletCredit_expiresAt_idx" ON "WalletCredit"("expiresAt");

-- CreateIndex
CREATE INDEX "CreditSpend_bookingId_idx" ON "CreditSpend"("bookingId");

-- CreateIndex
CREATE INDEX "CreditSpend_userId_status_idx" ON "CreditSpend"("userId", "status");

-- CreateIndex
CREATE INDEX "CreditSpendAllocation_creditId_idx" ON "CreditSpendAllocation"("creditId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditSpendAllocation_spendId_creditId_key" ON "CreditSpendAllocation"("spendId", "creditId");

-- AddForeignKey
ALTER TABLE "CreditSpendAllocation" ADD CONSTRAINT "CreditSpendAllocation_spendId_fkey" FOREIGN KEY ("spendId") REFERENCES "CreditSpend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSpendAllocation" ADD CONSTRAINT "CreditSpendAllocation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "WalletCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tutarlılık kuralları
ALTER TABLE "WalletCredit" ADD CONSTRAINT "WalletCredit_amounts_check"
  CHECK ("amountMinor" > 0 AND "remainingMinor" >= 0 AND "expiredMinor" >= 0
         AND "remainingMinor" + "expiredMinor" <= "amountMinor");
ALTER TABLE "WalletCredit" ADD CONSTRAINT "WalletCredit_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "CreditSpend" ADD CONSTRAINT "CreditSpend_amounts_check"
  CHECK ("amountMinor" > 0 AND "taxMinor" >= 0 AND "taxMinor" <= "amountMinor"
         AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");
ALTER TABLE "CreditSpendAllocation" ADD CONSTRAINT "CreditSpendAllocation_amounts_check"
  CHECK ("amountMinor" > 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");
ALTER TABLE "LoyaltyCashback" ADD CONSTRAINT "LoyaltyCashback_amount_check"
  CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0);
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_counts_check"
  CHECK ("completedStays" >= 0 AND "tier" >= 0);

-- Rezervasyon başına tek etkin (RESERVED | SPENT) kredi harcaması
CREATE UNIQUE INDEX "CreditSpend_one_active_per_booking" ON "CreditSpend"("bookingId")
  WHERE "status" IN ('RESERVED', 'SPENT');
