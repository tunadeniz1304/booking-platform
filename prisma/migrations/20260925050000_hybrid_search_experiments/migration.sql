-- P1-1 hibrit arama: başlık + açıklamadan üretilen tsvector (simple + turkish yapılandırması).
-- GENERATED ALWAYS STORED: uygulama kodu yazmaz, satır değişince PostgreSQL günceller.
ALTER TABLE "Property" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, coalesce("title", '')), 'A') ||
    setweight(to_tsvector('turkish'::regconfig, coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce("description", '')), 'B') ||
    setweight(to_tsvector('turkish'::regconfig, coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "Property_searchVector_idx" ON "Property" USING GIN ("searchVector");

-- P1-3: deney maruziyeti
CREATE TABLE "ExperimentExposure" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentExposure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExperimentExposure_flagKey_variant_idx" ON "ExperimentExposure"("flagKey", "variant");

CREATE UNIQUE INDEX "ExperimentExposure_flagKey_subjectId_key" ON "ExperimentExposure"("flagKey", "subjectId");
