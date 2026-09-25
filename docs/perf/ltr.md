# LTR (learning-to-rank) ve hibrit arama ölçümleri

- Tarih: 2026-09-25 (v3 F5)
- İlgili: [ADR 0014](../adr/0014-hybrid-search-ltr-experiments.md), [ADR 0008](../adr/0008-hash-vs-real-embedding.md)

## Çevrimdışı LTR değerlendirmesi

Veri gerçek kullanıcı günlüğü değil, `scripts/ltr/generate-clicks.ts` ile üretilen **sentetik**
tıklama günlüğüdür (pozisyon yanlılıklı tıklama modeli, gizli "gerçek alaka" üzerinden).
Model LightGBM `lambdarank` ile eğitilip ONNX'e çevrilir (`scripts/ltr/train.py`).

| Ölçü                     | Değer                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| Eğitim / test sorgusu    | 2400 / 600                                                                  |
| Tıklama / rezervasyon    | 4924 / 1267                                                                 |
| Özellikler               | relevance, lexical, vector, trigram, priceFit, rating, popularity, personal |
| nDCG@10 — ağırlıklı (v2) | **0.7343**                                                                  |
| nDCG@10 — LTR            | **0.8130**                                                                  |
| Göreli artış             | **+%10.71**                                                                 |
| `models/ranker.onnx`     | 127 927 bayt (< 5 MB, depoya işlenir)                                       |
| LightGBM                 | 4.7.0                                                                       |

Sonuçlar `models/ranker.meta.json` içinde de saklanır.

## Altın küme (30 sorgu, entegrasyon testi)

`tests/integration/search-golden.test.ts`, `tests/fixtures/search-golden.json` içindeki 40 ilan
ve 30 derecelendirilmiş sorgu ile gerçek PostgreSQL (pgvector + pg_trgm) üzerinde çalışır.

| Yöntem                                     | nDCG@10        |
| ------------------------------------------ | -------------- |
| v2 semantik (eski tokenizer, ağırlık 0.15) | 0.2377         |
| v2 alt dize (`includes`)                   | 0.1040         |
| **v2 taban çizgisi** (ikisinin iyisi)      | 0.2377         |
| **v3 hibrit (RRF)**                        | 0.8733 (+%267) |
| v3 hibrit + LTR kolu                       | 0.9126         |

Kabul ölçütü `hibrit ≥ 1.15 × taban` testte doğrulanır. En zayıf sorgular: "plaja yakın otel"
(0.313), "family hotel kids" (0.552), "beach hotel" (0.596), "göl manzarası" (0.683). Hiçbir
sorgu v2'nin altında değil; "mağara otel" v2 ile eşit (0.917).

**Uyarı (aşırı uyum riski):** eş anlamlı sözlüğü (`src/lib/embedding/synonyms.ts`) altın küme
bilinerek yazıldı; mutlak rakamlar iyimserdir. Gerçek trafikte değerlendirme için deney
(`search-ranking`) dönüşüm sonuçları esas alınmalıdır.

## Çalışma zamanı ve yedek

- `onnxruntime-node` **opsiyonel** bağımlılıktır ve ilk kullanımda tembel yüklenir. Paket veya
  model dosyası yoksa ya da yükleme hata verirse `ltr` kolu ağırlıklı sıralamaya düşer (bir kez
  loglanır); uygulama ve testler modelsiz çalışır.
- **Docker (node:22-alpine, standalone):** `onnxruntime-node` glibc ikilileri musl üzerinde
  çalışmadığı için standalone izlemesinden çıkarılmıştır (`next.config.ts`,
  `outputFileTracingExcludes`). Konteynerde `ranking.ltr` kolu ağırlıklı sıralamayla aynı
  sonucu verir; LTR puanlaması glibc tabanlı ortamlarda (yerel geliştirme, Debian imajı) etkindir.

## Yeniden üretme

```bash
npm run ltr:clicks                 # scripts/ltr/out/clicks.csv (gitignore)
python -m venv .venv && .venv/bin/pip install lightgbm onnxmltools onnx numpy
npm run ltr:train                  # models/ranker.onnx + ranker.meta.json
```

Özellik sırası değişirse `src/lib/search/ltr.ts` içindeki `LTR_FEATURES` ile
`ranker.meta.json` birlikte güncellenmelidir. Model yolu `LTR_MODEL_PATH` ile değiştirilebilir.
