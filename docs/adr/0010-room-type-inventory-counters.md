# ADR 0010 — Oda tipi envanteri ve koşullu sayaç (InventoryDay)

- Durum: Kabul edildi (v3, F2)
- Tarih: 2026-09-25
- İlgili: ADR 0002 (çift katmanlı kilit) — genişletir; ADR 0006 (partisyonlama) — yerini alır

## Bağlam

v2'de envanter "tek oda = tek birim" idi: `Availability(roomId, date, isAvailable, lockedBy)`.
Gerçek OTA'larda (Booking.com, Expedia, kanal yöneticileri) satış birimi **oda tipidir**
("Standart Çift, 12 adet"); fiyat **rate plan**'la (kahvaltılı, iade edilemez…) çeşitlenir ve
**kısıtlar** (min/max konaklama, varışa/ayrılışa kapalı, satış durdurma) gece bazında uygulanır.
Boolean model bunların hiçbirini ifade edemez ve 12 odalı bir otel için 12 ayrı "oda" kaydı
gerektirir.

## Karar

1. `Room` → **`RoomType { units, maxOccupancy, … }`** (tablo yeniden adlandırılır; API'deki
   `roomId` alanı bir sürüm boyunca "oda tipi kimliği" anlamında korunur — geriye uyum).
2. `Availability` → **`InventoryDay { roomTypeId, date, total, sold, held, price }`** ve
   veritabanı kısıtı:
   ```sql
   CHECK (sold >= 0 AND held >= 0 AND sold + held <= total)
   ```
3. **Koşullu sayaç** — tutma (hold) tek SQL ifadesidir:
   ```sql
   UPDATE "InventoryDay" SET held = held + $units
   WHERE "roomTypeId" = $1 AND date >= $2 AND date < $3
     AND sold + held + $units <= total
   ```
   Etkilenen satır sayısı gece sayısına eşit değilse işlem geri alınır (`SOLD_OUT`).
   Durum geçişleri sayaçları aynı işlemde taşır: HOLD `held+`, CONFIRM `held− sold+`,
   EXPIRE/iptal(HELD) `held−`, iptal(CONFIRMED) `sold−`. Geçişin kendisi `status + version`
   koşulludur; bu yüzden sayaç hareketi rezervasyon başına tam bir kez olur (`lockedBy` gerekmez).
4. **Rate plan** (`RatePlan { mealPlan, refundable, cancellationPolicyId, priceModifierBps }`) gece
   fiyatına baz puan (bps) farkı uygular; iade edilemez plan NON_REFUNDABLE politikasını dayatır.
5. **Kısıtlar** (`Restriction { date, minStay, maxStay, closedToArrival, closedToDeparture,
stopSell }`) quote ve hold sırasında deterministik olarak doğrulanır (`restrictions.ts`).
6. iCal ile gelen **harici bloklar** başka kanalda satılmış birimlerdir: `ExternalBlock` satırı
   olarak izlenir ve `sold`'u artırır; kaynak takvimden kalkınca uzlaştırma `sold`'u azaltır.
7. Redlock (oda tipi başına) ve SERIALIZABLE korunur (ADR 0002): Redis çatışmaları eler,
   veritabanı kısıtı ve koşullu güncelleme yetkili kaynaktır.

## Sonuçlar

- Overbooking veritabanı düzeyinde imkânsız: CHECK kısıtı son savunma hattıdır; en kötü
  durumda işlem hata verir, asla fazla satış yazılmaz.
- `units=3` bir oda tipine 100 paralel istek → tam 3 başarı (entegrasyon testi); fast-check
  özelliği rastgele hold/iptal/expire dizilerinde `sold + held ≤ total` değişmezini doğrular.
- ADR 0006'daki `Availability` partisyon betiği Prisma şemasından sapmıştı; kaldırıldı.
  Veri büyümesi `INVENTORY_RETENTION_DAYS` ile geçmiş günlerin budanmasıyla yönetilir
  (P0-11); partisyonlama gerekirse yeniden ve migration olarak eklenir.
- Kırıcı değişiklik riski: host API'si hâlâ `capacity` kabul eder (`maxOccupancy`'ye eşlenir).
