-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "avgNightlyPrice" DECIMAL(10,2) NOT NULL,
    "demandIndex" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceHistory_propertyId_month_idx" ON "PriceHistory"("propertyId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PriceHistory_propertyId_month_key" ON "PriceHistory"("propertyId", "month");

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
