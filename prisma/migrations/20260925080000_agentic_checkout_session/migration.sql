-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "checkIn" VARCHAR(10) NOT NULL,
    "checkOut" VARCHAR(10) NOT NULL,
    "guests" INTEGER NOT NULL,
    "quoteId" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "totals" JSONB NOT NULL,
    "bookingId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutSession_userId_createdAt_idx" ON "CheckoutSession"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_userId_idempotencyKey_key" ON "CheckoutSession"("userId", "idempotencyKey");

