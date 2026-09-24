-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "licenseNumber" TEXT;

-- CreateTable
CREATE TABLE "FraudCheck" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSequence" (
    "roomId" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL,
    "lastKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSequence_pkey" PRIMARY KEY ("roomId")
);

-- CreateIndex
CREATE INDEX "FraudCheck_decision_createdAt_idx" ON "FraudCheck"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "FraudCheck_bookingId_idx" ON "FraudCheck"("bookingId");

