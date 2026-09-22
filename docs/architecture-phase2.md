# Phase-2 Mimari — Next-Generation Backend

Booking.com'un ötesine geçen, dağıtık ve otonom karar mekanizmalı backend altyapısı.
Aynı monolit içinde modüler (modular monolith) + olay güdümlü (event-driven) mimari;
yük gerektiğinde ayrı servislere ayrışabilecek sınırları (bounded contexts) korur.

## 1. Katman Haritası

```
src/
├─ lib/
│  ├─ cqrs/            # CommandBus / QueryBus / EventBus + Transactional Outbox
│  ├─ saga/            # Saga orkestratörü (booking → payment → confirm)
│  ├─ distributed-lock/# Redlock : milisaniyelik dağıtık kilit + fencing token
│  ├─ search/          # pgvector semantik arama + kişiselleştirme hibrit sıralama
│  ├─ pricing/         # Talep tahmini + dinamik akıllı fiyatlandırma motoru
│  ├─ negotiation/     # Çok-etmenli pazarlık rule-engine
│  ├─ live/            # SSE canlı talep ısı haritası (scarcity)
│  ├─ resilience/      # Circuit Breaker + fallback stratejileri
│  ├─ security/        # IP-spoof koruması, rate-limit hardening, BOLA denetimi
│  ├─ events/          # Domain olay tanımları + handler kayıtları
│  └─ grpc/            # İç servis sözleşmesi (protobuf + istemci)
└─ services/
   └─ grpc-server/     # Bağımsız çalışan gRPC servisi (inventory/booking/payment RPC)
```

## 2. CQRS ve Olay Güdümlü Mimari

- **CommandBus**: yazma niyetlerini tekil handler'a dağıtır; middleware zinciri
  (trace, yetki, doğrulama) komutun etrafında çalışır. Komut = intentif, eşsiz ad (`booking.create`).
- **QueryBus**: salt-okuma read-model sorguları; yan etkisiz. Aynı veri tabanı
  üzerinde ayrı okuma modelleri (search, popular, booking detail) tutulur.
- **EventBus**: aggregate'ten fışkıran değişmez olayları yerleşik subscriber'lara ve
  opsiyonel Redis pub/sub köprüsüne dağıtır (çoklu instance/işçi senkronizasyonu).

### Transactional Outbox (veri tutarlılığı)

Domain değişikliği ile olay yayını atomiktir: iş satırı ile `OutboxMessage` aynı DB
işleminde yazılır. `relayOutbox` hazır mesajları devralır (yalnız-bir-denetçi
garantisiyle), eventBus üzerinden yayınlar, `DONE` işaretler. Başarısız mesajlar
üstel geri-çekme ile yeniden denenir; deneme sayısı aşılınca `FAILED`.

- Garanti: **en-az-bir kere (at-least-once)** yayın + idempotent tüketiciler.
- Bu, dağıtık işlem (2PC) yerine **outbox + idempotent consumer** standardını uygular.

### Saga (booking → payment)

Orchestration tabanlı çok-adımlı süreç:

1. `BookingCreated` (oda kilitle + rezervasyon kaydı)
2. `PaymentCharged` (ödeme yetkilendirmesi)
3. `BookingConfirmed`

Ödeme adımı başarısız olursa tamamlanan adımlar ters sırayla telafi edilir
(`BookingCompensated`: stok serbest bırakılır, rezervasyon CANCELLED). Telafi
yoksa adım yan-etkisiz kabul edilir.

## 3. Dağıtık Kilit (Redlock)

`src/lib/distributed-lock/redlock.ts`:

- Redis `SET key token NX PX ttl` ile edinim → **mutual exclusion**.
- **Fencing token** (monoton artan): eski bir kilit sahibinin geç kalan yazmasını
  engeller (zombi / GC pause koruması).
- Lua script ile **token eşleşmeli serbest bırakma** — yanlışlıkla başkasının kilidini
  silme (A-B-A) problemi önlenir.
- Kilit yenileme (extend) döngüsü: uzun işlemlerde TTL bitmeden kilit dokunulur.
- Aynı oda+tarih için 10.000 eşzamanlı istekte tam olarak bir kazanan.

BookingService, mevcut tek-kilit `SET NX` yerini bu alt sisteme bırakır; ayrıca
bookings akışı outbox'tan `booking.created` olayını yayınlar (fiyat/öneri
güncellemeleri bu olayı dinler).

## 4. AI-Driven Arama (pgvector)

- `pgvector` eklentisi + `Property.embedding vector(128)`.
- Kendi içinde **bag-of-words + TF-IDF** gömme üreteci (title/description/city/amenity
  sözlüğünden deterministik 128-boyutlu vektör) — dış model bağımlılığı yok.
- Sorgu: vektörü oluştur → `<=>` (kosinüs mesafesi) ile benzerlik skoru.
- **Hibrit sıralama**: semantik skor + metin eşleşme + derecelendirme + kullanıcı
  geçmişine ve anlık bağlama bağlı kişiselleştirme ağırlığı eşzamanlı birleşik skor.
- pgvector müsait değilse keyword bazlı sıralamaya **graceful fallback**.

## 5. Talep Tahmini ve Dinamik Akıllı Fiyatlandırma

- `DemandEvent` modeli (yerel etkinlikler/konserler, seed ile dolu).
- Talep sinyali: **occupancy oranı + etkinlik yakınlığı + mevsimsellik + lead-time**.
- Türetilmiş talep patlaması fiyat çarpanını yükseltir; düşük talep çarpanı düşürür.
- Fiyat her zaman `zemin fiyat × çarpanlar` içinde kalır (kullanıcı dostu, kelepçe).
- Rezervasyonlar ve etkinlikler gibi olaylar outbox'tan gelir → fiyat güncelleme işleri
  BullMQ kuyruğuna girer.

## 6. Çok-Etmenli Pazarlık (Rule-Engine)

`src/lib/negotiation/`:

- Kullanıcı bütçe + esneklik verir; sistem reel kurallara göre karşı-teklif üretir.
- Kurallar: marj zemini, occupancy bazlı indirim, esneklik ödülü, dönem farkı.
- Amaç: sistemin asla minimum marjın altına düşmemesi ama kapasiteyi doldurması.
- `POST /api/negotiation` — ikili görüşme; her teklif adımı kaydedilir.

## 7. Gerçek Zamanlı Canlı Talep (SSE)

`src/lib/live/`:

- `GET /api/rooms/[roomId]/live` — Server-Sent Events (SSE) akışı.
- Talep ısı haritası: oda oda canlı ziyaret/kilit/rezervasyon sayısı periyodik yayın.
- Redis pub/sub üzerinden işçilerden güncellenir; istemciye 2-5 sn'de bir kalp atışı.

## 8. Circuit Breaker (Resilience)

`src/lib/resilience/circuit-breaker.ts`:

- Durumlar: `CLOSED → OPEN → HALF_OPEN → CLOSED`.
- Arıza eşiği ve sıfırlanma zaman aşımı yapılandırılabilir; HALF_OPEN'da sınırlı deneme.
- Tüm dış aramalar (Redis, Elasticsearch, gRPC istemcisi) breaker üzerinden çağrılır;
  **fallback** fonksiyonu ile degrade (ör. cache yoksa DB'den, DB yoksa son bilinen).

## 9. Güvenlik (The Breaker)

- **IP-spoof koruması**: `x-forwarded-for` zinciri yalnız güvenilir proxy eşiğinde kabul
  edilir; doğrulanamazsa düşürülür (spoofed chain yoksayılır).
- **Rate-limiting**: kimlik bazlı (kullanıcı + yol) token-bucket; dağıtık Redis sürümü,
  tek-instance belleği fallback.
- **BOLA (IDOR)**: tüm kaynak okuma/yazma işlemleri sahiplik denetiminden geçer
  (booking PAY: `userId` eşleşmesi zorunlu).
- **Race-Condition**: kilit + sarıcı transaction `SERIALIZABLE` + `FOR UPDATE`.

## 10. gRPC / Protobuf (İç servis sözleşmesi)

`proto/booking.proto` + bağımsız `services/grpc-server` (Node, `@grpc/grpc-js`):

- `InventoryService.GetRoomAvailability`, `BookingService.ReserveRoom`,
  `PaymentService.Charge`.
- Next.js Edge/middleware yığınına girmemesi için ayrı süreç; üretimde dahili
  servis-arası iletişim protokolü olarak kullanılabilir (REST köprüsü mevcut).
- gRPC sunucusuna bağlanan iç istemci `src/lib/grpc/client.ts` — breaker ile sarılır.

## 11. Veri Tabanı

- PostgreSQL 16, `transaction` + `pg_trgm` (fuzzy) eklentileri.
- Outbox tablosu üretimde sırt çıkarılmaz; biriktirme SAGA/outbox ile beslenir.
- Bölümlendirme (partitioning) önerisi: `Booking` ve `OutboxMessage` zaman dilimli
  bölümlerle ölçeklendirilebilir — varsayılan kurulumda emekleme aşaması yok, olgunlaştıkça eklenir.
