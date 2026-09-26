-- fix-sweep-2: PSP müşteri kaydı (Stripe Customer) — depozito için off-session kart kullanımı.
-- CreateTable
CREATE TABLE "PaymentCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "customerRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCustomer_customerRef_key" ON "PaymentCustomer"("customerRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCustomer_userId_provider_key" ON "PaymentCustomer"("userId", "provider");
