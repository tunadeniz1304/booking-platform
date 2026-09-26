-- fix-sweep-2: kaybedilen itirazda ev sahibinden tahsil edilemeyen kısım için platform zararı
-- (gider, borç-doğal) hesabı `platform_loss`. Hesap satırı ilk kullanımda uygulama tarafından
-- açılır (PG: ADD VALUE ile eklenen değer aynı işlemde kullanılamaz).
ALTER TYPE "LedgerAccountKind" ADD VALUE 'PLATFORM_LOSS';
