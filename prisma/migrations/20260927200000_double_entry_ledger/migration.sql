-- P0-3: çift girişli defter (ledger v2, ADR 0020)
-- CreateEnum
CREATE TYPE "LedgerAccountKind" AS ENUM ('GUEST_RECEIVABLE', 'PSP_CLEARING', 'HOST_PAYABLE', 'PLATFORM_REVENUE', 'TAX_PAYABLE', 'GUEST_CREDIT', 'ESCROW');

-- CreateEnum
CREATE TYPE "JournalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "LedgerAccountKind" NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "linesHash" TEXT NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "transferId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "JournalSide" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerAccount_kind_ownerId_idx" ON "LedgerAccount"("kind", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_idempotencyKey_key" ON "JournalEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JournalEntry_bookingId_idx" ON "JournalEntry"("bookingId");

-- CreateIndex
CREATE INDEX "JournalEntry_paymentId_idx" ON "JournalEntry"("paymentId");

-- CreateIndex
CREATE INDEX "JournalEntry_transferId_idx" ON "JournalEntry"("transferId");

-- CreateIndex
CREATE INDEX "JournalEntry_occurredAt_idx" ON "JournalEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_currency_idx" ON "JournalLine"("accountId", "currency");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Satır tutarı pozitif, para birimi ISO-4217 biçiminde.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amountMinor_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_owner_code" CHECK (
  ("ownerId" IS NULL AND "code" = lower("kind"::text))
  OR ("ownerId" IS NOT NULL AND "code" = lower("kind"::text) || ':' || "ownerId")
);

-- Sistem hesapları (kişi alt hesapları uygulama tarafından ilk kullanımda açılır).
INSERT INTO "LedgerAccount" ("id", "code", "kind", "name") VALUES
  ('acct_guest_receivable', 'guest_receivable', 'GUEST_RECEIVABLE', 'Misafir alacakları'),
  ('acct_psp_clearing', 'psp_clearing', 'PSP_CLEARING', 'PSP takas hesabı'),
  ('acct_host_payable', 'host_payable', 'HOST_PAYABLE', 'Ev sahibi / satıcı borçları'),
  ('acct_platform_revenue', 'platform_revenue', 'PLATFORM_REVENUE', 'Platform geliri'),
  ('acct_tax_payable', 'tax_payable', 'TAX_PAYABLE', 'Ödenecek vergiler'),
  ('acct_guest_credit', 'guest_credit', 'GUEST_CREDIT', 'Misafir kredileri'),
  ('acct_escrow', 'escrow', 'ESCROW', 'Emanet (escrow)');

-- Denge koruması: her jurnal, işlem sonunda (DEFERRED) para birimi başına Σborç = Σalacak
-- olmalı ve en az iki satır taşımalı. Uygulamadaki assertBalanced ilk savunma hattıdır;
-- bu tetik ham SQL veya hatalı kod yolunu da yakalar.
CREATE FUNCTION ledger_assert_entry_balanced() RETURNS trigger AS $$
DECLARE
  eid TEXT;
  n INT;
  bad RECORD;
BEGIN
  IF TG_TABLE_NAME = 'JournalLine' THEN
    eid := NEW."entryId";
  ELSE
    eid := NEW."id";
  END IF;
  SELECT count(*) INTO n FROM "JournalLine" WHERE "entryId" = eid;
  IF n < 2 THEN
    RAISE EXCEPTION 'ledger_unbalanced: entry % has % line(s)', eid, n USING ERRCODE = '23514';
  END IF;
  SELECT "currency",
         SUM(CASE WHEN "side" = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) AS diff
    INTO bad
    FROM "JournalLine"
   WHERE "entryId" = eid
   GROUP BY "currency"
  HAVING SUM(CASE WHEN "side" = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger_unbalanced: entry % currency % diff %', eid, bad."currency", bad.diff
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalLine_balanced"
  AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_entry_balanced();

CREATE CONSTRAINT TRIGGER "JournalEntry_balanced"
  AFTER INSERT ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_entry_balanced();

-- Defter yalnızca eklenir: düzeltme ters kayıtla yapılır (UPDATE/DELETE reddedilir).
CREATE FUNCTION ledger_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_immutable: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_immutable" BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
CREATE TRIGGER "JournalLine_immutable" BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
