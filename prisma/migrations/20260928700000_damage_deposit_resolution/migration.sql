-- P1-5: hasar depozitosu (ön provizyon) + çözüm merkezi talepleri/kanıtları (ADR 0021 §Depozito)

-- CreateEnum
CREATE TYPE "DamageDepositStatus" AS ENUM ('SCHEDULED', 'AUTHORIZED', 'CAPTURED_PARTIAL', 'CAPTURED', 'VOIDED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('GUEST_REFUND', 'HOST_DAMAGE', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'AWAITING_RESPONSE', 'ESCALATED', 'RESOLVED_APPROVED', 'RESOLVED_PARTIAL', 'RESOLVED_REJECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "DamageDepositSetting" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageDepositSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageDeposit" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "capturedMinor" BIGINT NOT NULL DEFAULT 0,
    "status" "DamageDepositStatus" NOT NULL DEFAULT 'SCHEDULED',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "sourcePaymentRef" TEXT,
    "failureCode" TEXT,
    "authorizeAfter" TIMESTAMP(3) NOT NULL,
    "voidAfter" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL,
    "openedById" TEXT,
    "respondentId" TEXT,
    "amountRequestedMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'AWAITING_RESPONSE',
    "slaDueAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "awardedMinor" BIGINT,
    "settledMinor" BIGINT,
    "uncollectedMinor" BIGINT,
    "platformCoveredMinor" BIGINT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "externalStatus" TEXT,
    "externalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimMessage" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DamageDepositSetting_propertyId_idx" ON "DamageDepositSetting"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "DamageDepositSetting_propertyId_roomTypeId_key" ON "DamageDepositSetting"("propertyId", "roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "DamageDeposit_bookingId_key" ON "DamageDeposit"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DamageDeposit_providerRef_key" ON "DamageDeposit"("providerRef");

-- CreateIndex
CREATE INDEX "DamageDeposit_status_authorizeAfter_idx" ON "DamageDeposit"("status", "authorizeAfter");

-- CreateIndex
CREATE INDEX "DamageDeposit_status_voidAfter_idx" ON "DamageDeposit"("status", "voidAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_externalRef_key" ON "Claim"("externalRef");

-- CreateIndex
CREATE INDEX "Claim_bookingId_idx" ON "Claim"("bookingId");

-- CreateIndex
CREATE INDEX "Claim_status_slaDueAt_idx" ON "Claim"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "Claim_openedById_idx" ON "Claim"("openedById");

-- CreateIndex
CREATE INDEX "Claim_respondentId_idx" ON "Claim"("respondentId");

-- CreateIndex
CREATE INDEX "ClaimMessage_claimId_createdAt_idx" ON "ClaimMessage"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaimEvidence_claimId_createdAt_idx" ON "ClaimEvidence"("claimId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaimMessage" ADD CONSTRAINT "ClaimMessage_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Depozito ayarı: ilan geneli (roomTypeId NULL) için de tekillik (NULL'lar UNIQUE'te ayrışır).
CREATE UNIQUE INDEX "DamageDepositSetting_property_level_key"
  ON "DamageDepositSetting"("propertyId") WHERE "roomTypeId" IS NULL;
ALTER TABLE "DamageDepositSetting" ADD CONSTRAINT "DamageDepositSetting_amount_positive"
  CHECK ("amountMinor" > 0);

-- Depozito: ön provizyon pozitif; capture 0..ön provizyon (P1-5 KK: capture ≤ pre-auth).
ALTER TABLE "DamageDeposit" ADD CONSTRAINT "DamageDeposit_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "DamageDeposit" ADD CONSTRAINT "DamageDeposit_capture_within_auth"
  CHECK ("capturedMinor" >= 0 AND "capturedMinor" <= "amountMinor");
ALTER TABLE "DamageDeposit" ADD CONSTRAINT "DamageDeposit_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "DamageDeposit" ADD CONSTRAINT "DamageDeposit_captured_status"
  CHECK (("status" IN ('CAPTURED', 'CAPTURED_PARTIAL')) = ("capturedMinor" > 0));

-- Talep: tutarlar negatif olamaz; rezervasyon + tür başına tek açık taraf talebi.
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_amounts_non_negative" CHECK (
  "amountRequestedMinor" >= 0
  AND ("awardedMinor" IS NULL OR "awardedMinor" >= 0)
  AND ("settledMinor" IS NULL OR "settledMinor" >= 0)
  AND ("uncollectedMinor" IS NULL OR "uncollectedMinor" >= 0)
  AND ("platformCoveredMinor" IS NULL OR "platformCoveredMinor" >= 0)
);
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
CREATE UNIQUE INDEX "Claim_one_open_per_booking_type"
  ON "Claim"("bookingId", "type")
  WHERE "type" <> 'CHARGEBACK' AND "status" IN ('OPEN', 'AWAITING_RESPONSE', 'ESCALATED');
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_size_positive" CHECK ("byteSize" > 0);
