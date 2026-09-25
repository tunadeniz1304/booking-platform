# ADR 0014 — Hibrit arama (RRF), LTR ve OpenFeature deneyleri

- Durum: Kabul edildi (v3, F5)
- Tarih: 2026-09-25
- İlgili: ADR 0003 (transactional outbox), ADR 0008 (hash-embedding), [LTR ölçümleri](../perf/ltr.md)

## Bağlam

v2 araması serbest metni tüm sorgu dizesinin başlık/açıklama/şehirde `includes` ile geçip
geçmediğine bakıyor, semantik bileşen yalnız 0.15 ağırlıkla sıralamaya katılıyordu. Kök
eklemeleri ("plaja", "evleri"), yazım hataları ("Bodrm") ve eş anlamlılar ("şömine" / "ocak")
kaçıyordu (v3#19). Sıralama elle ayarlı ağırlıklarla yapılıyor, değişikliklerin etkisi
ölçülmüyordu.

## Karar

### Hibrit geri getirme (P1-1)

- `Property.searchVector` üretilmiş `tsvector` kolonu (başlık A, açıklama B; `simple` **ve**
  `turkish` yapılandırmaları) + GIN indeksi.
- `src/lib/search/hybrid.ts` tek SQL sorgusunda üç kanal çalıştırır:
  - **lex:** `searchVector` + konum metni, `to_tsquery(simple) || to_tsquery(turkish)`
    (önek eşleşmeli), `ts_rank_cd` ile sıralı.
  - **vec:** pgvector kosinüs benzerliği, `SEARCH_HYBRID_MIN_SIMILARITY` altı elenir.
  - **trg:** `pg_trgm` `word_similarity`, eşik `SEARCH_HYBRID_MIN_TRGM` (0.45). Yalnız **harf**
    sözcükleri kullanılır: rakam dizileri (kod, yıl, test damgası) ortak trigramlar yüzünden
    alakasız şehirlerle sahte eşleşiyordu.
  - **phr:** sorgunun tamamı başlık/açıklama/şehirde geçiyorsa (v2 alt dize anlamı) sıra 1.
    RRF sıra tabanlı olduğundan kanallar arası farkı sıkıştırır; bu kanal olmadan tam ilan
    adıyla yapılan arama, ortak sözcüklü ilanlar arasında fiyat/puana göre kayboluyordu.
- Kanallar **Reciprocal Rank Fusion** ile birleşir: `skor = Σ 1/(k + sıra)`,
  `k = SEARCH_RRF_K` (60). Aday sayısı `SEARCH_HYBRID_CANDIDATES`.
- Yapısal filtreler (şehir, ülke, tür; Smart Filter çıktısı dahil) kanallardan **önce**
  uygulanır; Smart Filter yalnız yapısal filtre üretir, sıralamaya karar vermez.
- RRF skoru sıralamada `semantic` bileşeni olur; sorgu varken ağırlığı 0.6
  (`RANKING_WEIGHTS_WITH_QUERY`), sorgusuz sıralama v2 ağırlıklarını korur.
- Tam eşleşme artık tek sonuç değil ilk sonuçtur: hibrit arama filtre değil sıralama yapar.
- Yedek: hibrit SQL hata verirse v2 alt dize araması; pgvector yoksa vektör kanalı boş kalır.

### LTR (P1-2)

- `scripts/ltr/generate-clicks.ts` sentetik, pozisyon yanlılıklı tıklama günlüğü üretir;
  `scripts/ltr/train.py` LightGBM `lambdarank` eğitip `models/ranker.onnx` (≈128 KB) yazar.
- `src/lib/search/ltr.ts` `onnxruntime-node`'u (opsiyonel bağımlılık) ilk kullanımda tembel
  yükler. Paket/model yoksa veya çıkarım hata verirse ağırlıklı sıralamaya düşer.
- Alpine/standalone Docker imajında paket izlemeden çıkarılır (musl uyumsuzluğu); orada LTR
  kolu ağırlıklı sıralamaya eşdeğerdir. Bu bilinçli bir sınırlamadır.

### Deneyler (P1-3)

- Resmî OpenFeature sunucu SDK'sı, süreç içi `InMemoryProvider`; bayraklar
  `config/flags.json` içinde (zod ile doğrulanır). Dış servis yok.
- Kova: `murmurhash3("flagKey:subject") mod 10000`, varyant yüzdeleriyle eşlenir → aynı özne
  daima aynı kol. Özne: giriş yapmış kullanıcı id'si, yoksa **analitik onayı varsa** `exp_sid`
  oturum çerezi (`EXPERIMENT_COOKIE_DAYS`). Özne yoksa deney dışı, ağırlıklı sıralama.
- İlk deney `search-ranking`: `ranking.weighted` / `ranking.ltr`, yalnız "önerilen" sıralamada.
  Bayrak kapalı (`enabled: false`) → varsayılan `ranking.weighted`, maruziyet yazılmaz; v2
  sıralama davranışı.
- Maruziyet (özne × bayrak başına bir kez) `ExperimentExposure` tablosuna ve aynı işlemde
  outbox'a `experiment.exposure` olarak yazılır. Kayıt hatası aramayı düşürmez.
- `/admin` deney kartı kol başına maruziyet, kullanıcı, dönüşüm ve %95 **Wilson** aralığı
  gösterir (`GET /api/admin/experiments`). Dönüşüm: maruziyetten **sonra** oluşturulmuş
  CONFIRMED/COMPLETED rezervasyon; payda yalnız kimliği bilinen kullanıcılardır (anonim
  oturumlar rezervasyona bağlanamaz).

## Değerlendirilen alternatifler

- **Ağırlıklı skor toplamı (lineer füzyon):** kanal skorları farklı ölçeklerde; normalizasyon
  kırılgan. RRF yalnız sıraya bakar, ayarsız çalışır.
- **Harici arama motoru (OpenSearch/Meilisearch):** ek altyapı ve senkronizasyon; mevcut
  ölçekte PostgreSQL yeterli.
- **Barındırılan bayrak servisi (LaunchDarkly, flagd):** çevrimdışı çalışma kuralına aykırı;
  OpenFeature arayüzü sayesinde sağlayıcı sonradan değiştirilebilir.

## Sonuçlar

- 30 sorguluk altın kümede nDCG@10: v2 taban 0.2377 → hibrit 0.8733, LTR kolu 0.9126
  (`regression: v3#19` testleri). Eş anlamlı sözlüğü küme bilinerek yazıldığından rakamlar
  iyimserdir; gerçek etki deney dönüşümüyle izlenir.
- Çevrimdışı LTR: 0.7343 → 0.8130 (+%10.7), sentetik veride.
- Yeni ayarlar: `SEARCH_RRF_K`, `SEARCH_HYBRID_CANDIDATES`, `SEARCH_HYBRID_MIN_SIMILARITY`,
  `SEARCH_HYBRID_MIN_TRGM`, `LTR_MODEL_PATH`, `EXPERIMENT_COOKIE_DAYS`.
- Embedding sağlayıcı adı değişti (`hash-fnv1a-128-syn`); `npm run embeddings:backfill`
  gerekir (ADR 0008).
