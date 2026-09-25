-- P0-5 kalıcı kur tablosu: FxRate + Booking.fxSnapshotId
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "fxSnapshotId" TEXT;

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'TRY',
    "rates" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRate_fetchedAt_idx" ON "FxRate"("fetchedAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_fxSnapshotId_fkey" FOREIGN KEY ("fxSnapshotId") REFERENCES "FxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

