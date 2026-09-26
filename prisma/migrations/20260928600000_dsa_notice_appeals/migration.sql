-- P2-1a: DSA md. 20 iç şikâyet (itiraz) kaydı
-- CreateEnum
CREATE TYPE "NoticeAppealRole" AS ENUM ('REPORTER', 'HOST');

-- CreateEnum
CREATE TYPE "NoticeAppealStatus" AS ENUM ('PENDING', 'UPHELD', 'REJECTED');

-- CreateTable
CREATE TABLE "NoticeAppeal" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "propertyId" TEXT,
    "appellantRole" "NoticeAppealRole" NOT NULL,
    "appellantEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'tr',
    "status" "NoticeAppealStatus" NOT NULL DEFAULT 'PENDING',
    "response" TEXT,
    "decisionGround" "NoticeGround",
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeAppeal_status_createdAt_idx" ON "NoticeAppeal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NoticeAppeal_propertyId_idx" ON "NoticeAppeal"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeAppeal_noticeId_appellantRole_key" ON "NoticeAppeal"("noticeId", "appellantRole");
