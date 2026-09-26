-- P1-1: çok odalı / grup sepeti (Cart, CartItem, CartPayment) + Booking.cartId + Payment.cartPaymentId

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('OPEN', 'HELD', 'CHECKED_OUT', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cartId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cartPaymentId" TEXT;

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "holdIdempotencyKey" TEXT,
    "holdRequestHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "checkedOutAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "ratePlanId" TEXT,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "quotedTotalMinor" BIGINT NOT NULL,
    "quotedPropertyTotalMinor" BIGINT NOT NULL,
    "propertyCurrency" TEXT NOT NULL,
    "quoteSnapshot" JSONB,
    "fxSnapshotId" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartPayment" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "refundedAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cart_userId_status_idx" ON "Cart"("userId", "status");

-- CreateIndex
CREATE INDEX "Cart_status_holdExpiresAt_idx" ON "Cart"("status", "holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_holdIdempotencyKey_key" ON "Cart"("userId", "holdIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_bookingId_key" ON "CartItem"("bookingId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "CartPayment_cartId_key" ON "CartPayment"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "CartPayment_providerRef_key" ON "CartPayment"("providerRef");

-- CreateIndex
CREATE INDEX "CartPayment_userId_idx" ON "CartPayment"("userId");

-- CreateIndex
CREATE INDEX "CartPayment_status_idx" ON "CartPayment"("status");

-- CreateIndex
CREATE INDEX "Booking_cartId_idx" ON "Booking"("cartId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cartPaymentId_fkey" FOREIGN KEY ("cartPaymentId") REFERENCES "CartPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartPayment" ADD CONSTRAINT "CartPayment_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Kullanıcı başına en fazla bir aktif sepet (OPEN/HELD). Prisma kısmi indeksi modellemez.
CREATE UNIQUE INDEX "Cart_one_active_per_user" ON "Cart"("userId") WHERE "status" IN ('OPEN', 'HELD');

-- Kalem doğrulaması (uygulama katmanına ek savunma).
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_occupancy_check" CHECK ("adults" >= 1 AND "children" >= 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_dates_check" CHECK ("checkOut" > "checkIn");
ALTER TABLE "CartPayment" ADD CONSTRAINT "CartPayment_amount_check" CHECK ("amountMinor" >= 0 AND "refundedAmountMinor" >= 0);
