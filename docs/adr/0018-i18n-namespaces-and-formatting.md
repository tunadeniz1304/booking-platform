# ADR 0018 — i18n: ad alanlı mesajlar, yerel ayara duyarlı biçimleme ve iki dilli e-posta

- Durum: Kabul edildi (v3, F8)
- Tarih: 2026-09-25
- İlgili: P1-12 (#20), ADR 0011 (tesis saat dilimi), ADR 0012 (vergi/FX)

## Bağlam

Arayüz metinleri bileşenlere gömülü Türkçe dizelerdi; `messages/{tr,en}.json` yalnızca gezinme
ve teklif kırılımını kapsıyordu. Para ve tarihler bileşen bileşen `toLocaleString("tr-TR")`
ile biçimleniyordu; e-postalar yalnız Türkçeydi. İngilizce arayüz, aynı anda birden çok
kişinin (ve ajanın) çevirisine açık, çakışmasız bir yapı ve eksik anahtarı CI'da yakalayan bir
denetim gerektiriyordu.

## Karar

- **Mesajlar ad alanlarına bölünür:** `messages/<locale>/<namespace>.json` (24 ad alanı:
  `nav`, `search`, `booking`, `host`, …). `src/i18n/messages.ts` içindeki `NAMESPACES` listesi
  tek doğruluk kaynağıdır; yükleyici her istekte yalnız seçili dilin dosyalarını dinamik içe
  aktarır. URL öneki yoktur; dil `NEXT_LOCALE` çerezinde tutulur, varsayılan `tr`.
- **Parite denetimi zorunludur:** `npm run i18n:check` (ve birim testi) her ad alanında tr/en
  anahtar kümelerinin, ICU yer tutucularının birebir aynı olduğunu ve boş metin olmadığını
  doğrular; diskte olup listede olmayan ad alanı da hatadır.
- **Tek biçimleyici:** `createFormatter(locale)` (`src/lib/i18n/format.ts`) para (integer minor
  unit → `Intl.NumberFormat`, para birimi basamaklarıyla), tarih, saat ve sayıyı biçimler.
  İstemcide `useFormat()`, sunucuda `getFormat()` kullanılır. Yalın tarihler (`YYYY-MM-DD`)
  UTC gece yarısı olarak yorumlanır, böylece tarayıcı saat dilimi bir günü kaydıramaz; tesis
  saatleri açık `timeZone` ile biçimlenir (ADR 0011).
- **Türkçe metin değişmez:** mevcut dizeler bayt bayt korunur (e2e seçicileri Türkçe metne
  dayanır); İngilizce yalnız eklenir.
- **E-postalar iki dillidir:** şablonlar `locale` parametresi alır (varsayılan `tr`); alıcı dili
  `User.locale` sütunundan gönderim anında okunur. Sütun kayıtta ve her başarılı girişte
  `NEXT_LOCALE` çerezinden güncellenir; bilinmeyen değer Türkçeye düşer.
- **Sunucu hata mesajları ve LLM çıktıları Türkçe kalır:** API `message` alanı ve LLM
  açıklamaları bu fazda çevrilmez; istemci bilinen hata kodlarını kendi çevirisiyle gösterir.

## Sonuçlar

- (+) Ad alanları paralel çeviriye çakışmasız açıktır; eksik anahtar derleme yerine CI'da,
  anlaşılır bir mesajla yakalanır.
- (+) Para/tarih biçimi tek yerde; `tr-TR` / `en-US` farkı testlerle sabitlenir.
- (−) Sunucu tarafı doğrulama/iş kuralı hata mesajları İngilizce arayüzde Türkçe görünebilir.
- (−) Dil tercihi yalnız giriş/kayıtta kalıcılaşır; oturum açıkken dil değiştirmek bir sonraki
  girişe kadar e-posta dilini değiştirmez.
