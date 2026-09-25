-- v3 P0-2 / P0-3 — Oda tipi envanteri (ADR 0010) ve tesis saat dilimi (ADR 0011).
-- Veri taşıma: her mevcut `Room` 1 birimlik `RoomType` olur; `Availability` boolean satırları
-- sayaçlı `InventoryDay` satırlarına çevrilir (HELD → held=1, CONFIRMED → sold=1,
-- iCal kilidi → sold=1 + ExternalBlock, sahibinin kapattığı gece → stop-sell kısıtı).

-- 1) Room → RoomType ------------------------------------------------------------------
ALTER TABLE "Room" RENAME TO "RoomType";
ALTER TABLE "RoomType" RENAME CONSTRAINT "Room_pkey" TO "RoomType_pkey";
ALTER TABLE "RoomType" RENAME CONSTRAINT "Room_propertyId_fkey" TO "RoomType_propertyId_fkey";
ALTER INDEX "Room_propertyId_idx" RENAME TO "RoomType_propertyId_idx";
ALTER INDEX "Room_available_idx" RENAME TO "RoomType_available_idx";
ALTER TABLE "RoomType" RENAME COLUMN "capacity" TO "maxOccupancy";
ALTER TABLE "RoomType" ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RoomType" ADD CONSTRAINT "RoomType_units_check" CHECK ("units" >= 0);
ALTER TABLE "RoomType" ADD CONSTRAINT "RoomType_maxOccupancy_check" CHECK ("maxOccupancy" >= 1);

-- 2) Tesis saat dilimi --------------------------------------------------------------------
ALTER TABLE "Property"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  ADD COLUMN "checkInTime" TEXT NOT NULL DEFAULT '15:00',
  ADD COLUMN "checkOutTime" TEXT NOT NULL DEFAULT '11:00';

-- 3) Fiyat planları ------------------------------------------------------------------------
CREATE TYPE "MealPlan" AS ENUM ('ROOM_ONLY', 'BREAKFAST', 'HALF_BOARD', 'FULL_BOARD');

CREATE TABLE "RatePlan" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mealPlan" "MealPlan" NOT NULL DEFAULT 'ROOM_ONLY',
    "refundable" BOOLEAN NOT NULL DEFAULT true,
    "cancellationPolicyId" TEXT,
    "priceModifierBps" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RatePlan_priceModifierBps_check" CHECK ("priceModifierBps" > -10000)
);
CREATE UNIQUE INDEX "RatePlan_roomTypeId_code_key" ON "RatePlan"("roomTypeId", "code");
CREATE INDEX "RatePlan_roomTypeId_active_idx" ON "RatePlan"("roomTypeId", "active");
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "CancellationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Her oda tipine varsayılan (iade edilebilir, yalnız oda) plan.
INSERT INTO "RatePlan" ("id", "roomTypeId", "code", "name", "isDefault")
SELECT 'rp_std_' || "id", "id", 'STANDARD', 'Standart', true FROM "RoomType";

-- 4) Kısıtlar ve harici bloklar -----------------------------------------------------------
CREATE TABLE "Restriction" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minStay" INTEGER,
    "maxStay" INTEGER,
    "closedToArrival" BOOLEAN NOT NULL DEFAULT false,
    "closedToDeparture" BOOLEAN NOT NULL DEFAULT false,
    "stopSell" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Restriction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Restriction_stay_check" CHECK (
      ("minStay" IS NULL OR "minStay" >= 1) AND ("maxStay" IS NULL OR "maxStay" >= 1)
    )
);
CREATE UNIQUE INDEX "Restriction_roomTypeId_date_key" ON "Restriction"("roomTypeId", "date");
ALTER TABLE "Restriction" ADD CONSTRAINT "Restriction_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ExternalBlock" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalBlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalBlock_roomTypeId_source_uid_date_key" ON "ExternalBlock"("roomTypeId", "source", "uid", "date");
CREATE INDEX "ExternalBlock_roomTypeId_source_idx" ON "ExternalBlock"("roomTypeId", "source");
ALTER TABLE "ExternalBlock" ADD CONSTRAINT "ExternalBlock_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Sayaçlı envanter -----------------------------------------------------------------------
CREATE TABLE "InventoryDay" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2) NOT NULL,
    "priceExplanation" JSONB,
    CONSTRAINT "InventoryDay_pkey" PRIMARY KEY ("id"),
    -- Overbooking veritabanı düzeyinde imkânsız (ADR 0010).
    CONSTRAINT "InventoryDay_counts_check" CHECK ("sold" >= 0 AND "held" >= 0 AND "total" >= 0 AND "sold" + "held" <= "total")
);
CREATE UNIQUE INDEX "InventoryDay_roomTypeId_date_key" ON "InventoryDay"("roomTypeId", "date");
CREATE INDEX "InventoryDay_date_idx" ON "InventoryDay"("date");
ALTER TABLE "InventoryDay" ADD CONSTRAINT "InventoryDay_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "InventoryDay" ("id", "roomTypeId", "date", "total", "sold", "held", "price", "priceExplanation")
SELECT
  a."id",
  a."roomId",
  a."date",
  1,
  CASE
    WHEN b."status" = 'CONFIRMED' THEN 1
    WHEN a."isAvailable" = false AND a."lockedBy" LIKE 'ical:%' THEN 1
    ELSE 0
  END,
  CASE WHEN b."status" IN ('HELD', 'PENDING') THEN 1 ELSE 0 END,
  a."price",
  a."priceExplanation"
FROM "Availability" a
LEFT JOIN "Booking" b ON b."id" = a."lockedBy";

INSERT INTO "ExternalBlock" ("id", "roomTypeId", "source", "uid", "date")
SELECT 'xb_' || a."id", a."roomId", substring(a."lockedBy" FROM 6), 'legacy', a."date"
FROM "Availability" a
WHERE a."isAvailable" = false AND a."lockedBy" LIKE 'ical:%';

-- Sahibinin kapattığı (kilitsiz) geceler → satış durdurma kısıtı.
INSERT INTO "Restriction" ("id", "roomTypeId", "date", "stopSell")
SELECT 'rs_' || a."id", a."roomId", a."date", true
FROM "Availability" a
WHERE a."isAvailable" = false AND a."lockedBy" IS NULL;

DROP TABLE "Availability";

-- 6) Rezervasyon: fiyat planı ve adet ------------------------------------------------------
ALTER TABLE "Booking" ADD COLUMN "ratePlanId" TEXT, ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_units_check" CHECK ("units" >= 1);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "Booking" SET "ratePlanId" = 'rp_std_' || "roomId";
