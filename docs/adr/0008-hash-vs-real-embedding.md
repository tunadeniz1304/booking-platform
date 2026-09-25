# ADR 0008 — Hash-embedding ve gerçek embedding

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

`Property.embedding vector(128)` kolonu pgvector ile benzerlik araması için kullanılıyor. Mevcut "embedding" 128 boyutlu feature-hashing bag-of-words (FNV-1a): bir ML modeli değil, sözcük örtüşmesine dayanan ucuz bir yaklaşım. Gerçek bir embedding modeli daha iyi anlamsal benzerlik verir ama anahtar ve ağ gerektirir. Ayrıca yeni mülkler için embedding hiç üretilmiyordu (hata #22).

## Karar

- `src/lib/embedding/provider.ts` içinde takılabilir `Embedder` arayüzü: `{ name, dim, embed(texts) }`.
  - `HashEmbedder` (`hash-fnv1a-128`) — varsayılan, ağsız, deterministik.
  - `OpenAIEmbedder` — `EMBEDDING_MODEL` tanımlı **ve** LLM etkin modu canlıysa; OpenAI-uyumlu `/embeddings` ucu **`dimensions: 128`** ile çağrılır, böylece mevcut `vector(128)` kolonu migration olmadan kullanılır. Boyut uyuşmazlığı veya hata → hash'e düşer (loglanır).
- `PropertyCreated` outbox olayı worker'da embedding yazar.
- Sağlayıcı değişince tüm vektörler `npm run embeddings:backfill` ile yeniden üretilir (idempotent); iki farklı vektör uzayı karıştırılmaz.
- Dokümantasyon ve arayüz metinleri hash yaklaşımını "yapay zekâ ile anlamsal arama" olarak sunmaz.

## Değerlendirilen alternatif

Farklı boyutlu bir model için ayrı `embeddingV2 vector(n)` kolonu. `dimensions` parametresini destekleyen modellerle gereksiz olduğu için ertelendi; desteklemeyen bir model seçilirse bu yol migration ile açılır.

## Sonuçlar

- Anahtarsız ortamda davranış değişmez; testler deterministiktir.
- Hash yaklaşımı eş anlamlıları kendiliğinden yakalamaz; sorgusuz sıralamada semantik bileşenin ağırlığı düşük tutulur (0.15, bkz. [METHODOLOGY](../METHODOLOGY.md)).

## Güncelleme — v3 F5 (2026-09-25)

- `HashEmbedder` artık `src/lib/embedding/synonyms.ts` ile genişletilir: Türkçe/İngilizce eş anlamlı kümeleri ve hafif kök bulma (ek kırpma). Türkçe harf katlama tutarlı hale getirildi (`foldToken`; eski NFKD + noktalama silme adımı aksanları rastgele biçimde bırakıyordu); sağlayıcı adı `hash-fnv1a-128-syn` oldu, bu yüzden mevcut vektörler `npm run embeddings:backfill` ile yeniden üretilmelidir.
- Hâlâ bir ML modeli değildir; sözlük el yapımıdır ve altın küme bilinerek yazıldığı için aşırı uyum riski taşır (bkz. [ADR 0014](0014-hybrid-search-ltr-experiments.md)).
- Semantik skor artık hibrit RRF füzyonundan gelir (sözcüksel + vektör + trigram); sorgu varken ağırlığı 0.6'dır (`RANKING_WEIGHTS_WITH_QUERY`). Sorgusuz sıralamada 0.15 korunur.
