-- P0-5 veri yaşam döngüsü: saklama bakım işinin (data-retention) parti silme taramaları için
-- zaman sütunu indeksleri. Yalnızca ekleme; veri değişmez.

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_processedAt_idx" ON "OutboxMessage"("status", "processedAt");

-- CreateIndex
CREATE INDEX "InventoryPriceHistory_effectiveAt_idx" ON "InventoryPriceHistory"("effectiveAt");

-- CreateIndex
CREATE INDEX "MessageRiskFlag_createdAt_idx" ON "MessageRiskFlag"("createdAt");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
