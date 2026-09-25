# ADR 0015 — Ajan rezervasyonu (MCP HTTP + ACP), kanal yöneticisi ve gelir paneli

- Durum: Kabul edildi (v3, F7)
- Tarih: 2026-09-25
- İlgili: ADR 0005 (LLM sözleşmesi), ADR 0013 (ödeme sagası), ADR 0016 (fiyat motoru), P1-11, P1-9 (#21), P1-5

## Bağlam

F7 platformu insan dışı istemcilere ve dış kanallara açar: yapay zekâ ajanları MCP üzerinden
arama yapıp rezervasyon tamamlayabilir, ev sahipleri başka kanallardaki takvimlerini içe
aktarır ve gelir panelinden fiyat önerisi alır. Ortak risk, bu yeni yüzeylerin mevcut
güvenceleri (sahiplik, idempotency, saga, deterministik fiyat) atlayan yan kapılara
dönüşmesidir.

## Karar

- **MCP HTTP taşıması kimlik zorunlu ve durumsuz.** `/api/mcp` streamable HTTP üzerinden
  sunulur; her istek bearer erişim belirteci ister (yoksa 401 + `WWW-Authenticate`), ortam
  değişkeninden belirteç yedeği HTTP'de kapalıdır. İstekler "agentic" hız sınırından geçer ve
  sınırlayıcı Redis'e ulaşamazsa kapalı kalır (fail-closed). stdio ve HTTP aynı araç
  tanımlarını (`src/lib/mcp/server.ts`) paylaşır.
- **`ui://stay-card` kaynağı yalnız görüntüdür.** Ajan istemcisi konaklama kartını gösterebilir;
  kart veri döndürür, işlem yapmaz. Yıkıcı araçlar (`cancel_booking`) açık `confirm: true`
  ister.
- **ACP `checkout_sessions` aynı sagayı kullanır.** Oturum oluşturma/güncelleme/tamamlama
  `Idempotency-Key` başlığı olmadan reddedilir; tamamlama insan akışıyla aynı
  `quote → hold → payment` sagasını çalıştırır, sahiplik kontrolü aynıdır (başkasının oturumu
  404). Ajan için ayrı fiyat, vergi veya ödeme yolu yoktur; mock SPT yalnız MockPsp kart
  belirtecine eşlenir.
- **Kanal yöneticisi yalnız takvimi senkronlar, fiyatı dayatmaz.** BullMQ tekrarlı `ical-poll`
  işi ETag / `If-Modified-Since` ile beslemeleri çeker; https zorunlu, SSRF korumalı, boyut ve
  süre sınırlıdır. Dışa açılan besleme belirteci `ChannelFeed.tokenVersion` ile döndürülebilir
  (eski bağlantılar geçersizleşir). Fiyat eşitliği (parity) kontrolü yalnız ev sahibini uyarır.
- **Gelir paneli: motor karar verir, LLM açıklar, ev sahibi onaylar.** Öneri saf bir
  fonksiyondur (`suggestPrice`): doluluk, varışa kalan süre, TR resmî tatilleri ve onaylı
  `DemandEvent`'ler sırayla çarpılır, sonuç `[taban × PRICE_FLOOR_MULTIPLIER, taban ×
PRICE_CEILING_MULTIPLIER]` aralığına kırpılır (fast-check ile kanıtlanır). Her faktörün
  minor-unit katkısı saklanır; katkılar toplamı tam olarak `öneri − taban` eder. LLM yalnız
  Türkçe açıklama cümlesini yazar; sayı guard'ını geçemezse deterministik demo cümlesi
  kullanılır. Kabul fiyatı yazar ve geceyi `priceOverride` ile sabitler — otomatik fiyat
  motoru ve olay yeniden fiyatlaması bu geceleri artık ezmez; ret hiçbir fiyatı değiştirmez.
  Tüm eşikler `getConfig()` (`REVENUE_*`) üzerindedir.

## Sonuçlar

- Ajanlar insanlarla aynı iş kurallarına tabidir; yeni bir ödeme veya fiyat yolu
  eklenmediği için saga, idempotency ve vergi testleri ajan akışını da kapsar.
- HTTP MCP'nin durumsuz olması yatay ölçeklemeyi kolaylaştırır, ancak her istek belirteç
  doğrulaması ve hız sınırı maliyeti taşır.
- iCal çekimi dış sunuculara bağımlıdır; hatalı besleme yalnız o aboneliği etkiler, son
  başarılı durum korunur.
- Sabitlenen geceler otomatik fiyatlamadan çıkar; ev sahibi yeni öneri kabul ederek
  güncelleyebilir. Sabitlemeyi kaldırma arayüzü sonraki bir fazın işidir.
- Dini bayram tarihleri yıllık tablodadır (2026–2027); tablo güncellenmezse yalnız sabit
  tarihli tatiller sinyal verir, öneri yine deterministik kalır.
