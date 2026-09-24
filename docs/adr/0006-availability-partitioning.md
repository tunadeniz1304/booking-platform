# ADR 0006 — Availability partisyonlama opt-in

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

`Availability` oda × gece satırı içerir ve 365 günlük rollover ile hızla büyür. Aylık `RANGE (date)` partisyonlama tarama alanını daraltır ve arşivlemeyi kolaylaştırır. Ancak PostgreSQL'de partisyon anahtarı her unique ve primary key'e dahil olmak zorundadır.

## Karar

- Partisyonlama **varsayılan kurulumda uygulanmaz**. Manuel betik: `migrations/manual/availability-monthly-partitions.sql` (tabloyu `Availability_legacy` olarak yeniden adlandırır, partisyonlu tabloyu oluşturur, veriyi taşır).
- **PK drift:** betik birincil anahtarı `(id, date)` yapar; Prisma şeması yalnızca `id`'yi PK kabul eder. Uygulama sorguları (`id IN (...)`, `(roomId, date)` unique, `FOR UPDATE`) iki yapıda da çalışır, ancak partisyonlu bir veritabanında `prisma migrate dev` drift raporlar. Bu yüzden betik Prisma migration klasöründe değildir; partisyonlu ortamda yalnızca `prisma migrate deploy` kullanılmalıdır.
- Partisyonlar sabit tarih aralığı yerine `scripts/partitions.ts` (`npm run db:partitions [ay]`) ile ileriye dönük, dinamik oluşturulur; tablo partisyonlu değilse betik hiçbir şey yapmaz.
- **DEFAULT partisyon tuzağı:** eksik ay için satırlar DEFAULT partisyona düşer; DEFAULT o aya ait satır içeriyorsa aynı aralık için yeni partisyon **oluşturulamaz** (PostgreSQL hata verir). Betik DEFAULT doluysa uyarır; önce satırlar taşınmalıdır. Partisyon betiğini gecelik rollover'dan önce çalıştırmak bu durumu önler.

## Sonuçlar

- Varsayılan demo ve testler partisyonsuz ve Prisma şemasıyla birebir.
- Ölçek ihtiyacında geçiş belgelenmiş ve tekrarlanabilir; drift bilinçli ve belgelidir.
