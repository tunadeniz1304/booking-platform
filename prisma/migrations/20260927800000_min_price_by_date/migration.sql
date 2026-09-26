-- P1-3: esnek tarih fiyat takvimi (materyalize en ucuz gece fiyatı)
-- CreateTable
CREATE TABLE "MinPriceByDate" (
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minNightlyMinor" BIGINT,
    "minTotalMinor" BIGINT,
    "currency" TEXT NOT NULL,
    "availableRoomTypes" INTEGER NOT NULL,
    "roomTypeId" TEXT,
    "ratePlanId" TEXT,
    "minStay" INTEGER,
    "closedToArrival" BOOLEAN NOT NULL DEFAULT false,
    "guests" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MinPriceByDate_pkey" PRIMARY KEY ("propertyId","date")
);

-- CreateIndex
CREATE INDEX "MinPriceByDate_date_idx" ON "MinPriceByDate"("date");
