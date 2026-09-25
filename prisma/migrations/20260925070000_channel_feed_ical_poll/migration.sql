-- CreateTable
CREATE TABLE "ChannelFeed" (
    "roomTypeId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelFeed_pkey" PRIMARY KEY ("roomTypeId")
);

-- CreateTable
CREATE TABLE "IcalSubscription" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "etag" VARCHAR(512),
    "lastModified" VARCHAR(128),
    "lastPolledAt" TIMESTAMP(3),
    "lastStatus" VARCHAR(32),
    "lastError" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IcalSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IcalSubscription_active_lastPolledAt_idx" ON "IcalSubscription"("active", "lastPolledAt");

-- CreateIndex
CREATE UNIQUE INDEX "IcalSubscription_roomTypeId_source_key" ON "IcalSubscription"("roomTypeId", "source");

