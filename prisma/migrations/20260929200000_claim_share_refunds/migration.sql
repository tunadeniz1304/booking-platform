-- fix-sweep-2: bölünmüş ödemeli rezervasyonda misafir talebi iadesinin pay dağılımı.
-- CreateTable
CREATE TABLE "ClaimShareRefund" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refundRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimShareRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimShareRefund_claimId_shareId_key" ON "ClaimShareRefund"("claimId", "shareId");

-- CreateIndex
CREATE INDEX "ClaimShareRefund_bookingId_idx" ON "ClaimShareRefund"("bookingId");

-- Tutar pozitif, durum bilinen değerlerden biri, para birimi ISO-4217 biçiminde.
ALTER TABLE "ClaimShareRefund" ADD CONSTRAINT "ClaimShareRefund_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "ClaimShareRefund" ADD CONSTRAINT "ClaimShareRefund_status_check" CHECK ("status" IN ('PENDING', 'DONE'));
ALTER TABLE "ClaimShareRefund" ADD CONSTRAINT "ClaimShareRefund_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
