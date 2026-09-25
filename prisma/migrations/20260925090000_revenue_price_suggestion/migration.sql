-- CreateEnum
CREATE TYPE "PriceSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "InventoryDay" ADD COLUMN     "priceOverride" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PriceSuggestion" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "currentMinor" INTEGER NOT NULL,
    "suggestedMinor" INTEGER NOT NULL,
    "floorMinor" INTEGER NOT NULL,
    "ceilingMinor" INTEGER NOT NULL,
    "contributions" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "llmMode" TEXT NOT NULL,
    "status" "PriceSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceSuggestion_roomTypeId_status_date_idx" ON "PriceSuggestion"("roomTypeId", "status", "date");

-- AddForeignKey
ALTER TABLE "PriceSuggestion" ADD CONSTRAINT "PriceSuggestion_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

