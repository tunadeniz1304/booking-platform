# ADR 0030 — LLM eval paketi ve GenAI telemetrisi

- Durum: Kabul edildi (v5 P1-5)
- Tarih: 2026-09-28
- İlgili: ADR 0005 (LLM sözleşmesi), ADR 0029 (destek ajanı)

## Bağlam

LLM sözleşmesi birim testleriyle korunuyordu ama görev düzeyinde (şema + grounding + KVKK + dil +
injection) tekrarlanabilir bir kalite ölçümü ve CI kapısı yoktu. Ayrıca LLM çağrıları yalnız
Prometheus metrikleri ve log satırıyla izleniyordu; dağıtık izlerde (Tempo) çıkarım adımı
görünmüyordu.

## Karar

### Eval

1. **promptfoo 0.123.1** (MIT, geliştirme bağımlılığı; Node ≥ 22.22 — CI Node 22'nin güncel
   yaması). Lisans taraması: yeni ağaçta AGPL yok (node-forge "BSD-3-Clause OR GPL-2.0" çift
   lisans, BSD seçilir). `npm audit --audit-level=high` temiz. Çalışma zamanı imajına girmez
   (`npm ci --omit=dev`). Kurulum yerelde sorunsuz oldu; vitest tabanlı yedek koşucuya gerek
   kalmadı — yine de aynı vakalar/iddialar `tests/unit/evals/llm-eval.test.ts`'te süreç içi koşar
   (promptfoo bozulursa kapı tamamen kaybolmaz).
2. **Sağlayıcı = uygulama:** `evals/provider.ts` promptfoo prompt'unu kullanmaz, vaka kimliğiyle
   uygulamanın saf LLM çekirdeklerini çağırır. Bunun için üç görev DB'den ayrıldı (davranış
   korunarak): `generateReviewSummary`, `generateHostReplyDraft`, `narrateTripPlan`. Destek ajanı
   bellek-içi `SupportRepo` ile koşar. Canlı mod aynı prompt'ları gerçek modele gönderir.
3. **Modlar:** `npm run llm:eval` → `LLM_MODE=demo` (ağsız; promptfoo telemetri/güncelleme/paylaşım
   kapalı, `--no-write --no-cache`); `npm run llm:eval -- --live` yalnız yerel (`CI` tanımlıysa
   reddedilir). Anahtar uygulamanın kendi `.env` yükleyicisiyle okunur; koşucu değer görmez.
4. **İddialar:** şema, sayı grounding'i, PII yok, dil, red-team (bkz. METHODOLOGY §12). Geçme
   eşiği `LLM_EVAL_MIN_PASS_RATE` (0.95) — altı çıkış 1 (CI kırmızı).
5. **`llm_eval_score{task,mode}`** göstergesi: koşucu `LLM_EVAL_SUMMARY_PATH` özetini yazar;
   `/api/metrics` her kazımada dosyayı okur (yoksa gösterge boş). Push-gateway yerine dosya: tek
   süreçli demo kurulumunda ek servis gerektirmez; CI'da üretilen değer artefakt olarak
   kalmaz (kasıtlı — CI kapısı çıkış kodudur).

### Telemetri

6. `src/lib/llm/telemetry.ts` + `client.ts`: her SDK isteği (JSON modu geri çekilmesi dahil tek
   mantıksal istek) `chat <model>` CLIENT span'i içinde çalışır. **Semconv sürümü sabit:
   OpenTelemetry GenAI semantic conventions v1.37.0** (statü "Development"); öznitelikler
   `gen_ai.operation.name` (`chat`), `gen_ai.provider.name` (`openai` — OpenAI-uyumlu API; demo
   için `booking.demo`), `gen_ai.request.model`, `gen_ai.request.temperature`,
   `gen_ai.request.max_tokens`, `gen_ai.response.model`, `gen_ai.response.finish_reasons`,
   `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `server.address`, `error.type`;
   uygulamaya özgü `booking.llm.task`, `booking.llm.mode`. Sürüm yükseltmesi bu ADR güncellenerek
   yapılır (1.37'de `gen_ai.system` → `gen_ai.provider.name` yeniden adlandırması gibi kırılımlar
   nedeniyle).
7. **İçerik yakalama:** `gen_ai.input.messages` / `gen_ai.output.messages` yalnız
   `LLM_OTEL_CAPTURE_CONTENT=true` iken yazılır; girdi zaten `Redactor`'dan geçmiştir, span'e
   yazmadan önce `redactText` bir kez daha uygulanır. Varsayılan kapalı; test: kapalıyken prompt
   metni hiçbir öznitelikte yok.
8. Tracer her çağrıda global sağlayıcıdan alınır (izleme sonradan kaydedilse de span akar);
   izleme yoksa API no-op'tur.

## Tempo'da görüntüleme

1. `docker compose --profile observability up -d` (Prometheus/Grafana/Tempo).
2. `.env`'de `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318` (yerel geliştirmede
   `http://localhost:4318`); uygulamayı yeniden başlat.
3. Bir AI ucu çağır (ör. `/support` sayfasında soru sor veya `POST /api/search/smart`).
4. Grafana → Explore → Tempo → TraceQL: `{ span.gen_ai.operation.name = "chat" }` veya
   `{ span.booking.llm.task = "support_agent" }`. Span, HTTP kök span'inin çocuğu olarak model,
   token ve bitiş nedenleriyle görünür. (Ekran görüntüsü F8 kapsamında docs'a eklenecek.)

## Sonuçlar

- (+) CI her PR'da LLM sözleşmesini görev düzeyinde ölçer; demo koşusu ~10 sn, ağsız.
- (+) Tempo'da çıkarım gecikmesi ve token kullanımı iz bağlamında görünür, içerik varsayılan gizli.
- (−) promptfoo büyük bir geliştirme ağacı (~600 paket) ekler; `package-lock.json` büyür.
- (−) Demo skoru modelin değil guard/şablon zincirinin doğruluğudur; canlı kalite yalnız yerel
  `--live` koşusuyla ölçülür.
