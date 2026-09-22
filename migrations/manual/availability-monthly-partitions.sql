-- ============================================================================
-- OPSİYONEL: Availability tablosu aylık RANGE partition yapısına geçiş
-- ============================================================================
-- Yüksek hacimli senaryolarda (milyonlarca gece kaydı) sorgu tarama alanını
-- aya indirir ve arşivleme kolaylaşır. Varsayılan kurulumda UYGULANMAZ;
-- ölçek geçişinde aşağıdaki komutla çalıştırın:
--
--   docker exec -i booking-db-1 psql -U booking -d booking -f - < migrations/manual/availability-monthly-partitions.sql
--
-- Bağımlılıklar:
--   * PRIMARY KEY    → (id, date)   (partition anahtarı her unique'e dahil edilmeli)
--   * UNIQUE (roomId, date) → partition anahtarı dahil, Prisma upsert (ON CONFLICT)
--     ve booking-service'in FOR UPDATE + updateMany { id in ... } akışları çalışır.
--   * FK roomId → Room  korunur.
-- ============================================================================

BEGIN;

-- 1) Eski tabloyu veriyle birlikte yeniden adlandır (güvenlik ağı)
ALTER TABLE "Availability" RENAME TO "Availability_legacy";

-- 1b) Eski indeksleri de yeniden adlandır — PG indeks adları şema genelidir;
--     yeni partition'lı tablo aynı adları yeniden kullanır.
DO $$
BEGIN
  IF to_regclass('"Availability_pkey"') IS NOT NULL THEN
    EXECUTE 'ALTER INDEX "Availability_pkey" RENAME TO "Availability_legacy_pkey"';
  END IF;
  IF to_regclass('"Availability_roomId_date_key"') IS NOT NULL THEN
    EXECUTE 'ALTER INDEX "Availability_roomId_date_key" RENAME TO "Availability_legacy_roomId_date_key"';
  END IF;
  IF to_regclass('"Availability_date_idx"') IS NOT NULL THEN
    EXECUTE 'ALTER INDEX "Availability_date_idx" RENAME TO "Availability_legacy_date_idx"';
  END IF;
  IF to_regclass('"Availability_roomId_isAvailable_date_idx"') IS NOT NULL THEN
    EXECUTE 'ALTER INDEX "Availability_roomId_isAvailable_date_idx" RENAME TO "Availability_legacy_roomId_isAvailable_date_idx"';
  END IF;
END $$;

-- 2) Partition edilmiş yeni tablo (montaj: date üzerinden)
CREATE TABLE "Availability" (
  "id"          TEXT        NOT NULL,
  "roomId"      TEXT        NOT NULL,
  "date"        DATE        NOT NULL,
  "isAvailable" BOOLEAN     NOT NULL DEFAULT true,
  "price"       DECIMAL(10, 2) NOT NULL,
  "lockedBy"    TEXT,
  PRIMARY KEY ("id", "date"),
  CONSTRAINT "Availability_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"(id) ON UPDATE CASCADE ON DELETE RESTRICT
) PARTITION BY RANGE ("date");

-- 3) Aylık bölümler (2026-09 .. 2027-12) + beklenmeyeni tutan DEFAULT bölüm
DO $$
DECLARE
  y INTEGER;
  m INTEGER;
  start_date TEXT;
  end_date   TEXT;
BEGIN
  FOR y IN 2026 .. 2027 LOOP
    FOR m IN 1 .. 12 LOOP
      -- yıl: 2026 ise Eylül(09)..Aralık; 2027 ise Ocak..Aralık
      IF (y = 2026 AND m < 9) OR (y = 2027 AND m > 12) THEN
        CONTINUE;
      END IF;
      start_date := to_char(make_date(y, m, 1), 'YYYY-MM-DD');
      end_date   := to_char((make_date(y, m, 1) + INTERVAL '1 month')::date, 'YYYY-MM-DD');
      EXECUTE format(
        'CREATE TABLE "Availability_%s" PARTITION OF "Availability" ' ||
        'FOR VALUES FROM (%L) TO (%L)',
        to_char(make_date(y, m, 1), 'YYYY_MM'), start_date, end_date
      );
    END LOOP;
  END LOOP;
END $$;

CREATE TABLE "Availability_default" PARTITION OF "Availability" DEFAULT;

-- 4) Aynı isimli secondary indeksler (partition üstünde tanımlı → tüm aylara yayılır)
CREATE UNIQUE INDEX "Availability_roomId_date_key"             ON "Availability" ("roomId", "date");
CREATE INDEX "Availability_date_idx"                           ON "Availability" ("date");
CREATE INDEX "Availability_roomId_isAvailable_date_idx"        ON "Availability" ("roomId", "isAvailable", "date");

-- 5) Veri taşıma (routing ile ilgili aya düşer)
INSERT INTO "Availability"
  (id, "roomId", date, "isAvailable", price, "lockedBy")
SELECT id, "roomId", date, "isAvailable", price, "lockedBy"
FROM "Availability_legacy";

-- 6) Eski tabloyu bırak
DROP TABLE "Availability_legacy";

COMMIT;
