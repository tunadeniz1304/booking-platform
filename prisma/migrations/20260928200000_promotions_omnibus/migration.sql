-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('EARLY_BIRD', 'LAST_MINUTE', 'LONG_STAY', 'MOBILE_RATE', 'COUPON');

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "discountBps" INTEGER,
    "discountMinor" BIGINT,
    "currency" TEXT,
    "minDaysBefore" INTEGER,
    "maxDaysBefore" INTEGER,
    "minNights" INTEGER,
    "couponCode" TEXT,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "stackGroup" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPriceHistory" (
    "id" BIGSERIAL NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_hostId_active_idx" ON "Promotion"("hostId", "active");

-- CreateIndex
CREATE INDEX "Promotion_propertyId_active_idx" ON "Promotion"("propertyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_hostId_couponCode_key" ON "Promotion"("hostId", "couponCode");

-- CreateIndex
CREATE INDEX "PromotionRedemption_bookingId_idx" ON "PromotionRedemption"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_promotionId_bookingId_key" ON "PromotionRedemption"("promotionId", "bookingId");

-- CreateIndex
CREATE INDEX "InventoryPriceHistory_roomTypeId_date_effectiveAt_idx" ON "InventoryPriceHistory"("roomTypeId", "date", "effectiveAt");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- P1-8: indirim tam olarak bir biçimde (yüzde XOR sabit tutar); sabit tutarda para birimi zorunlu.
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_discount_check" CHECK (
  ("discountBps" IS NOT NULL AND "discountMinor" IS NULL AND "discountBps" BETWEEN 1 AND 10000)
  OR ("discountBps" IS NULL AND "discountMinor" IS NOT NULL AND "discountMinor" > 0 AND "currency" IS NOT NULL)
);
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_usage_check" CHECK (
  "usageCount" >= 0 AND ("usageLimit" IS NULL OR ("usageLimit" >= 1 AND "usageCount" <= "usageLimit"))
);
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_type_fields_check" CHECK (
  ("type" <> 'EARLY_BIRD' OR "minDaysBefore" IS NOT NULL)
  AND ("type" <> 'LAST_MINUTE' OR "maxDaysBefore" IS NOT NULL)
  AND ("type" <> 'LONG_STAY' OR "minNights" IS NOT NULL)
  AND ("type" <> 'COUPON' OR "couponCode" IS NOT NULL)
);

-- P1-8 Omnibus: gece fiyatı her değiştiğinde geçmişe yaz (tüm yazıcılar: fiyat motoru, ARI,
-- kanal yöneticisi, devir/rollover, ham SQL).
CREATE OR REPLACE FUNCTION inventory_price_history_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."priceMinor" IS DISTINCT FROM OLD."priceMinor" THEN
    INSERT INTO "InventoryPriceHistory" ("roomTypeId", "date", "priceMinor", "effectiveAt")
    VALUES (NEW."roomTypeId", NEW."date", NEW."priceMinor", clock_timestamp() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryDay_price_history"
AFTER INSERT OR UPDATE OF "priceMinor" ON "InventoryDay"
FOR EACH ROW EXECUTE FUNCTION inventory_price_history_log();

-- Mevcut fiyatlar başlangıç gözlemi olarak (geçmiş bilinmiyor → şimdi yürürlükte).
INSERT INTO "InventoryPriceHistory" ("roomTypeId", "date", "priceMinor", "effectiveAt")
SELECT "roomTypeId", "date", "priceMinor", CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM "InventoryDay";
