-- P1-4: ev sahibi ödeme hesapları, escrow serbest bırakma rezervi ve host payout'ları (ADR 0021)

-- Rezerv alt hesabı türü (`host_reserve:<userId>`). Değer bu migration'da kullanılmaz
-- (PG: ADD VALUE ile eklenen değer aynı işlemde kullanılamaz).
ALTER TYPE "LedgerAccountKind" ADD VALUE 'HOST_RESERVE';

-- CreateEnum
CREATE TYPE "HostKycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutSchedule" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "HostAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectedAccountRef" TEXT,
    "kycStatus" "HostKycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "pausedById" TEXT,
    "reservePercentBps" INTEGER,
    "payoutSchedule" "PayoutSchedule" NOT NULL DEFAULT 'DAILY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostPayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "reference" TEXT,
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "HostPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostAccount_userId_key" ON "HostAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HostAccount_connectedAccountRef_key" ON "HostAccount"("connectedAccountRef");

-- CreateIndex
CREATE INDEX "HostPayout_status_createdAt_idx" ON "HostPayout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HostPayout_userId_createdAt_idx" ON "HostPayout"("userId", "createdAt");

-- İş kuralları: rezerv oranı 0..%100, payout tutarı pozitif, para birimi ISO biçiminde,
-- durdurma alanları birlikte.
ALTER TABLE "HostAccount" ADD CONSTRAINT "HostAccount_reserve_bps_range"
  CHECK ("reservePercentBps" IS NULL OR ("reservePercentBps" >= 0 AND "reservePercentBps" <= 10000));
ALTER TABLE "HostAccount" ADD CONSTRAINT "HostAccount_paused_consistent"
  CHECK ("payoutsPaused" = false OR "pausedAt" IS NOT NULL);
ALTER TABLE "HostPayout" ADD CONSTRAINT "HostPayout_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "HostPayout" ADD CONSTRAINT "HostPayout_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
