-- v5#2: hasar depozitosu iki aşamalı capture niyeti (CAPTURING) + süpürücü alanları.
ALTER TYPE "DamageDepositStatus" ADD VALUE 'CAPTURING';

ALTER TABLE "DamageDeposit" ADD COLUMN     "captureClaimId" TEXT,
ADD COLUMN     "captureIntentMinor" BIGINT,
ADD COLUMN     "captureStartedAt" TIMESTAMP(3);

CREATE INDEX "DamageDeposit_status_captureStartedAt_idx" ON "DamageDeposit"("status", "captureStartedAt");
