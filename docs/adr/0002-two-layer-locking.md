# ADR 0002 — Çift katmanlı kilit (Redlock + FOR UPDATE + SERIALIZABLE) ve EXCLUDE constraint

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

Aynı odanın aynı gecesi iki misafire satılmamalı. Envanter gece başına `Availability(roomId, date)` satırlarıyla tutulur. Yük altında (son oda için yüzlerce eşzamanlı istek) hem doğruluk hem de veritabanındaki gereksiz çatışmanın azaltılması gerekir.

## Karar

`createBooking` (`src/lib/booking-service.ts`) üç katman kullanır:

1. **Hızlı yol:** kilitsiz bir `count` sorgusu dolu olduğu kesin istekleri erkenden `SOLD_OUT` ile reddeder (yalnızca optimizasyon; sorgu hata verirse atlanır).
2. **Redlock** (`src/lib/distributed-lock/redlock.ts`), anahtar oda başına, TTL 15 sn; monoton **fencing token** geç kalan eski kilit sahibinin yazmasını engeller. Kilit alınamazsa `409 ROOM_BUSY`.
3. **SERIALIZABLE transaction + `SELECT … FOR UPDATE`** gecelik satırlar üzerinde — **yetkili kaynak budur**; Redis kaybolsa bile doğruluk korunur. P2034 serileştirme hataları `withSerializableRetry` (`src/lib/db/transactions.ts`) ile sınırlı sayıda yeniden denenir.

Ek olarak durum geçişleri `status` + `version` koşullu `updateMany` ile yazılır; ödenmeyen `HELD` rezervasyonlar `expire-holds` job'ında `FOR UPDATE SKIP LOCKED` ile toplanır ve envanter iade edilir.

### Neden `EXCLUDE` constraint değil (şimdilik)

PostgreSQL'de `EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&) WHERE (status IN (...))` çakışan rezervasyonları veritabanı seviyesinde imkânsız kılar ve güçlü bir alternatiftir. Tercih edilmedi çünkü:

- Model gecelik envanter satırlarına dayanır (gece bazında fiyat, `lockedBy` ile yield hold ve kanal kilitleri); aralık constraint'i bu modeli ikinci kez ifade etmek demektir.
- `btree_gist` eklentisi ve Prisma şemasının ifade edemediği bir constraint için elle yazılmış migration gerekir.
- Mevcut katmanlar testle kanıtlanmış durumda.

İleride ek savunma katmanı olarak eklenebilir; o durumda Prisma şemasıyla drift oluşacağından ADR 0006'daki manuel migration disiplini uygulanır.

## Kanıt

`tests/integration/booking-core.test.ts`: aynı son oda için 100 paralel istek → tam 1 başarı, 99 `SOLD_OUT`; ardından SQL ile aynı geceye düşen fazladan aktif rezervasyon sayısı = 0. Testcontainers ile gerçek Postgres + Redis üzerinde çalışır.

## Sonuçlar

- Redis düşerse rezervasyonlar `ROOM_BUSY` ile reddedilir (fail-closed) ama veri asla bozulmaz.
- SERIALIZABLE izolasyon yük altında yeniden deneme maliyeti getirir; Redlock bu çatışmaların çoğunu veritabanına ulaşmadan eler.
