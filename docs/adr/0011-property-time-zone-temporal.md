# ADR 0011 — Tesis saat dilimi ve Temporal

- Durum: Kabul edildi (v3, F2)
- Tarih: 2026-09-25

## Bağlam

v2 tüm tarih mantığını UTC ile yapıyordu: giriş saati global `CHECKIN_HOUR_UTC=12`
(İstanbul için 15:00 doğru, Tokyo için 21:00, New York için 08:00 — yanlış iade pencereleri),
"giriş geçmişte olamaz" kontrolü UTC bugüne göre, iCal içe aktarma yerel saat getter'ları
(`getFullYear`/`getMonth` → sunucunun saat dilimine bağımlı) ve devir kesim saati UTC gece
yarısı. Tokyo'da UTC gün sınırı yerel saatle 09:00'dır; New York'ta yaz saati geçişlerinde bir
"gün" 23 veya 25 saattir.

## Karar

- `Property.timeZone` (IANA, ör. `Europe/Istanbul`, `Asia/Tokyo`, `America/New_York`),
  `checkInTime` (`"15:00"`) ve `checkOutTime` (`"11:00"`).
- Konaklama geceleri takvim tarihi (`YYYY-MM-DD`, `IsoDate`) olarak kalır — bir gece **tesisin
  yerel** takvim günüdür; veritabanında `@db.Date`.
- Anlık zaman gerektiren her hesap `@js-temporal/polyfill` ile tesis saat diliminde yapılır
  (`src/lib/time/nights.ts`):
  - `todayIn(tz, now)` — "geçmiş tarih" kontrolü tesisin bugününe göre,
  - `checkInInstant(date, tz, "15:00")` / `checkOutInstant(...)` — iade penceresi, devir
    kesimi, `complete-stays` (checkout sonrası COMPLETED),
  - iCal: `DATE` değerleri takvim günü olarak, `DATE-TIME` (UTC veya `TZID`) değerleri tesisin
    saat diliminde takvim gününe çevrilir.
- DST güvenliği: süre hesabı `ZonedDateTime` farkıyla (saat cinsinden gerçek geçen süre)
  yapılır; "gün ekleme" takvim aritmetiğidir.

## Neden Temporal (date-fns-tz değil)

Temporal, TC39 standart önerisidir (Stage 3); `ZonedDateTime` DST belirsizliğini
(`disambiguation: "compatible"`) açıkça modeller ve tarih/zaman/saat dilimi kavramlarını tip
düzeyinde ayırır. Polyfill yalnızca sunucu tarafında kullanılır; yerel `Temporal` geldiğinde
tek import değişikliğiyle kaldırılabilir.

## Sonuçlar

- DST testleri (America/New_York Mart/Kasım) ve Tokyo UTC gün sınırı testleri eklendi.
- `CHECKIN_HOUR_UTC` kaldırıldı; seed'de her lokasyonun gerçek saat dilimi vardır.
