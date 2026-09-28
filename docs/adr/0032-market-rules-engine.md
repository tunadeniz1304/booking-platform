# ADR 0032 — Pazar bazlı uyum kural motoru

- Durum: Kabul edildi (v5 P1-7, v5#14)
- Tarih: 2026-09-28
- İlgili: ADR 0012 (vergi motoru), docs/COMPLIANCE.md §8

## Bağlam

İndirim referans penceresi tek bir global ayardı (`PRICE_OMNIBUS_DAYS=30`). TR'de 1 Ağustos 2026'dan
beri "indirimden önceki fiyat" son 10 günün en düşüğüdür; AB Omnibus 30 gündür (v5#14). Kayıt no
biçimi kontrolü de ülke ayrımı yapmadan "TR ya da AB biçimi" kabul ediyordu; ABD FTC ücret kuralı
yalnız dokümanda duruyordu.

## Karar

1. `src/lib/compliance/market-rules.ts` + `data/market-rules.json`: pazar (TR, `@EU`, US) → indirim
   referans penceresi, "önceki fiyat" kuralı (`lowest-in-window` | `previous-price`), kayıt no
   zorunluluğu/şeması/biçimi, toplam fiyat gösterimi. Eşleşme yoksa `default`. Vergi motoruyla aynı
   desen: veri dosyası + `MARKET_RULES_JSON` tamamen değiştirir; geçersizse varsayılan + uyarı.
2. Global `PRICE_OMNIBUS_DAYS` kaldırıldı. Teklif penceresi tesis ülkesinden gelir ve yanıttaki
   `omnibusDays` bunu taşır; fiyat alarmları teklifin penceresini kullanır; fiyat geçmişi saklaması
   en uzun pazar penceresinin (+1) altına inmez.
3. İlan yayın kontrolü (`assertRegistrationFormat`) kayıt noyu pazar biçimine göre reddeder
   (TR ilanında AB biçimi, AB ilanında TR biçimi 400). Pazar biçimi yoksa genel biçim.
4. PDP kayıt noyu pazar şemasının etiketiyle gösterir (TR 7464 izin belgesi / AB 2024/1028 kayıt
   no); toplam fiyat zorunlu pazarlarda "vergi ve zorunlu ücretler dahil" notu.
5. Kayıt no `required=false` (ABD, varsayılan) yalnız yasal zorunluluk olmadığını belirtir; platform
   politikası (v3#25) doğrulanmış belge no olmadan yayını yine engeller.

## Sonuçlar

- Yeni pazar ya da düzeltilen süre kod değişikliği gerektirmez (tek satır JSON).
- `previous-price` motor seviyesinde hazır ama hiçbir pazara atanmadı: kaynağı teyit edilmedi.
- Değerler hukuki danışmanlık değildir; kaynak ve yürürlük tarihleri COMPLIANCE.md §8'de.
