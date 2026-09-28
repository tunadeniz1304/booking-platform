# ADR 0027 — `payment-service.ts`'in sorumluluklara bölünmesi

- Durum: Kabul edildi (v5 P0-4)
- Tarih: 2026-09-28
- İlgili: ADR 0013 (ödeme sagası), ADR 0026 (telafi jurnali)

## Bağlam

`src/lib/payment/payment-service.ts` ~1800 satıra ulaşmıştı: checkout ödemesi, 3DS/step-up,
ödeme sagası ve onay, PSP webhook'ları, geç başarı mutabakatı, iptal/iade ve iade yeniden
denemesi aynı dosyadaydı. İnceleme ve değişiklik maliyeti yüksekti; sepet modülleri de bu dosyayı
içe aktardığı için `payment-service → webhook → cart-webhook → payment-service` içe aktarma
döngüleri vardı.

## Karar

1. Dosya davranış değişikliği olmadan bölündü (hiçbiri 600 satırı aşmaz):
   - `payment-core.ts` — ortak hatalar, `PayOutcome`, tahsil hakkı geçişleri, void/iade
     yardımcıları, tekil telafi jurnali, ödeme kilidi (`pay:<bookingId>`).
   - `confirm.ts` — ödeme sagası, `captureAndConfirm`, `confirmInTransaction`,
     `applyConfirmation` (tek ve sepet onayı ortak), `retryPaymentCompensation`.
   - `pay.ts` — `payForBooking`, deneme sınırı, step-up/3DS, `confirmPaymentChallenge`.
   - `webhook-handler.ts` — `handleWebhookEvent`.
   - `late-success.ts` — geç gelen başarılı ödemenin mutabakatı.
   - `refund.ts` — `cancelAndRefund`, `REFUND_RETRY_JOB`, iade yeniden denemesi.
2. `payment-service.ts` yalnız yeniden-export eder (geriye uyum); dış çağıranlar değişmedi.
3. Bağımlılık yönü tek yönlüdür: `payment-core ← confirm ← {pay, late-success} ← webhook-handler`,
   `payment-core ← refund`. Sepet modülleri (`src/lib/cart/*`) barrel yerine doğrudan
   `payment-core`/`confirm`'ü içe aktarır; böylece çalışma zamanı döngüsü kalmaz.
4. Döngü kanıtı: `madge` (MIT) devDependency; `npm run deps:circular` →
   `madge --circular --extensions ts --ts-config tsconfig.json src/lib/payment` 0 döngü.
   `.madgerc` yalnız-tip içe aktarmaları (`import type`, çalışma zamanında silinir) yok sayar.

## Sonuçlar

- Payment testleri değişmeden yeşil; test mock'ları `@/lib/payment/payment-service` yolunu
  kullanmaya devam edebilir.
- Yeni kod ilgili alt modülü doğrudan içe aktarmalıdır; barrel yalnız geriye uyum içindir.
