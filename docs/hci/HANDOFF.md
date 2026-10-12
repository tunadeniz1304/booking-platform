# HCI düzeltme işi — Handoff

> Son güncelleme: 2026-10-12 · Durum: Critical/High (PR #9) ve renk + gerilemeler (PR #10) birleştirildi · **Medium/Low turu uygulandı** (130 paket, commit `433af79`) · **crossOwner 2. tur sürüyor** (§8) · sonra: kapılar, çalışma zamanı önce/sonra, rapor, PR
> Bu dosya, haftalık kullanım limiti dolarsa ya da oturum kesilirse işi kaldığı yerden sürdürmek içindir.

## 1. Hedef ve kullanıcı kararları

- `/sevgi-ai:hci-review` ile tüm projenin HCI denetimi + **yalnız HCI düzeltmeleri**.
- **Genel renk paleti ve temaya DOKUNULMAYACAK** (tailwind.config.ts, tema CSS değişkenleri, mevcut renk sınıfları). Renk/kontrast bulguları raporda "Renk/Tema — kapsam dışı" olarak işaretli.
- Kapsam sırası: **önce Critical + High** (renk hariç 361 bulgu), Medium/Low sonra.
- Her bulgu tam belgelenecek: raporda her bulgunun düzeltme durumu (Düzeltildi / Kısmen / Zaten uygun / Atlandı + gerekçe) yer alacak.
- Alt ajan başına **en fazla ~120k token**; ajanlar yalnız kendi dosyalarını okur, tsc/test/build merkezde koşulur.
- Commit yalnız kullanıcı isterse; commit/PR metinlerinde AI/Claude atfı YOK.
- **Park kuralı:** 5 saatlik oturum limiti **%95** ya da haftalık limit **%99** olunca çalışan workflow durdurulur, bu dosya güncellenir, iş park edilir.
- **Renk/tema istisnası (2026-10-11, kullanıcı onayı):** aşağıdaki 12 Critical/High renk bulgusu **uygulanacak — SONRAKİ OTURUMDA**. Bu oturumda başlanmadı. Palet, `tailwind.config.ts` ve tema değişkenleri yine değişmez; yalnız mevcut tonlara geçiş ve mevcut tema token'larına bağlama yapılır. Kayıt: `docs/hci/color-approved.json`; `hci-findings.json`'da `colorApproved: true`.

## 1.1 Onaylı renk düzeltmeleri (12) — UYGULANDI

Hepsi `fixed`; ayrıntı `docs/hci/fix-status.json` → `color`, raporda §7.6. Karanlık temada çalışan uygulamada ölçüldü: giriş alanı kenarlığı kart zemininde 6,99:1, grafik çubukları 4,82:1, harita popup'ı koyu zemin + açık metin. Açık temada çubuklar 3,68:1.

| #    | Konum                                                                                                                    | Yapılacak                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F43  | `src/components/ui/ui.tsx:21`                                                                                            | `inputClass` kenarlığı `border-gray-400` → `border-gray-500`; auth/booking/arama formları ortak `inputClass`'a geçsin                                 |
| F47  | `src/app/login/page.tsx:95,110`, `register/page.tsx:73-120`, `forgot-password/page.tsx:36`, `reset-password/page.tsx:65` | `border-gray-300` → `border-gray-500`                                                                                                                 |
| F119 | `src/components/search/DestinationAutocomplete.tsx:152`                                                                  | Öneri listesi başlığı `text-gray-400` → `text-gray-600`                                                                                               |
| F190 | `src/components/account/ReauthDialog.tsx:99`, `PasskeyManager.tsx:155`                                                   | Kenarlık → `border-gray-500`                                                                                                                          |
| F209 | `src/components/search/ResultsMap.tsx:237` + `src/styles/globals.css`                                                    | Popup'a `className="results-popup"`; `.results-popup .maplibregl-popup-content` ve `.maplibregl-popup-tip` zemini `rgb(var(--bg-white, 255 255 255))` |
| F222 | `src/components/cart/SplitPayPanel.tsx:25-27`                                                                            | VOIDED/REFUNDED/EXPIRED çip metni `text-gray-500` → `text-gray-700`                                                                                   |
| F240 | `src/components/booking/BookingActions.tsx:235`, `WalletCreditOption.tsx:192`                                            | Kart girdisi kenarlığı → `border-gray-500`                                                                                                            |
| F258 | `src/components/compliance/NoticeForm.tsx:17-18`, `ComplianceDashboard.tsx:24-25`                                        | Kenarlık → `border-gray-500`                                                                                                                          |
| F296 | `src/components/host/RevenueDashboard.tsx:101,91`                                                                        | Çubuk `fill="#93c5fd"` → paletten ≥3:1 mavi (ör. `#3b82f6` / primary-500 ya da `#003580`); eksen `#9ca3af` → `#6b7280`                                |
| F297 | `src/components/host/RevenueDashboard.tsx:107-118`                                                                       | Sabit hex yerine tema sınıfları: `className="stroke-brand"`, `className="fill-gray-700"` (karanlık tema eşlemesine bağlanır)                          |
| F339 | `src/app/search/page.tsx:120` (+ görünüm anahtarı ~437)                                                                  | `smallInput` kenarlığı `border-gray-400` → `border-gray-500`                                                                                          |
| F359 | `src/components/booking/BookingMessages.tsx:187`                                                                         | Kenarlık → `border-gray-500`, `placeholder:text-gray-500`                                                                                             |

Not: Satır numaraları düzeltme turundan ÖNCEKİ denetime aittir; dalga 2 ajanları bu dosyaları değiştirdi → uygulamadan önce Grep ile güncel konumu bul. Sonra `tests/unit/ui/theme-contrast.test.ts` + `npm run lint/typecheck/format:check` + karanlık temada görsel kontrol (`colorScheme: "dark"`).

## 2. Üretilen çıktılar (repo içinde, commit edilmedi)

| Dosya                            | İçerik                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HCI_REVIEW_booking-platform.md` | Rapor: yöntem, bağlam, kullanıcı modeli, Dix incelemesi, çalışma zamanı ölçümleri, 1.396 bulgu (Critical/High ayrıntılı, Medium/Low alan bazında), olumlu noktalar, sonraki adımlar, bilinen boşluklar |
| `docs/hci/hci-findings.json`     | Tüm bulguların tam verisi (id F1…F1396, severity, status, file:line, evidence, impact, fix, colorTheme, area)                                                                                          |
| `docs/hci/HANDOFF.md`            | Bu dosya                                                                                                                                                                                               |

Bulgu durumları: 143 Doğrulandı, 337 Gözlemlendi (çalışan uygulamada), 916 Aday (bağımsız doğrulanmadı — düzeltirken kodda teyit ediliyor).

## 3. Düzeltme workflow'u

- Workflow: `hci-fix-critical-high`, run id `wf_91a05f16-fa1`
- Script: `C:\Users\tuna9\.claude\projects\C--Users-tuna9-projects-booking\62fc84fa-09c9-431e-a0a0-680b0434666c\workflows\scripts\hci-fix-critical-high-wf_91a05f16-fa1.js`
- Journal (tamamlanan ajanların sonuçları): `C:\Users\tuna9\.claude\projects\C--Users-tuna9-projects-booking\62fc84fa-09c9-431e-a0a0-680b0434666c\subagents\workflows\wf_91a05f16-fa1\journal.jsonl`
- **Devam ettirme (aynı oturumdan):** `Workflow({scriptPath: "<yukarıdaki script>", resumeFromRunId: "wf_91a05f16-fa1"})` — tamamlanan ajanlar önbellekten döner, yalnız eksikler çalışır.
- **Yeni oturumdan:** resume yalnız aynı oturumda çalışır. Yeni oturumda: journal'daki `result` satırlarından tamamlanan paketleri çıkar, yalnız eksik paketler için aynı brief'lerle (script içindeki `RULES`, `SHARED_API`, `OWN`) yeni bir workflow/ajan başlat.

### Paketler (dosya sahipliği ayrık)

Paket başına bulgu listesi: `C:\Users\tuna9\AppData\Local\Temp\claude\C--Users-tuna9-projects-booking\62fc84fa-09c9-431e-a0a0-680b0434666c\scratchpad\fix\<paket>.json` (silinirse `docs/hci/hci-findings.json`'dan Critical+High ve `colorTheme=false` filtresiyle yeniden üretilebilir; sahiplik haritası `scratchpad\fix\packages.json` ve `scratchpad\build-packages.cjs`).

| Dalga | Paket                                                                                                                                                                                                                                                 | Bulgu | Durum                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| 1     | shell (Header/Footer/ui.tsx/çerez bandı + YENİ `ConfirmDialog.tsx` `useConfirm()` + mobil başlık taşması)                                                                                                                                             | 16    | **bitti** — 9 fixed, 7 partially_fixed; 7 crossOwner isteği; yama `msg/shell.json`             |
| 1     | global (route başlıkları: `titles` ad alanı + 34 segment `layout.tsx`; `not-found`/`error`/`global-error`; YENİ `src/lib/ui/amount-input.ts` `parseAmountToMinor` + 26 unit test geçiyor)                                                             | 13    | **bitti** — 3 fixed, 4 partially_fixed, 6 skipped; 8 crossOwner isteği; yama `msg/global.json` |
| 2     | hostA 19, hostB 19, accountA 21, accountB 11, checkoutA 15, checkoutB 11, checkoutC 6, results 25, resultsB 3, homeA 9, homeB 19, cartA 12, cartB 15, pdp 22, widget 19, admin 18, cards 17, auth 16, resolution 15, misc 15, compliance 15, trips 10 | 332   | **bitti**                                                                                      |

**Toplam (361 Critical+High, renk hariç):** ~200 fixed, ~150 partially_fixed, 15 already_ok, 7 skipped. Paket bazında tablo ve her bulgunun `outcome/summary/files` kaydı: **`docs/hci/fix-status.json`** (journal'dan çıkarıldı; rapor güncellemesi bu dosyadan yapılacak). 24 ajan, ~3,1M token (ortalama ~129k/ajan).

**Açık takip listeleri (fix-status.json içinde):** `crossOwner` (~130 istek: başka paketin dosyasında yapılması gereken değişiklikler — ör. CookieConsent'in layout'ta skip-link'ten sonra konması, ekranların `Button busy` / `useErrorText` / `loginHref` kullanımına geçmesi, login/register'da redirect doğrulaması) ve `testUpdates` (8: checkoutA 3, checkoutC 2, widget 3 — e2e akışlarına eklenen onay adımları vb.).

**Mesaj birleştirme:** 24 yama, 1.282 yeni anahtar, 88 mevcut metin güncellemesi, 14 "çakışma" (aynı anahtar, iki pakette farklı ifade: cart/payment/common `errors.*`) — sıradaki son yama kazandı (alfabetik: cartB > cartA, global > checkoutA, shell > global). Günlük: `scratchpad\merge.log`.

Dalga 1 merkez kontrol notları: `next build` (34 geçiş layout'u + kök `title.template`), `tests/unit/i18n/i18n.test.ts` NAMESPACES/dizin eşliği (`titles` eklendi), `global-error.tsx` `../styles/globals.css` içe aktarıyor; e2e `i18n.spec.ts:30` (Giriş yap bağlantısı) ve `:73` (`getByLabel('Dil').first()`) başlık değişikliğinden sonra kontrol edilmeli.

## 4. Workflow bittikten (ya da durdurulduktan) sonra yapılacaklar

### 4.1 Kalite kapıları (birleştirme sonrası)

Çıktılar: `scratchpad\gates\{lint,tc,i18n,fmt,unit}.txt`. Sonuç: _koşuluyor — tamamlanınca buraya işlenecek_.

1. ~~**Mesaj yamalarını birleştir:**~~ (YAPILDI) ajanlar `messages/*.json`'u doğrudan düzenlemez, yamaları `scratchpad\msg\<paket>.json`'a yazar.
   `node "<scratchpad>\merge-messages.mjs" C:/Users/tuna9/projects/booking "<scratchpad>\msg" --dry` → çakışma yoksa `--dry` olmadan çalıştır → `npx prettier --write messages`.
2. **Kapılar:** `npm run lint`, `npm run typecheck`, `npx tsx scripts/i18n-check.ts`, `npm run format:check`, `npx vitest run --project unit`.
   Temel durum (düzeltmeden önce): hepsi yeşil; unit'te 1 kararsız (flaky) test bir kez düştü, tekrarında geçti.
3. ~~`testUpdates`~~ (YAPILDI, PR #9 içindeki e2e commit'i). `crossOwner` isteklerini uygula — sınıflandırma ve uygulama sürüyor.
4. **Çalışma zamanı karşılaştırması:** dev sunucusu açıkken `node "<scratchpad>\runtime\sweep.mjs" "<scratchpad>\runtime\after"` → önce/sonra: genel `<title>` sayısı (önce 102/128), mobil yatay taşma (önce 23/66/142 px), axe ihlalleri, <24px hedefler.
5. **Raporu güncelle:** her Critical/High bulguya ajan `results[].outcome/summary` → "Düzeltme durumu" sütunu; "Düzeltme Günlüğü" bölümü; kullanıcı istedi: bulgular tam belgelenmiş olsun (alan bazında ayrıntılı dosyalar `docs/hci/` altında).
6. Medium/Low turu (kullanıcı onayıyla).
7. Temizlik: dev sunucusunu durdur, `git checkout next-env.d.ts` (`next dev` yolu `.next/dev/types` olarak değiştiriyor), Docker konteynerleri (`booking-dev-db-1`, `booking-dev-redis-1`) kullanıcıya sor.

## 5. Ortam

- Docker Desktop açık; `npm run db:up` ile Postgres+Redis, migrate + demo seed yüklendi (`DEMO_MODE=true NODE_ENV=development npm run db:seed`).
- Dev sunucusu: `.claude/launch.json` → `booking-dev` (git'ten `.git/info/exclude` ile hariç). Env: `NODE_ENV=development`, `DEMO_MODE=true`, `RATE_LIMIT_DEMO_RELAX_MULTIPLIER=50`, `LLM_MODE=demo`, rastgele üretilmiş yerel `JWT_SECRET` (`.env`'deki değer uygulamanın 32 karakter kuralına takılıyor; `.env` değiştirilmedi).
- Çalışma zamanı tarama araçları: `scratchpad\runtime\sweep.mjs` (4 persona × route × masaüstü/mobil, axe, Tab sırası, taşma, hedef boyutu, ekran görüntüsü), `crop.mjs`, `probe-template.mjs`; önceki tarama verisi `scratchpad\runtime\full\report.json`.

## 6. Next.js 16 notları (ajanlara verildi)

- `error.tsx` / `global-error.tsx` prop'ları `{ error, retry }` (eski `reset` yerine `retry` önerilir).
- `not-found.tsx` kök layout içinde render edilir; `global-error.tsx` kendi `<html>/<body>`'sini içerir, global stil/tema almaz.
- Client sayfalar `metadata` export edemez → başlıklar segment `layout.tsx` + `generateMetadata` ile.

## 7. Çalışma zamanı önce/sonra (aynı 128 ziyaret, `scratchpad\runtime\after\report.json`)

| Ölçüm                            | Önce | Sonra |
| -------------------------------- | ---- | ----- |
| Genel `<title>` gösteren ziyaret | 112  | 4     |
| Mobilde yatay taşan sayfa        | 55   | 1     |
| < 24 px dokunma hedefi (toplam)  | 636  | 266   |
| h1'i olmayan sayfa               | 4    | 0     |
| axe serious                      | 3    | 6     |

Düzeltme sonrası ortaya çıkan 2 gerileme — **İKİSİ DE DÜZELTİLDİ** (`fix-status.json` → `regressions`; çalışan uygulamada doğrulandı: 1280 px'te admin sayfalarında axe `target-size` 0, mobil promosyon taşması 0 px):

1. **Admin başlık menüsü, 1280 px:** `target-size` (serious) ihlali, 6 admin sayfasında. Header'da masaüstü menü artık `xl:flex`; admin'in ek bağlantılarıyla "Posta kutusu (demo)" bağlantısı komşusuna çok yakın kalıyor. Sahip: `src/components/layout/Header.tsx` (shell).
2. **Ev sahibi promosyon tablosu, mobil:** sayfa 181 px yatay taşıyor (önce 142 px). Tablo kaydırılabilir bir kapsayıcıya alınmamış: `tabIndex=0` + `role="region"` + `aria-label` + `overflow-x-auto`. Sahip: `src/components/host/PromotionsPanel.tsx` (hostB).

Konsol hataları 251'den 333'e çıktı; artışın 319'u `401 Unauthorized`. Bu, uzun tarama sırasında süresi dolan demo oturumlarından kaynaklanan tarama artefaktı, uygulama gerilemesi değil.

## 8. Medium/Low turu ve paketler arası istekler (2026-10-12, bulut oturumu)

Ortam bulut konteyneri (Linux). Scratchpad: `/tmp/claude-0/-home-user-booking-platform/6c8e30e3-b8b0-5400-b6f9-3d38ab33293b/scratchpad` (aşağıda `$S`). Dal: `hci/regressions-and-color-vs4f2l`.

| Adım                                                                                                                        | Durum                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| crossOwner sınıflandırma (131 istek)                                                                                        | bitti: 76 uygulanabilir (Medium/Low paketlerine katıldı), 31 zaten yapılmış, 24 ertelendi (gerekçeler `$S/xo/triage.json`) |
| Medium/Low turu: 130 paket (`$S/ml/pkgs/`, betik `$S/ml/ml-fix.js`)                                                         | bitti: 754 fixed, 247 partially_fixed, 153 already_ok, 8 skipped; sonuçlar `$S/ml/results.json`                            |
| Mesaj yamaları (`$S/msg-ml/p*.json`)                                                                                        | birleştirildi (125 yama, 2.726 yeni, 583 güncelleme; 24 çakışmada sonraki paket kazandı)                                   |
| Kapılar (tur 1 sonrası)                                                                                                     | lint, typecheck, i18n, format, unit (1.328) geçti; testUpdates uygulandı                                                   |
| crossOwner 2. tur: ajanların yeni 546 isteği → 81 paket (`$S/ml/pkgs2/`, betik `$S/ml/ml-fix2.js`, plan `$S/ml/plan2.json`) | sürüyor; ilk koşuda 16 paket oturum limitine takıldı, resume edildi. Run id'leri `$S/ml/runs2.txt`                         |
| Çalışma zamanı taraması                                                                                                     | önce (792a57a, 178 ziyaret) bitti: `$S/sweep/base-out/`; sonra: 2. tur bitince (`$S/sweep/README.md`)                      |

Devam (aynı oturumda): `Workflow({scriptPath: "$S/ml/ml-fix2.js", resumeFromRunId: <run id>, args: <plan2.json'daki wf>})`. Sonuç toplama: `node $S/ml/collect.mjs <out.json> <run id>...`. Kayıt: `node $S/ml/records-ml.mjs $S/ml/results.json $S/xo/triage.json <round2.json>`. Mesajlar: `node $S/merge-messages.mjs . $S/msg-ml` (r2 yamaları tur 1 yamalarından sonra birleşir).
