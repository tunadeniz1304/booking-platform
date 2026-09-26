# ADR 0024 — Recent-auth, işleme bağlı step-up ve oturum yönetimi

- Durum: Kabul edildi (v4, F1-B #2 + F1b P0-4)
- Tarih: 2026-09-26
- İlgili: ADR 0017 (mesajlaşma, moderasyon, passkey step-up), ADR 0023 (ajan mandate'leri)

## Bağlam

v3'te hassas hesap işlemleri (passkey kaydı `/api/auth/passkey/register/options|verify`, passkey
silme `DELETE /api/account/passkeys`, hesap silme `DELETE /api/account`) yalnızca geçerli bir
oturum istiyordu. Ödeme step-up'ı Redis'te `stepup:ok:<userId>` bayrağıydı: işleme ve tutara bağlı
değildi, süresi içinde başka bir ödemede de kullanılabiliyordu. Sonuç (v4#2): çerez veya refresh
token'ı çalan saldırgan kendi passkey'ini kaydedip bir sonraki riskli ödemeyi o passkey ile
"step-up" edebiliyor, kurbanı hesabından da atamıyordu (oturum listesi yoktu).

## Karar

1. **`auth_time` claim'i.** Erişim token'ı son **birincil** doğrulamanın (parola veya passkey)
   zamanını taşır (`signAccessToken(..., authTime)`, `AccessClaims.authTime`). Refresh token
   döndürme bu değeri **taşır ama tazelemez** (`RefreshRecord.authTime`); yani çalınmış bir refresh
   ailesi sonsuza kadar "yeni" oturum üretemez.
2. **`requireRecentAuth(req)` / `assertRecentAuth(claims)`** (`src/lib/auth/recent-auth.ts`):
   oturum yoksa 401; `auth_time` `RECENT_AUTH_MAX_AGE_SECONDS`'tan (300) eskiyse 403
   `REAUTH_REQUIRED` (`details.maxAgeSeconds`). Uygulanan uçlar: passkey kayıt seçenekleri ve
   doğrulama, passkey silme, hesap silme, `DELETE /api/account/sessions` (uzaktan çıkış) ve
   `POST /api/account/agent-mandates` (ADR 0023).
3. **Yeniden doğrulama akışı.** İstemci 403 alınca `useReauth()`
   (`src/components/account/ReauthDialog.tsx`) parola ya da passkey ister;
   `POST /api/auth/reauth` (`{method:"password"}` veya `{method:"passkey"}`, passkey seçenekleri
   `POST /api/auth/reauth/options`) eski refresh ailesini ve erişim token'ının `jti`'sini iptal edip
   taze `auth_time`'lı yeni oturum yazar; istek bir kez tekrarlanır. Hatalı parola denemeleri
   kullanıcı başına sınırlıdır (`REAUTH_MAX_ATTEMPTS` / `REAUTH_WINDOW_SECONDS`, 429
   `REAUTH_RATE_LIMITED`).
4. **İşleme bağlı step-up token'ı.** `POST /api/auth/step-up/options {bookingId}` tutarı sunucuda
   hesaplar (`stepUpBindingFor`); başarılı WebAuthn doğrulaması
   `stepup:ok:<userId>:<bookingId>:<nonce>` anahtarına `amountMinor` yazar ve istemciye yalnız
   `nonce`'u (`stepUpToken`) döner. Ödeme `consumeStepUp` ile anahtarı **`GETDEL`** eder ve saklanan
   tutar rezervasyonun güncel tutarına eşit değilse reddeder: token tek kullanımlıktır, başka
   rezervasyona ya da değişmiş tutara taşınamaz. Ömür `STEP_UP_TTL_SECONDS` (300).
5. **Yeni passkey soğuması.** Yeni kaydedilen passkey `PASSKEY_STEP_UP_COOLDOWN_HOURS` (24) boyunca
   ödeme step-up'ında kullanılamaz; uygun passkey yoksa ödeme kapısı 3DS challenge'a düşer. Kayıt
   anında outbox `auth.security_alert` (`PASSKEY_ADDED`) → e-posta bildirimi
   (`src/lib/notifications/security-notifications.ts`).
6. **Oturum kaydı ve uzaktan çıkış.** `UserSession` modeli (migration
   `20260926120000_user_sessions`; `id` = refresh ailesi, imzalı `did` çerezinden `deviceId`,
   `userAgent`, maskeli `ipHint`, `lastSeenAt`, `revokedAt`). Erişim token'ı `sid` claim'i taşır;
   `getAuth`, ailesi iptal edilmiş (`auth:family-revoked:<sid>`) erişim token'ını da reddeder.
   `GET /api/account/sessions` listeler; `DELETE ?id=` / `?scope=others` recent-auth ister. Arayüz
   `/account/sessions`. Daha önce oturumu olan kullanıcı görülmemiş bir `did` ile girerse
   `NEW_DEVICE_LOGIN` güvenlik e-postası gönderilir (`src/lib/auth/user-sessions.ts`).

## Sonuçlar

- (+) Çalınan oturum tek başına passkey ekleyemez, passkey silemez, hesabı silemez, mandate
  veremez, kurbanı dışarı atamaz; kurban ise yeniden doğrulayıp saldırganın oturumunu kapatır ve
  saldırganın erişim token'ı da hemen 401 alır. Kanıt: `tests/integration/v4-sessions.test.ts`
  ("stolen-session"), `tests/integration/v4-recent-auth.test.ts`,
  `tests/unit/regressions/v4-recent-auth.test.ts` (`regression: v4#2`).
- (+) Step-up kanıtı artık "bu kullanıcı, bu rezervasyon, bu tutar, bir kez" demektir.
- (−) Re-auth eski erişim token'ını denylist'e alır; istemci yanıttaki yeni çerezi /
  `accessToken`'ı kullanmak zorundadır. `sid` claim'i olmayan eski token'lar süreleri dolana dek
  geçerlidir (5 dk).
- (−) 24 saatlik soğuma meşru yeni cihazlarda da 3DS'e düşürür; bilinçli ödünleşim.
- (−) Sepet ve bölünmüş ödemede passkey step-up yoktur (risk kararı 3DS'e düşer).
