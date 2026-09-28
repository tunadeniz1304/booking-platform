-- P0-3 (ADR 0020 contract adımı, ADR 0033): eski `LedgerEntry` defteri kaldırılır.
-- v5'ten itibaren tüm para hareketleri yalnız çift girişli jurnale (`JournalEntry`/`JournalLine`)
-- yazılır; v3 biçimli okuma (`listBookingLedger`) jurnalden türetilir. Eski satırlar jurnalle
-- dual-write edildiği için bilgi kaybı yoktur.

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_bookingId_fkey";

-- DropTable
DROP TABLE "LedgerEntry";

-- DropEnum
DROP TYPE "LedgerKind";
