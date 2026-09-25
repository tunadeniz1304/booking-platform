-- CreateEnum
CREATE TYPE "ReviewModerationStatus" AS ENUM ('PUBLISHED', 'PENDING_REVIEW', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "licenseCheckedAt" TIMESTAMP(3),
ADD COLUMN     "licenseStatus" "LicenseStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "cleanliness" INTEGER,
ADD COLUMN     "location" INTEGER,
ADD COLUMN     "moderationReasons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "moderationStatus" "ReviewModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "reportCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staff" INTEGER,
ADD COLUMN     "value" INTEGER;

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "maskedKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fromAiDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterId_key" ON "ReviewReport"("reviewId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_bookingId_key" ON "MessageThread"("bookingId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_propertyId_moderationStatus_idx" ON "Review"("propertyId", "moderationStatus");

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- P1-10: mevcut, belge numarası olan ilanlar önceki kurala göre yayında olduğundan doğrulanmış sayılır;
-- (değişmez: yayındaki ilan ⇒ VERIFIED; yeni yazımlarda host-service zorlar).
UPDATE "Property" SET "licenseStatus" = 'VERIFIED', "licenseCheckedAt" = CURRENT_TIMESTAMP
  WHERE "licenseNumber" IS NOT NULL;
