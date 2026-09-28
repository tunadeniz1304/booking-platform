-- v5 P1-3 (ADR 0028): "şimdi rezerve et, sonra öde" zamanlanmış tahsilat planı.

-- CreateEnum
CREATE TYPE "PaymentScheduleStatus" AS ENUM ('SCHEDULED', 'RETRYING', 'CAPTURED', 'CANCELLED', 'DEFAULTED');

-- CreateTable
CREATE TABLE "PaymentSchedule" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "paymentMethodRef" TEXT NOT NULL,
    "customerRef" TEXT,
    "freeCancellationUntil" TIMESTAMP(3) NOT NULL,
    "firstFailedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastFailureCode" TEXT,
    "providerRef" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSchedule_bookingId_key" ON "PaymentSchedule"("bookingId");

-- CreateIndex
CREATE INDEX "PaymentSchedule_status_dueAt_idx" ON "PaymentSchedule"("status", "dueAt");

-- CreateIndex
CREATE INDEX "PaymentSchedule_status_nextAttemptAt_idx" ON "PaymentSchedule"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
