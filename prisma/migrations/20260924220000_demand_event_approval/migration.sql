-- CreateEnum
CREATE TYPE "DemandEventStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'ROLLED_BACK');

-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "priceExplanation" JSONB;

-- AlterTable
ALTER TABLE "DemandEvent" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "proposedBy" TEXT,
ADD COLUMN     "rationale" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" "DemandEventStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "DemandEvent_status_locationId_idx" ON "DemandEvent"("status", "locationId");

