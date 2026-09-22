-- pgvector semantik arama + pg_trgm fuzzy arama eklentileri
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "embedding" vector(128);

-- CreateTable
CREATE TABLE "DemandEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "impact" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemandEvent_locationId_startsAt_idx" ON "DemandEvent"("locationId", "startsAt");

-- CreateIndex
CREATE INDEX "DemandEvent_startsAt_endsAt_idx" ON "DemandEvent"("startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "DemandEvent" ADD CONSTRAINT "DemandEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
