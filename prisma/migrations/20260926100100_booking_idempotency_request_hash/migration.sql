-- v4#9: rezervasyon Idempotency-Key'i istek gövdesine bağlanır (eski satırlarda NULL = kontrol yok).
ALTER TABLE "Booking" ADD COLUMN "idempotencyRequestHash" TEXT;
