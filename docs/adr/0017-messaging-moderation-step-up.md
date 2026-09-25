# ADR 0017 — Mesajlaşma, yorum moderasyonu ve passkey step-up

- Durum: Kabul edildi (v3, F6)
- Tarih: 2026-09-25
- İlgili: ADR 0013 (ödeme sagası), P1-6, P1-7, P1-8

## Bağlam

F6 üç kullanıcıya dönük güven yüzeyi ekler: rezervasyon mesajlaşması, yorum moderasyonu ve
riskli ödemelerde ek doğrulama. Üçünde de ortak risk, kararın LLM'e bırakılması ve kişisel
verinin (telefon, e-posta, IBAN, TCKN) platform dışına kaçırılmasıdır.

## Karar

- **Karar deterministiktir, LLM yalnızca ifade eder.** Yorum filtresi (küfür kökleri + PII
  kalıpları), şikâyet eşiği ve fraud kuralları koddadır; eşikler `getConfig()` ile ayarlanır.
  LLM yalnızca yöneticiye "neden işaretlendi" notunu ve ev sahibine yanıt taslağını üretir;
  yorum metnini görmez (yalnız gerekçe kodları), çıktısı hiçbir durumu değiştirmez, her yerde
  demo yedeği vardır.
- **PII maskeleme tek kaynaktan.** `maskMessage` mesaj gövdesini kaydetmeden önce maskeler;
  yorum filtresi aynı dedektörü kullanır, böylece iki yüzey aynı kalıpları yakalar.
- **Mesaj uçlarında sahiplik.** Her uç kimlik doğrular ve yalnız rezervasyonun misafiri veya
  tesisin sahibi erişir; başkalarına 404 döner (varlık sızdırılmaz). SSE akışı Redis pub/sub
  ile yayılır ve IP başına sınırlıdır.
- **Yalnız COMPLETED konaklama yorum hakkı verir** (v3#24); puan ve AI özeti yalnız
  `PUBLISHED` yorumlardan hesaplanır.
- **Step-up mevcut WebAuthn altyapısını kullanır.** Fraud kararı `step_up_passkey` ise ödeme
  403 `STEP_UP_REQUIRED` döner; istemci passkey töreninden sonra aynı `Idempotency-Key` ile
  yeniden dener. Step-up bayrağı tek kullanımlık ve süreli; passkey'i olmayan kullanıcı 3DS'e
  düşer. Sağlayıcı idempotency anahtarı fraud kapısından sonra kullanıldığı için yeniden
  deneme çift provizyon üretmez.

## Sonuçlar

- Filtre yanlış pozitif üretebilir; bu durumda yorum silinmez, yönetici kuyruğunda bekler.
- Küfür sözlüğü küçük ve Türkçe/İngilizce ağırlıklıdır; kısaltmalar yalnız tam kelimeyken
  eşleşir ("Aquapark" işaretlenmez).
- Stripe Payment Element akışında token yeniden kullanılamadığından step-up sonrası kullanıcı
  ödemeyi yeniden gönderir; mock kart akışında yeniden deneme otomatiktir.
