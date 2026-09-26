-- P1-13: 7565 kaldırma talepleri + DSA bildirimleri
-- CreateEnum
CREATE TYPE "TakedownSource" AS ENUM ('MINISTRY_7565', 'COURT_ORDER', 'OTHER_AUTHORITY');

-- CreateEnum
CREATE TYPE "TakedownStatus" AS ENUM ('RECEIVED', 'ACTIONED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NoticeCategory" AS ENUM ('ILLEGAL_LISTING', 'UNLICENSED', 'FRAUD_SCAM', 'IP_INFRINGEMENT', 'DISCRIMINATION', 'UNSAFE', 'OTHER');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('RECEIVED', 'DECIDED');

-- CreateEnum
CREATE TYPE "NoticeDecision" AS ENUM ('REMOVED', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "NoticeGround" AS ENUM ('ILLEGAL_CONTENT', 'TERMS_OF_SERVICE');

-- CreateTable
CREATE TABLE "TakedownRequest" (
    "id" TEXT NOT NULL,
    "source" "TakedownSource" NOT NULL,
    "referenceNo" TEXT,
    "propertyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "status" "TakedownStatus" NOT NULL DEFAULT 'RECEIVED',
    "actionedAt" TIMESTAMP(3),
    "slaCheckedAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakedownRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "contentUrl" TEXT NOT NULL,
    "category" "NoticeCategory" NOT NULL,
    "explanation" TEXT NOT NULL,
    "reporterName" TEXT,
    "reporterEmail" TEXT NOT NULL,
    "goodFaith" BOOLEAN NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'tr',
    "status" "NoticeStatus" NOT NULL DEFAULT 'RECEIVED',
    "decision" "NoticeDecision",
    "decisionGround" "NoticeGround",
    "legalReference" TEXT,
    "statementOfReasons" TEXT,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TakedownRequest_propertyId_status_idx" ON "TakedownRequest"("propertyId", "status");

-- CreateIndex
CREATE INDEX "TakedownRequest_status_slaDueAt_idx" ON "TakedownRequest"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "Notice_status_createdAt_idx" ON "Notice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notice_propertyId_idx" ON "Notice"("propertyId");

