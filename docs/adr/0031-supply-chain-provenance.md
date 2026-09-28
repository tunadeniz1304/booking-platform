# ADR 0031 — Tedarik zinciri güvenliği: SHA pin, SAST, SBOM ve provenance

- Durum: Kabul edildi (v5 P1-6)
- Tarih: 2026-09-28
- İlgili: v5#13, ADR 0030 (LLM eval CI kapısı), docs/SECURITY.md

## Bağlam

CI yalnız `main`'e push/PR'da tetikleniyordu; özellik dallarındaki kırılmalar birleştirmeye
kadar görünmüyordu. Action'lar kayan etiketlerle (`@v4`) pinliydi: etiketi yeniden
yönlendirebilen biri (ele geçirilmiş bakımcı hesabı — `tj-actions/changed-files` 2025 olayı)
CI'da kod çalıştırabilirdi. Statik analiz, secret taraması, SBOM ve yapı kaynağı kanıtı
(provenance) yoktu; bağımlılık geçidi yalnız `npm audit --audit-level=high` idi.

## Karar

1. **Tetikleme:** `ci.yml` ve yeni `security.yml` tüm dallarda her push ve PR'da koşar.
2. **Pinleme:** Her `uses:` tam 40 haneli commit SHA + `# vX.Y.Z` yorumu. SHA'lar
   `git ls-remote` ile alındı; açıklamalı (annotated) etiketlerde `^{}` ile soyulmuş commit
   kullanıldı (ör. `github/codeql-action` v4.38.2, `ossf/scorecard-action` v2.4.4). Container
   imajları (`rhysd/actionlint`, `prom/prometheus`, `zricethezav/gitleaks`, `semgrep/semgrep`)
   `@sha256:` digest ile. Dependabot (`.github/dependabot.yml`) npm, github-actions ve docker
   ekosistemlerini haftalık günceller; SHA ile yorumu birlikte taşır.
3. **SAST:** Semgrep CE (`p/typescript` + `p/javascript`, bulgu → kırmızı) her yerde koşar.
   CodeQL (`javascript-typescript`) yalnız public repoda — private kişisel repoda code scanning
   GitHub Advanced Security ister. İlk koşu gerçek bir bulgu verdi: `openLink` AES-GCM
   çözerken etiket uzunluğunu sabitlemiyordu (4 baytlık kısaltılmış etiket kabul ediliyordu);
   `authTagLength: 16` ile kapatıldı ve testlendi.
4. **Secret taraması:** gitleaks (MIT) tüm git geçmişinde (`fetch-depth: 0`), `--redact`.
   Yerel tarama 513 commit'te 2 bulgu verdi; ikisi de test sabiti (mock kart token'ı, sahte Web
   Push anahtarı) → `.gitleaksignore`'da parmak iziyle, gerekçesiyle. Sonuç: 0 bulgu.
5. **SBOM:** `@cyclonedx/cyclonedx-npm` 6.0.1 (Apache-2.0) `npx` ile, yalnız lockfile'dan,
   üretim bağımlılıkları; CycloneDX 1.6 JSON her koşuda `sbom-cyclonedx` artefaktı (90 gün).
   Proje bağımlılığı olarak eklenmedi (CI'da sürüm pinli `npx`).
6. **Bağımlılık geçidi:** OSV-Scanner (Apache-2.0), lockfile; bilinen her açık kırmızı.
   İstisnalar `osv-scanner.toml`'da `reason` + `ignoreUntil` ile. Tek istisna:
   GHSA-8988-4f7v-96qf (`@opentelemetry/core@1.30.1`, W3C Baggage ayrıştırmada sınırsız
   bellek) — yalnız `@prisma/instrumentation@5.22` altından geliyor ve bu kopya propagator
   olarak kullanılmıyor (yayılım `@vercel/otel` → core 2.x). Kalıcı çözüm Prisma 6 geçişi;
   istisna 2026-12-31'de dolar ve geçidi yeniden kırmızıya çevirir.
7. **Provenance ve Scorecard:** `actions/attest-build-provenance` `.next/standalone`
   tar'ı için SLSA provenance üretir; OpenSSF Scorecard SARIF yükler. İkisi de
   `if: github.event.repository.private == false` koşullu: repo şu an **private**
   (`api.github.com/repos/...` → 404); private kişisel repoda attestation GitHub Enterprise
   Cloud, Scorecard public repo ister. Bu nedenle README'ye Scorecard rozeti **konmadı** ve
   provenance şartı bu turda SBOM artefaktına indirgendi (V-6). Repo public olduğunda iş
   akışı değişmeden devreye girer.
8. **İş akışı lint'i ve alarm testleri:** CI'da `actionlint` ve `promtool check rules` +
   `promtool test rules` (P0-5) Docker ile koşar.

## Sonuçlar

- (+) Etiket yeniden yönlendirme saldırısı CI'ı etkilemez; her güncelleme Dependabot PR'ı
  olarak incelenir.
- (+) Her koşuda makinece okunur SBOM; OSV geçidi `npm audit`'in kaçırdığı düşük/orta
  açıkları da görür.
- (−) SHA pin okunabilirliği düşürür (yorumdaki sürümle telafi); Dependabot PR hacmi artar
  (gruplama ile sınırlandı).
- (−) Private repoda provenance/Scorecard/CodeQL atlanır — kanıt zinciri SBOM ile sınırlı.
