-- v4#1: devir iki aşamalı — capture başarılı olmadan sahiplik/payout yazılmaz.
ALTER TYPE "TransferStatus" ADD VALUE 'CAPTURE_PENDING';
ALTER TYPE "TransferStatus" ADD VALUE 'FAILED';
ALTER TABLE "BookingTransfer" ADD COLUMN "failedAt" TIMESTAMP(3);
ALTER TABLE "BookingTransfer" ADD COLUMN "failureCode" TEXT;
