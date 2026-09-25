# ADR 0016 — Legacy fiyat motoru ve pazarlık özelliği

- Durum: Kabul edildi (v3, F1 + F3)
- Tarih: 2026-09-25
- İlgili: ADR 0004 (minor-unit para ve tek quote)

## Bağlam

v2 raporu "tek `computeTotal`" iddiasında bulunuyordu; kodda ise üç ayrı fiyat yolu vardı:

1. `src/lib/pricing/quote.ts` `computeTotal` / `priceStay` — tamsayı minor-unit, vergi dahil.
2. `src/lib/pricing/engine.ts` (legacy "prediktif motor") — float çarpımlar, sabit 0.6–3.0 kırpma,
   sabit doluluk 0.5; `pricing-service` ve canlı ısı haritası kullanıyordu.
3. `/api/negotiate` — istemcinin gönderdiği `round/maxRounds` değerine güvenen, float fiyatla
   karşı teklif üreten ve sonucu hiçbir imzalı teklife bağlamayan pazarlık ucu (v3#8, v3#9).

Pazarlık sonucu rezervasyona taşınamıyordu (checkout yine `computeTotal` kullanıyordu); yani
kullanıcıya gösterilen "kabul edilen fiyat" tahsil edilen fiyat değildi — FTC / Omnibus açısından
yanıltıcı fiyat gösterimi riski.

## Karar

- **Pazarlık özelliği kaldırıldı** (`/api/negotiate`, `src/lib/negotiation/*`, testleri).
  İmzalı teklife bağlamak mümkündü ancak iş değeri düşük, yanıltıcı fiyat riski yüksekti;
  "fiyat pazarlığı" yerine şeffaf fiyat planları (iade edilemez −%10, kahvaltılı) sunuldu
  (ADR 0010).
- **Tek fiyat kaynağı**: arama kartı, PDP, checkout, gRPC `GetRoomAvailability`/`Charge`, MCP
  `get_quote` ve tahsilat aynı `priceStay` fonksiyonunu kullanır. gRPC'deki float `amount/100` ve
  modifier/vergi atlayan tahmini toplam düzeltildi (minor-unit alanlar eklendi, eski alanlar bir
  sürüm korunur).
- **Legacy motor** `event-signals.ts`'e birleştirilir (F3): gecelik taban fiyat yalnızca tek,
  açıklanabilir motorla üretilir; kırpma sınırları `PRICE_FLOOR_MULTIPLIER` /
  `PRICE_CEILING_MULTIPLIER` config'inden gelir, sabit sayı yoktur.

## Sonuçlar

- `NEGOTIATION_MAX_ROUNDS` ayarı kaldırıldı (ölü ayardı, v3#17).
- Fiyat tutarlılığı testleri: arama kartı = PDP = checkout = tahsilat (F3 snapshot testleri).
