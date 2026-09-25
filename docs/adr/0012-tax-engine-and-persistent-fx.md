# ADR 0012 — Vergi/ücret motoru ve kalıcı döviz kuru

- Durum: Kabul edildi (v3, F3)
- Tarih: 2026-09-25
- İlgili: ADR 0004 (minor-unit para ve tek quote), ADR 0016 (tek fiyat kaynağı)

## Bağlam

v2'de toplam fiyat yalnızca gece fiyatlarının toplamıydı: KDV, konaklama vergisi ve hizmet
bedeli gösterilmiyor, arama kartındaki fiyat checkout toplamından farklı olabiliyordu (FTC
"junk fee" kuralı ve AB Omnibus açısından sorunlu). Döviz kurları statik bir JSON'dan okunuyor,
teklif ile tahsilat arasında kur değişirse tahsil edilen tutar teklif edilenden farklılaşabiliyordu.

## Karar

### Vergi / ücret motoru (P0-4)

- Saf, deterministik fonksiyon (`src/lib/pricing/tax.ts`), tamsayı minor-unit; kurallar kod
  değil **veri**: `data/tax-rules.json` (varsayılan) ya da `TAX_RULES_JSON` (tamamen değiştirir),
  zod ile doğrulanır; geçersiz `TAX_RULES_JSON` uyarı loglanarak varsayılan dosyaya düşer.
- Hesap sırası gece başına: dahil (inclusive) yüzde vergiler tutarın içinden ayrılır (KDV) →
  hariç yüzde vergiler KDV hariç net matrah üzerinden eklenir (TR konaklama vergisi) → sabit
  tutarlı kurallar (gece × oda / kişi) → hizmet bedeli (`SERVICE_FEE_BPS`).
- Aynı `code` için tarih aralıklı kural aralıksız kuralı ezer (ör. konaklama vergisi %2, belirli
  dönemde %1). Yuvarlama her kalemde tek yerde yapılır; kırılımın toplamı toplamla birebir eşittir.
- Arama kartı, PDP, checkout, rezervasyon ve tahsilat aynı `priceStay` sonucunu gösterir
  ("vergiler dahil toplam"); eşitlik entegrasyon testiyle korunur.

### Kalıcı FX (P0-5)

- Günlük `fx-refresh` işi (`FX_REFRESH_CRON`, UTC) kaynakları sırayla dener: **TCMB → ECB →
  statik tablo**. Her çalışma yeni bir `FxRate` satırı yazar (TRY tabanlı, kaynak ve `asOf`
  ile); ağ yoksa statik tablo `stale: true` olarak kaydedilir. Kaynak listesi `FX_SOURCES`
  ("none" → ağ çağrısı yok).
- `FX_STALE_HOURS`'tan eski tablo bayat (`stale`) işaretlenir. Okuma `FX_CACHE_SECONDS`
  süreyle süreç içi önbelleklidir.
- **Teklif kur sabitleme**: tahsilat para birimi tesisinkinden farklıysa (`FX_CHARGE_CURRENCIES`
  izin listesi) teklif, o anki `FxRate` satırının kimliğini (`fxSnapshotId`) ve çevrilmiş tutarı
  taşır. Rezervasyon ve ödeme bu kimlikle hesaplanır; teklif süresi içinde kur değişse de
  kullanıcı teklif edilen tutarı öder.
- Konaklama fiyatı ve vergiler daima tesisin para biriminde hesaplanır; çevrim yalnızca son
  toplamda, tek yuvarlama ile yapılır.

## Sonuçlar

- (+) Gösterilen toplam = tahsil edilen toplam; vergi değişikliği kod dağıtımı gerektirmez.
- (+) Harici kur kaynağı çökse bile rezervasyon akışı çalışır (statik yedek, bayat işareti).
- (−) Vergi kuralları demo niteliğindedir, hukuki doğrulama gerektirir.
- (−) `FxRate` tablosu günlük büyür; budama ileride gerekebilir.
