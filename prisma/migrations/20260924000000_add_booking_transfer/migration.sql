-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('LISTED','CLAIMED','COMPLETED','CANCELLED');

-- CreateTable
CREATE TABLE "BookingTransfer" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'LISTED',
    "askPrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "transferToken" TEXT NOT NULL,
    "listedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BookingTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingTransfer_transferToken_key" ON "BookingTransfer"("transferToken");

-- CreateIndex
CREATE INDEX "BookingTransfer_status_bookingId_idx" ON "BookingTransfer"("status", "bookingId");

-- CreateIndex
CREATE INDEX "BookingTransfer_sellerId_idx" ON "BookingTransfer"("sellerId");

-- CreateIndex
CREATE INDEX "BookingTransfer_claimedById_idx" ON "BookingTransfer"("claimedById");

-- AddForeignKey
ALTER TABLE "BookingTransfer" ADD CONSTRAINT "BookingTransfer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTransfer" ADD CONSTRAINT "BookingTransfer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTransfer" ADD CONSTRAINT "BookingTransfer_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
