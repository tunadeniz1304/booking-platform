# ADR 0029 — AI destek ajanı ve insana devir

- Durum: Kabul edildi (v5 P1-4)
- Tarih: 2026-09-28
- İlgili: ADR 0005 (LLM sözleşmesi), ADR 0017 (mesajlaşma/moderasyon), ADR 0030 (eval + telemetri)

## Bağlam

Sektör liderleri (Booking.com AI Trip Planner/destek, Airbnb AI müşteri hizmetleri) misafir
sorularının büyük kısmını bir LLM ajanıyla karşılıyor, geri kalanını insan ekibe aktarıyor.
Platformun LLM sözleşmesi ise **LLM'in bağlayıcı karar vermesini** yasaklıyor: iade, iptal, fiyat
kararları deterministik koddadır. Destek ajanı bu iki gereksinimi birlikte karşılamalı; ayrıca AB
Yapay Zekâ Yasası md. 50 gereği kullanıcı bir AI ile konuştuğunu bilmelidir.

## Karar

1. **Uç:** `POST /api/support/chat` (oturumlu misafir, tek tur). `withAiSubject` ile kullanıcı
   bütçesine faturalanır, `ai` rate-limit kovasındadır (statik meta test), `markAiGenerated` +
   `disclosure` alanı döner. `SUPPORT_AGENT_ENABLED=false` → 503.
2. **Önce deterministik sınıflandırma** (`src/lib/support/intent.ts`, saf): para/iade talebi,
   hukuki/şikâyet sinyali ve insan isteği LLM'e **hiç gitmeden** `SupportTicket` açar; tek başına
   prompt-injection şablon retle karşılanır (araç/LLM yok). Injection + para talebi → insan
   kuyruğu (onay yok). Böylece en riskli kararlar modelin çıktısına bağlı değildir.
3. **Araçlar** (`src/lib/support/tools.ts`): `get_my_booking`, `explain_cancellation_quote`,
   `get_property_policy` salt-okurdur; `open_support_ticket` tek yazmadır ve yalnız kuyruğa kayıt
   açar. Araç erişim sınıfı (`SUPPORT_TOOL_ACCESS`) kodda sabittir; birim testi listede başka yazma
   aracı olmadığını ve adların iade/iptal/ödeme eylemi içermediğini doğrular. İade tahmini
   rezervasyonun politika anlık görüntüsü + `computeRefund` ile hesaplanır; yazan
   `cancelAndRefund` çağrılmaz (ayrı önizleme fonksiyonu yoktur, bilerek eklenmedi).
4. **Canlı yanıt guard'ları:** `runTools` (adım sınırı `min(LLM_MAX_TOOL_STEPS,
SUPPORT_MAX_TOOL_STEPS)`), çıktı `{reply, confidence}` zod şeması, `assertNumbersGrounded`
   (olgular: kullanıcı mesajı + araç sonuçları), "yetkisiz eylem iddiası" guard'ı
   (`GuardError("unauthorized_action_claim")`: "iadeniz onaylandı", "rezervasyon iptal edildi"…).
   İhlal → aynı araçları deterministik çağıran şablon yanıt (`llmMode: "fallback"`). Kullanıcı
   mesajı `<user_message>` etiketleri arasında **veri** olarak gönderilir.
5. **Güven eşiği:** nihai güven (demo: sınıflandırıcı; canlı: model beyanı) <
   `SUPPORT_HANDOFF_MIN_CONFIDENCE` veya boş yanıt → `LOW_CONFIDENCE` talebi. Bir turda en fazla
   bir talep (idempotent `openTicket`).
6. **Veri modeli:** `SupportTicket` (durum `OPEN|IN_PROGRESS|RESOLVED`, neden, niyet, güven, KVKK
   redakte özet ≤ 1000, dil, çözen yönetici). Ham sohbet saklanmaz. Hesap silmede talepler silinir.
   Yabancı anahtar bilinçli olarak yok (mesaj risk bayrağıyla aynı desen; silme servis katmanında).
7. **İnsan kuyruğu:** `/admin/support` (tr/en, erişilebilir: etiketli filtre, `aria-live` durum),
   `GET /api/admin/support`, `PATCH /api/admin/support/{id}` (ADMIN, denetim kaydı). Kararı insan
   verir; ajan kuyruğu okuyamaz.
8. **Şeffaflık:** misafir sayfası `/support` kalıcı "AI ile konuşuyorsunuz" bildirimi ve her
   yanıtta `LlmBadge` gösterir; API'de `disclosure` + `ai_generated: true`.
9. **Gözlemlenebilirlik:** `support_handoff_total{reason}`, `support_chat_total{intent,outcome}`,
   `support_chat_latency_seconds{outcome}` (metrikler LLM modülünü içe aktarmayan
   `src/lib/support/metrics.ts`'te; `/api/metrics` LLM route'u sayılmaz).

## Sonuçlar

- (+) Ajan hiçbir koşulda iade/iptal/ödeme yapamaz: araç yok, guard iddiayı da reddeder.
- (+) Demo modunda tamamen deterministik; eval paketi (ADR 0030) aynı yolu ölçer.
- (−) Tek tur: bağlamı taşıyan çok turlu sohbet yok (portföy kapsamı; ileride sohbet kimliği +
  redakte geçmiş).
- (−) Desen tabanlı sınıflandırıcı gereksiz devir üretebilir; hata yönü bilinçli olarak güvenli.
- Alternatif: devir kararını da LLM'e bırakmak (araç olarak) — reddedildi; para/hukuk kararı
  modelin yanlış sınıflandırmasına veya enjeksiyona açık olurdu.
