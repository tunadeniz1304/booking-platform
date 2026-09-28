-- v5 P1-1 (ADR 0035): mandate nonce'u Redis'e ek olarak kalıcı olarak DB'de tutulur.
-- Redis kaybında aynı mandate'in başka bir checkout oturumuna bağlanmasını engeller.

-- CreateTable
CREATE TABLE "AgentMandateUse" (
    "nonce" VARCHAR(128) NOT NULL,
    "userId" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMandateUse_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "AgentMandateUse_userId_createdAt_idx" ON "AgentMandateUse"("userId", "createdAt");
