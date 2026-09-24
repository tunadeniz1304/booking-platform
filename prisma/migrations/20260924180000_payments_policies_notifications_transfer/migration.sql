-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('CHARGE', 'REFUND', 'TRANSFER_PAYMENT', 'TRANSFER_PAYOUT');

-- CreateEnum
CREATE TYPE "CancellationPolicyKind" AS ENUM ('NON_REFUNDABLE', 'FLEXIBLE', 'MODERATE', 'STRICT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'REQUIRES_ACTION';
ALTER TYPE "PaymentStatus" ADD VALUE 'AUTHORIZED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'VOIDED';


-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "policySnapshot" JSONB;

-- AlterTable (veri korunarak): eski düz transfer token'ları özetlenir ve
-- güvensiz eski imza şemasıyla açılmış aktif ilanlar iptal edilir (hata #3).
ALTER TABLE "BookingTransfer"
ADD COLUMN     "buyerPaymentRef" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "tokenHash" TEXT;

UPDATE "BookingTransfer"
SET "tokenHash" = encode(sha256(convert_to("transferToken", 'UTF8')), 'hex'),
    "expiresAt" = "listedAt" + interval '7 days';

UPDATE "BookingTransfer"
SET status = 'CANCELLED', "cancelledAt" = CURRENT_TIMESTAMP
WHERE status IN ('LISTED', 'CLAIMED');

ALTER TABLE "BookingTransfer" ALTER COLUMN "tokenHash" SET NOT NULL,
ALTER COLUMN "expiresAt" SET NOT NULL;

DROP INDEX "BookingTransfer_transferToken_key";
ALTER TABLE "BookingTransfer" DROP COLUMN "transferToken";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "cancellationPolicyId" TEXT;

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerRef" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationPolicy" (
    "id" TEXT NOT NULL,
    "kind" "CancellationPolicyKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "userId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transport" TEXT NOT NULL DEFAULT 'mailbox',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentEvent_providerRef_idx" ON "PaymentEvent"("providerRef");

-- CreateIndex
CREATE INDEX "LedgerEntry_bookingId_idx" ON "LedgerEntry"("bookingId");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_idx" ON "LedgerEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_kind_version_key" ON "CancellationPolicy"("kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingTransfer_tokenHash_key" ON "BookingTransfer"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingTransfer_status_expiresAt_idx" ON "BookingTransfer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "CancellationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Varsayılan iptal politikaları (sürüm 1). Kurallar: iptal anında check-in'e kalan
-- saat >= hoursBefore ise refundPercent iade edilir; graceHours: rezervasyondan
-- sonraki bu süre içinde (check-in en az graceMinLeadHours uzaktaysa) tam iade.
INSERT INTO "CancellationPolicy" ("id", "kind", "version", "rules") VALUES
  ('policy_non_refundable_v1', 'NON_REFUNDABLE', 1, '{"tiers":[{"hoursBefore":0,"refundPercent":0}]}'),
  ('policy_flexible_v1', 'FLEXIBLE', 1, '{"tiers":[{"hoursBefore":24,"refundPercent":100},{"hoursBefore":0,"refundPercent":0}]}'),
  ('policy_moderate_v1', 'MODERATE', 1, '{"tiers":[{"hoursBefore":120,"refundPercent":100},{"hoursBefore":24,"refundPercent":50},{"hoursBefore":0,"refundPercent":0}]}'),
  ('policy_strict_v1', 'STRICT', 1, '{"tiers":[{"hoursBefore":336,"refundPercent":100},{"hoursBefore":168,"refundPercent":50},{"hoursBefore":0,"refundPercent":0}],"graceHours":48,"graceMinLeadHours":336}');
