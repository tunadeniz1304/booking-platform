# Güvenlik politikası

## Açık bildirimi

Bir güvenlik açığı bulduysanız lütfen **herkese açık issue açmayın**.

- GitHub'da **Security → Report a vulnerability** (özel güvenlik bildirimi) ile, ya da
- depo sahibine GitHub profili üzerinden özel mesajla bildirin.

Bildirimde etkilenen sürüm/commit, yeniden üretme adımları ve olası etki yer alsın. Hedefler:
ilk yanıt **5 iş günü**, doğrulanmış açık için düzeltme ya da azaltım **30 gün** içinde.
Koordineli ifşa: düzeltme yayımlanana kadar ayrıntıları paylaşmamanızı rica ederiz.

## Kapsam

Bu bir portföy/demo projesidir; ödeme sağlayıcısı varsayılan olarak mock'tur ve gerçek kart
verisi işlenmez. Kapsam içi: kimlik doğrulama/yetkilendirme atlatma, çift rezervasyon veya
para tutarsızlığı, webhook/imza doğrulama, SSRF, sır sızıntısı, tedarik zinciri.
Kapsam dışı: demo kullanıcılarının bilinen parolaları, hız sınırı olmayan yerel geliştirme
uçları, yalnız `docker-compose.demo.yml` ile açılan demo yardımcıları.

## Desteklenen sürümler

Yalnız `main` dalının son hali desteklenir.

## Tehdit modeli ve kapatılan açıklar

STRIDE tehdit modeli, güven sınırları, kapatılan açıkların regresyon testleri ve bilinen
açık riskler: [docs/SECURITY.md](docs/SECURITY.md).

## Tedarik zinciri

Her push/PR'da: Semgrep SAST, gitleaks secret taraması, OSV-Scanner bağımlılık geçidi ve
CycloneDX SBOM artefaktı (`.github/workflows/security.yml`). Tüm action'lar commit SHA ile,
container imajları digest ile pinlidir; güncellemeler Dependabot ile gelir. Karar kaydı:
[ADR 0031](docs/adr/0031-supply-chain-provenance.md).
