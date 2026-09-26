# ADR 0022 — Görsel zekâ ve çok-modlu arama ("bu fotoğraftaki gibi")

- Durum: Kabul edildi (v4, F6 / P1-10)
- Tarih: 2026-09-26
- İlgili: ADR 0008 (hash-embedding), ADR 0014 (hibrit arama RRF, LTR), [Model kartı §6](../MODEL_CARD.md)

## Bağlam

İlan görselleri yalnız URL listesiydi (`Property.images`); kalite, kopya ve görsel benzerlik
sinyali yoktu. Büyük platformlar host'u bulanık/kopya fotoğraf için uyarır ve "buna benzer"
keşfi sunar. Kısıtlar (booking-v4 §6): internet/model olmadan tam çalışma, ağır bağımlılıklar
opsiyonel + dinamik import, sihirli sayı yok, testler ağa çıkmaz, model karar vermez.

## Karar

1. **Veri modeli:** yeni `PropertyPhoto` (yalnız ekleme): normalize WebP baytı (EXIF/GPS
   silinir, uzun kenar `VISION_MAX_EDGE_PX`), `blurVariance/blurScore/exposureScore/qualityScore`,
   `pHash CHAR(16)`, `duplicateOfId?` (öz-ilişki), `embedding vector(512)?` + HNSW kosinüs
   indeksi. Yüklenen fotoğrafın URL'si (`/api/photos/<id>`) `Property.images`'a eklenir; mevcut
   galeri/kart kodu değişmez.
2. **Yükleme:** `POST /api/host/properties/[id]/photos` (multipart, HOST/ADMIN + sahiplik).
   Hat: normalize → kalite (Laplacian varyansı + histogram, `sharp`) → pHash (kendi 64-bit DCT;
   ek bağımlılık yok) → SQL'de `bit_count(a # b)` ile en yakın Hamming → (bayrak+model varsa)
   CLIP embedding → SERIALIZABLE işlemde kayıt. Duplikat/düşük kalite **engellemez**, yanıtta
   `warnings` + `duplicate.scope` (`SAME_PROPERTY`/`OWN_LISTING`/`OTHER_LISTING`; başkasının
   ilanı sızdırılmaz). `DELETE .../photos/[photoId]` kaldırır.
3. **CLIP:** `@huggingface/transformers` `optionalDependencies`'te, `turbopackIgnore` dinamik
   import, süreç başına tembel tekil. `Xenova/clip-vit-base-patch32` q8 görü kulesi,
   `VISION_MODEL_DIR`'den yerel; `VISION_ALLOW_REMOTE_MODELS=false` iken ağa çıkılmaz. Model
   repoya girmez (`npm run vision:download`, ağ yoksa uyarıyla atlar). Bayrak
   `VISION_CLIP_ENABLED` (varsayılan kapalı).
4. **Arama:** hibrit RRF'ye (ADR 0014) **img** kanalı: `similarToPhotoId` verilirse kaynak
   fotoğrafın embedding'ine kosinüs kNN, mülk başına en iyi fotoğraf, kaynak ilan ve duplikat
   işaretli fotoğraflar hariç, `VISION_MIN_SIMILARITY` altı elenir. Metin sorgusu boşsa yalnız
   bu kanal havuzu belirler; metin varsa lex/vec/trg/phr ile aynı `Σ 1/(k+sıra)` birleşimine
   girer. Sorgu anında model gerekmez (kayıtlı vektörler) — bayrak + pgvector yeterli.
   Yanıt `visual {enabled, applied, reason, message}`; sonuçlar `coverPhotoId` taşır (UI
   "Benzerlerini göster").
5. **Devre dışı davranış:** bayrak kapalı / paket yok / model yok / pgvector yok → özellik
   kapalı, API neden kodu + açıklama, UI i18n metni; kalite skoru ve pHash uyarısı bağımsız
   çalışır. Backfill: `npm run vision:backfill` (eksik skor/pHash, embedder varsa embedding).

## Alternatifler

- **`blockhash-core`**: plan önerisiydi; ek bağımlılık ve kendi görüntü çözümleyicisi gerekir.
  `sharp` zaten hatta olduğundan ~40 satırlık DCT pHash seçildi (yeniden boyutlandırma ve
  sıkıştırmaya dayanıklılığı birim testli).
- **Mülk başına tek ortalama görsel vektör:** sorgu basit ama tek fotoğraf ("bu havuz")
  niyetini kaybeder; fotoğraf düzeyi kNN + mülk başına `max` seçildi.
- **Görsel benzerliği sıralama özelliği olarak eklemek:** LTR özellik kümesini ve eğitim
  verisini değiştirirdi; aday kanalı olarak RRF'ye girmek daha az invaziv.
- **Baytları nesne deposunda tutmak (S3/MinIO):** üretim için doğru yol; portföy/tek düğüm
  kurulumunda ek servis gerektirdiği için Postgres `BYTEA` (normalize ≤1600 px WebP) seçildi.

## Sonuçlar

- (+) Çevrimdışı ve modelsiz kurulumda kalite/duplikat uyarıları çalışır; CLIP yalnız isteğe bağlı.
- (+) RRF'ye kanal eklemek mevcut sıralama/LTR/deney altyapısını değiştirmedi.
- (−) Fotoğraf baytı DB boyutunu büyütür; mülk başına `VISION_MAX_PHOTOS_PER_PROPERTY`.
- (−) Embedding yükleme isteği içinde hesaplanır (CPU ~80 ms/görsel); yüksek hacimde kuyruğa
  (outbox → worker) taşınmalı.
- (−) Seed ilanlarının URL görselleri otomatik içe aktarılmaz; görsel arama yalnız yüklenen
  fotoğraflarda çalışır.
