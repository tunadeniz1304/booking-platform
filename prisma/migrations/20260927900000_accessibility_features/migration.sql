-- P1-13(e): doğrulanmış erişilebilirlik özellikleri (ADA 36.302(e), EAA)
CREATE TYPE "AccessibilityCode" AS ENUM (
    'STEP_FREE_ENTRANCE',
    'STEP_FREE_PATH_TO_ROOM',
    'ROLL_IN_SHOWER',
    'GRAB_BARS',
    'SHOWER_CHAIR',
    'ACCESSIBLE_PARKING',
    'WIDE_DOORWAY',
    'ELEVATOR',
    'VISUAL_ALARM',
    'LOWERED_BED',
    'ACCESSIBLE_TOILET'
);

CREATE TABLE "AccessibilityFeature" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "code" "AccessibilityCode" NOT NULL,
    "widthCm" INTEGER,
    "note" TEXT,
    "evidencePhotoId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessibilityFeature_pkey" PRIMARY KEY ("id"),
    -- Genişlik yalnız kapı için ve makul aralıkta.
    CONSTRAINT "AccessibilityFeature_width_check" CHECK (
        "widthCm" IS NULL OR ("code" = 'WIDE_DOORWAY' AND "widthCm" BETWEEN 50 AND 300)
    ),
    -- Doğrulama zamanı ve doğrulayan birlikte.
    CONSTRAINT "AccessibilityFeature_verified_check" CHECK (
        ("verifiedAt" IS NULL) = ("verifiedById" IS NULL)
    )
);

CREATE UNIQUE INDEX "AccessibilityFeature_propertyId_roomTypeId_code_key" ON "AccessibilityFeature"("propertyId", "roomTypeId", "code");
-- NULL roomTypeId (ilan düzeyi) için de tekillik: PG'de NULL'lar farklı sayılır.
CREATE UNIQUE INDEX "AccessibilityFeature_property_level_code_key" ON "AccessibilityFeature"("propertyId", "code") WHERE "roomTypeId" IS NULL;
CREATE INDEX "AccessibilityFeature_code_verifiedAt_idx" ON "AccessibilityFeature"("code", "verifiedAt");
CREATE INDEX "AccessibilityFeature_roomTypeId_idx" ON "AccessibilityFeature"("roomTypeId");
CREATE INDEX "AccessibilityFeature_evidencePhotoId_idx" ON "AccessibilityFeature"("evidencePhotoId");

ALTER TABLE "AccessibilityFeature" ADD CONSTRAINT "AccessibilityFeature_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessibilityFeature" ADD CONSTRAINT "AccessibilityFeature_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessibilityFeature" ADD CONSTRAINT "AccessibilityFeature_evidencePhotoId_fkey" FOREIGN KEY ("evidencePhotoId") REFERENCES "PropertyPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kanıt fotoğrafı silinince (ON DELETE SET NULL dahil) veya kanıt/kod/ölçü değişince doğrulama düşer:
-- herkese gösterilen "doğrulanmış" rozet yalnız admin'in gördüğü kanıta dayanır.
CREATE FUNCTION "accessibility_feature_reset_verification"() RETURNS trigger AS $$
BEGIN
    IF NEW."evidencePhotoId" IS DISTINCT FROM OLD."evidencePhotoId"
       OR NEW."code" IS DISTINCT FROM OLD."code"
       OR NEW."widthCm" IS DISTINCT FROM OLD."widthCm"
       OR NEW."roomTypeId" IS DISTINCT FROM OLD."roomTypeId" THEN
        NEW."verifiedAt" := NULL;
        NEW."verifiedById" := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccessibilityFeature_reset_verification"
    BEFORE UPDATE ON "AccessibilityFeature"
    FOR EACH ROW EXECUTE FUNCTION "accessibility_feature_reset_verification"();
