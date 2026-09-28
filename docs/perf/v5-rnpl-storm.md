# v5 P2-3 — RNPL tahsilat fırtınası (aynı anda vadesi gelen ~1000 tahsilat)

Tarih: 2026-09-28 · k6 (`grafana/k6`) · yük yığını (`docker-compose.load.yml`, MockPsp, worker
`rnpl` kuyruğu varsayılan eşzamanlılık = 1). İlgili: [sepet](v5-cart.md) · [kaos](v5-chaos.md)

## Yöntem

1. **Tohumlama (gerçek API yolu)** — `load/rnpl-charge-storm.js MODE=seed`: 20 VU, 120 hesap;
   her yineleme yük otelinde 1 gecelik rezervasyon + `/pay` `paymentOption: "rnpl"` (kart
   kaydedilir, rezervasyon CONFIRMED, ödeme PENDING, `PaymentSchedule` SCHEDULED, vadeye
   gecikmeli `rnpl-charge` işi). Her rezervasyon farklı mock kart son-4'ü kullanır (tek kartla
   `FRAUD_VELOCITY_CARD_MAX` dolar ve RNPL yalnız risk `allow` iken sunulur — ilk denemede 295
   rezervasyon bu yüzden `RNPL_UNAVAILABLE {reason: RISK}` aldı).
2. **Fırtına** — `scripts/rnpl-storm.ts trigger`: yük otelindeki tüm açık planların vadesini
   "şimdi"ye çeker ve gecikmeli işlerin hepsini **aynı anda** öne alır (`job.promote()`).
3. **Yarış** — `MODE=race` (fırtınayla eşzamanlı): misafirler tohumlanan rezervasyonların
   %15'ini iptal eder (ücretsiz iptal ↔ tahsilat; ikisi ödeme kilidiyle sıralanır).
4. **Doğrulama** — `scripts/rnpl-storm.ts verify` (boşalma süresi, dağılım, fırtına değişmezleri)
   - `scripts/load-assert.ts` (yeni RNPL denetimleri dahil).

```sh
docker run --rm -v "<repo>/load:/load:ro" --network booking-load_default -e BASE_URL=http://caddy:80 \
  -e LOAD_ACCOUNTS=120 -e LOAD_ROOMS=<seed-load> -e N=1060 -e VUS=20 grafana/k6 run /load/rnpl-charge-storm.js
# yarış: k6 setup'ı ("aday" satırı) bitince tetikle
docker run ... -e MODE=race -e CANCEL_RATIO=0.15 -e CREATED_AFTER=<tohum başlangıcı> \
  -e RACE_DELAY_S=5 -e RACE_PACE_S=3 grafana/k6 run /load/rnpl-charge-storm.js &
docker compose -p booking-load exec -T worker sh /usr/local/bin/entrypoint.sh \
  npx tsx --conditions=react-server scripts/rnpl-storm.ts trigger
docker compose ... scripts/rnpl-storm.ts verify && docker compose ... scripts/load-assert.ts
```

## Sonuçlar

Tohumlama: `/pay` (RNPL) p95 0.87–1.27 s, 5xx 0.

| Koşum                                 | Tetiklenen | Boşalma |   Verim | Tahsilat gecikmesi (tetiklemeden) p50 / p95 / maks | Sonuç                                                                                                                | İhlal |
| ------------------------------------- | ---------: | ------: | ------: | -------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------- | ----: |
| 1 — iptaller fırtınadan **sonra**     |        923 |  21.8 s | 42.3 /s |                           11.1 s / 20.8 s / 21.8 s | 923 CAPTURED; sonradan 90 iptal → 90 **REFUNDED**                                                                    |     0 |
| 2 — iptaller fırtınadan **önce**      |        856 |  22.5 s | 38.1 /s |                           11.3 s / 21.4 s / 22.5 s | 856 CAPTURED (138 plan tetiklemeden önce iptal → CANCELLED, tahsilat yok)                                            |     0 |
| 3 — iptaller fırtınayla **eşzamanlı** |  **1 006** |  22.4 s | 44.8 /s |                           11.2 s / 21.4 s / 22.4 s | 860 CAPTURED/PAID · 94 iptal tahsilattan önce → plan CANCELLED, ödeme VOIDED · 52 iptal tahsilattan sonra → REFUNDED | **0** |

- İptal uç noktası 5xx 0 (koşum 3: 146 × 200, p95 87 ms).
- Fırtınaya özgü değişmezler (koşum 3): tahsil edilip iptal edilmiş ama iade edilmemiş ödeme
  **0**, CANCELLED planda PAID ödeme **0**, açık (SCHEDULED) plan **0**.
- `scripts/load-assert.ts` (tüm koşumlar sonrası): aşırı satış 0/0 · mizan dengeli · mutabakat
  5 504 kontrol / 0 fark · çift capture 0 · RNPL `rnplCapturedNotPaid` 0,
  `rnplCapturedJournalMismatch` 0 (her CAPTURED plan için tam bir `BOOKING_CAPTURED` jurnali),
  `rnplChargedOnCancelled` 0.

## Analiz

- Tek worker, kuyruk eşzamanlılığı 1: ~1000 tahsilat ~22 s'de (~23 ms/tahsilat: kilit + PSP +
  SERIALIZABLE onay işlemi) boşaldı. Tahsilat vadeden ücretsiz iptal bitimine kadar
  `RNPL_CHARGE_DAYS_BEFORE_DEADLINE` (2 gün) pay olduğu için bu gecikme iş açısından önemsiz;
  gerçek PSP gecikmesiyle (~300–800 ms) aynı fırtına tek worker'da ~5–13 dk sürer — yine pay
  içinde. Gerekirse `rnpl` Worker'ına eşzamanlılık ayarı eklenebilir (ödeme kilidi rezervasyon
  başına olduğundan paralel tahsilat güvenli); bu turda ihtiyaç gösterilmedi.
- Yarış güvenli: iptal ve tahsilat aynı `withPaymentLock(bookingId)` altında sıralanır; kilidi
  önce alan kazanır, diğeri durumu yeniden okur (tahsilat iptal edilmiş planı `noop`/CANCELLED,
  iptal tahsil edilmiş ödemeyi iade yolundan geçirir).
