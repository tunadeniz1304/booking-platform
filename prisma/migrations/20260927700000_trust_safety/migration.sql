-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REQUIRES_INPUT', 'FAILED');

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT NOT NULL,
    "lastError" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRiskFlag" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "bookingId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "llmSignal" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyRiskAssessment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "flagged" BOOLEAN NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdentityVerification_userId_createdAt_idx" ON "IdentityVerification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityVerification_provider_providerRef_key" ON "IdentityVerification"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "MessageRiskFlag_messageId_key" ON "MessageRiskFlag"("messageId");

-- CreateIndex
CREATE INDEX "MessageRiskFlag_bookingId_createdAt_idx" ON "MessageRiskFlag"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartyRiskAssessment_bookingId_key" ON "PartyRiskAssessment"("bookingId");

-- CreateIndex
CREATE INDEX "PartyRiskAssessment_hostId_flagged_createdAt_idx" ON "PartyRiskAssessment"("hostId", "flagged", "createdAt");

