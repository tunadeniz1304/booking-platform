# Kimlik doğrulama — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 59 bulgu · Severity: Critical 3, High 14, Medium 23, Low 19

## F1 — Doğrulama e-postasını yeniden göndermenin arayüzde hiçbir yolu yok; hata metni var olmayan bir hesap özelliğini gösteriyor

| Alan                | Değer                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                                  |
| Durum               | Doğrulandı                                                                                                                                                                                                                |
| Konum               | `src/app/verify-email/page.tsx:35`                                                                                                                                                                                        |
| Diğer konumlar      | `messages/tr/auth.json:52`, `messages/en/auth.json:52`, `src/app/api/auth/verify-email/resend/route.ts:10`, `src/app/api/bookings/route.ts:12`, `src/app/api/cart/[id]/hold/route.ts:16`, `src/app/checkout/page.tsx:137` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                                        |
| Prensip             | robustness · recoverability                                                                                                                                                                                               |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                                                                         |
| Kaynak denetçiler   | area:auth                                                                                                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: auth)                                                                                                                                                                                       |

**Kanıt:** verify-email/page.tsx:35 `{state === "error" && <Notice kind="error">{t("verify.error")}</Notice>}` → messages/tr/auth.json:52 'Hesabınızdan yeni bir doğrulama e-postası isteyebilirsiniz.' (en/auth.json:52 de aynı). `POST /api/auth/verify-email/resend` (resend/route.ts:10-21, requireAuth, 202 veya {alreadyVerified:true}) src altında hiçbir istemci kodundan çağrılmıyor (grep 'resend' yalnız route dosyasını buluyor); *.tsx içinde emailVerified kullanan UI yok. Rezervasyon (api/bookings/route.ts:12), sepet tutma (cart/[id]/hold:16), ödeme (bookings/[id]/pay:27, pay/confirm:22, rnpl:13) requireVerifiedEmail ile korunuyor; checkout/page.tsx:137 EMAIL_NOT_VERIFIED için yalnız sunucu metnini ('Bu işlem için e-posta adresinizi doğrulamanız gerekiyor', errors.ts EmailNotVerifiedError) gösteriyor, eylem yok. Doğrulama bağlantısı 24 saat geçerli (app-config AUTH_VERIFY_TOKEN_TTL_HOURS).

**Etki:** Doğrulama bağlantısının süresi dolan, e-postayı silen ya da spam'de kaybeden misafir rezervasyon, sepet tutma ve ödeme adımlarında kalıcı olarak 403 alır. Arayüzde yeni bağlantı isteme yolu olmadığı için birincil görev olan rezervasyon tamamlanamaz. Hata metni olmayan bir ayarı tarif ettiği için kullanıcı hesap sayfasında boşuna arar.

**Önerilen aksiyon:** Paylaşılan bir `ResendVerificationButton` bileşeni oluşturun (`Button` + `Status` primitifleri; `apiFetch('/api/auth/verify-email/resend', {method:'POST'})`). 202 yanıtında Status'a t('verify.resent') ('Yeni bağlantı gönderildi; önceki bağlantılar artık geçersiz.') yazın, `alreadyVerified` yanıtında t('verify.alreadyVerified') gösterin ve düğmeyi 60 sn geri sayımla `aria-disabled` tutun. Bileşeni (1) verify-email hata durumunda Notice'in altına (oturum yoksa `/login?redirect=/verify-email` bağlantısı), (2) /account sayfasına ve (3) checkout/page.tsx'te `data.code === "EMAIL_NOT_VERIFIED"` için açılacak ayrı dala yerleştirin. TR/EN `verify.error` metnini 'Bağlantı geçersiz veya süresi dolmuş. Aşağıdan yeni bağlantı isteyebilirsiniz.' olarak güncelleyin.

**Yapılan düzeltme:** AuthCard.tsx now has a new ResendVerificationButton. It uses the Button and Status primitives and calls POST /api/auth/verify-email/resend through apiFetch. On 202 it shows verify.resent, on alreadyVerified it shows verify.alreadyVerified, and it waits 60 seconds (aria-disabled plus a visible countdown) before allowing another send. On 401 it shows verify.loginToResend. On the verify-email error screen, a signed-in user sees this button and a signed-out user gets a link to /login?redirect=/verify-email (useSession). A missing token goes straight to the error state without calling the server. The verify.error text now points to the action below it, in both TR and EN. Placement on the account and checkout pages belongs to other owners and is listed in crossOwner. — dosyalar: `src/components/auth/AuthCard.tsx`, `src/app/verify-email/page.tsx`

## F2 — Doğrulama e-postası yeniden gönderilemiyor; hata metni var olmayan bir yolu tarif ediyor ve rezervasyon bloke oluyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                                                                                                                             |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                           |
| Konum               | `src/app/verify-email/page.tsx:35`                                                                                                                                                                                                                                                                                   |
| Diğer konumlar      | `messages/tr/auth.json:52`, `src/app/register/page.tsx:41`, `src/app/account/page.tsx:225`, `src/app/checkout/page.tsx:136`, `src/app/api/bookings/route.ts:12`, `src/app/pay/share/[token]/page.tsx:51`, `src/components/resolution/shared.tsx:118`, `messages/tr/cart.json:108`, `messages/tr/resolution.json:181` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                                                                                                                                   |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                                                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                  |
| WCAG                | 3.3.3                                                                                                                                                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                |
| Efor                | M                                                                                                                                                                                                                                                                                                                    |
| Kaynak denetçiler   | lens:status, lens:copy, lens:nav                                                                                                                                                                                                                                                                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: auth)                                                                                                                                                                                                                                                                                  |

**Kanıt:** verify-email/page.tsx:35 `{state === "error" && <Notice kind="error">{t("verify.error")}</Notice>}` → messages/tr/auth.json:52 'Hesabınızdan yeni bir doğrulama e-postası isteyebilirsiniz.' Ancak src/app/api/auth/verify-email/resend/route.ts uç noktası var, hiçbir .tsx onu çağırmıyor (grep 'resend' src/**/*.tsx → 0). account/page.tsx:225-246 profil kartında yalnız ad, e-posta ve rol var; doğrulama durumu ya da yeniden gönder düğmesi yok. api/bookings/route.ts:12 `requireVerifiedEmail(req)` (23 API dosyasında kullanılıyor) → 403 EMAIL_NOT_VERIFIED; checkout/page.tsx:136 bunu `data.error` ile eylemsiz metin olarak gösteriyor. register/page.tsx:41 başarıda yalnız `router.push("/")`; doğrulama e-postası gönderildiği söylenmiyor. Doğrulama bağlantısı AUTH_VERIFY_TOKEN_TTL_HOURS (varsayılan 24 sa) sonra geçersiz.

**Etki:** Yeni misafir kayıttan sonra doğrulama gerektiğini öğrenmez, ödeme adımında 403 alır. E-posta kaybolmuş veya 24 saat geçmişse arayüzde rezervasyon yapmanın, bölünmüş ödeme payını ödemenin ya da talep açmanın hiçbir yolu yoktur; birincil görev bloke olur. Ev sahibi de doğrulama isteyen işlemlerde aynı çıkmaza girer. Metnin işaret ettiği 'Hesabınızdan' denetimi bulunmadığı için güven de zedelenir.

**Önerilen aksiyon:** (1) account/page.tsx profil kartına (satır ~236, e-postanın altına) 'E-posta doğrulandı / doğrulanmadı' metin rozeti ve ui.tsx `Button variant="secondary"` ile 'Doğrulama e-postasını yeniden gönder' ekleyin: POST /api/auth/verify-email/resend, `useLoader` ya da busy durumu ile 'Gönderiliyor…', sonuç ui.tsx `Status` ile ('{email} adresine gönderildi'), 202/alreadyVerified ayrımı; fetchCurrentUser yanıtına emailVerified alanı eklenmeli. (2) verify-email/page.tsx hata durumunda useSession() oturum varsa aynı düğmeyi, yoksa `/login?redirect=/account` bağlantısını gösterin; verify.error metnini bu düğmeye işaret edecek şekilde güncelleyin. (3) register/page.tsx:41 başarıda ana sayfa yerine '{email} adresine doğrulama bağlantısı gönderdik' ara görünümü (yeniden gönder + devam et) gösterin. (4) checkout/page.tsx, pay/share/[token]/page.tsx:51 ve resolution/shared.tsx:118'de `code === "EMAIL_NOT_VERIFIED"` yakalanınca seçim korunarak satır içi 'Doğrulama e-postası gönder' düğmesi verin.

**Yapılan düzeltme:** Same fix as F1, plus the register-success screen from F49. The account profile badge and button, the emailVerified field in the /api/user/me response, and the EMAIL_NOT_VERIFIED branches in checkout, pay/share and resolution are listed in crossOwner. — dosyalar: `src/app/verify-email/page.tsx`, `src/app/register/page.tsx`, `src/components/auth/AuthCard.tsx`

## F4 — E-posta doğrulama bağlantısı geçersiz/süresi dolmuşsa kurtarma yolu yok; metin var olmayan bir 'hesabınızdan yeniden isteyin' özelliğine yönlendiriyor

| Alan                | Değer                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                 |
| Durum               | Gözlemlendi                                                                                                                                                                              |
| Konum               | `src/app/verify-email/page.tsx:35`                                                                                                                                                       |
| Diğer konumlar      | `messages/tr/auth.json`, `messages/en/auth.json`, `src/app/register/page.tsx`, `src/app/api/auth/verify-email/resend/route.ts`, `src/app/api/bookings/route.ts`, `src/lib/auth/index.ts` |
| Kullanıcılar        | misafir                                                                                                                                                                                  |
| Prensip             | robustness · Dix Robustness — Recoverability (ileri hata kurtarma) + Observability                                                                                                       |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                        |
| Kaynak denetçiler   | runtime:auth                                                                                                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: auth)                                                                                                                                                      |

**Kanıt:** RUNTIME: /verify-email?token=invalid ve token'sız /verify-email (desktop TR, mobile EN): kartta yalnızca 'Bağlantı geçersiz veya süresi dolmuş. Hesabınızdan yeni bir doğrulama e-postası isteyebilirsiniz.' + tek bağlantı 'Ana sayfaya dön -> /', main içinde button sayısı 0 (probe verify.mjs). Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/full/shots/021-anon-tr-mobile-_verify_email_token_invalid.png. Kayıt sonrası akış (register API mock 201, hesap oluşturulmadı): /register?redirect=%2Fcart -> '/' ve sayfada doğrulama/'e-postanızı kontrol edin' bildirimi yok (regredirect.mjs). KOD: /api/auth/verify-email/resend ucu var ama src/ altında onu çağıran hiçbir istemci yok (grep 'resend|verify-email' -> yalnız verify-email/page.tsx ve lib); account/page.tsx'te doğrulama bileşeni yok. /api/bookings/route.ts:12 requireVerifiedEmail ile 403 EMAIL_NOT_VERIFIED veriyor; doğrulama token TTL 24 saat (app-config.ts:363).

**Etki:** Doğrulama e-postasını kaybeden ya da 24 saatte açmayan misafir, rezervasyon/ödeme adımında 403 alır ve kendi başına doğrulama e-postasını yeniden isteyemez: birincil görev (rezervasyon) kalıcı olarak engellenir; ekran yanlış bir vaat veriyor.

**Önerilen aksiyon:** (1) verify-email hata durumuna 'Yeni doğrulama e-postası gönder' düğmesi ekleyin (oturum varsa POST /api/auth/verify-email/resend, yoksa /login?redirect=/verify-email/resend benzeri akış) ve başarıda role=status ile 'Gönderildi' gösterin. (2) Hesap sayfasına doğrulanmamış e-posta için kalıcı bir bant + 'Yeniden gönder' koyun. (3) Kayıt sonrasında (register/page.tsx:41) 'Rezervasyon için e-postanızı doğrulayın — {email} adresine bağlantı gönderdik' bildirimini gösterin. (4) Metni gerçek yolu gösterecek şekilde güncelleyin.

**Yapılan düzeltme:** Same as F1 and F2: verify-email now has a resend button or a sign-in link, the result is announced in a role=status live region, and registration shows a 'we sent a link to {email}' screen. The persistent banner on the account page belongs to another owner and is in crossOwner. — dosyalar: `src/app/verify-email/page.tsx`, `src/app/register/page.tsx`, `src/components/auth/AuthCard.tsx`

## F35 — Parolayla girişte redirect doğrulanmıyor (açık yönlendirme); passkey yolu ile tutarsız

| Alan                | Değer                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                     |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                           |
| Konum               | `src/app/login/page.tsx:63`                                                                                              |
| Diğer konumlar      | `src/app/login/page.tsx:141`, `src/app/login/page.tsx:142`, `src/app/register/page.tsx:41`, `src/app/login/page.tsx:149` |
| Kullanıcılar        | tümü                                                                                                                     |
| Prensip             | robustness · consistency / error prevention                                                                              |
| Sezgisel madde      | H5 — Hata önleme                                                                                                         |
| Renk/tema           | Hayır                                                                                                                    |
| Efor                | S                                                                                                                        |
| Kaynak denetçiler   | area:auth, lens:nav                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                             |

**Kanıt:** login/page.tsx:63-64 `const redirect = new URLSearchParams(window.location.search).get("redirect") ?? "/"; router.push(redirect);` hiçbir doğrulama yapmıyor. Aynı dosyada passkey yolu :142 `redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/"` ile doğruluyor. Next router dış URL'ye tam sayfa gezinme yapıyor (app-router-instance.js:228/265 isExternalURL, app-router.js:219 location.assign).

**Etki:** `/login?redirect=https://kotu.example/login` bağlantısıyla gelen kullanıcı gerçek sitede parolasını girdikten sonra sahte bir 'parola hatalı' sayfasına atılabilir ve kimlik bilgisini ikinci kez verebilir. Aynı formdaki iki giriş yöntemi de farklı davranır.

**Önerilen aksiyon:** src/lib/auth altında `safeRedirect(v: string | null): string` yazın: değer yalnız '/' ile başlıyor ve '//' ya da '/\\' ile başlamıyorsa döndürsün, aksi halde '/' döndürsün. Bu yardımcıyı :63 parola yolunda, :141 passkey yolunda ve register'a taşınacak redirect'te kullanın.

**Yapılan düzeltme:** Added safeRedirect(raw) to AuthCard.tsx. It accepts a value only if it starts with '/', does not start with '//' or '/\', and resolves to the same origin; anything else becomes '/'. Both the password and passkey paths in login now use it through a shared goBack() function, and register uses it after success. — dosyalar: `src/components/auth/AuthCard.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx`

## F36 — Alan düzeyinde hata yok: sunucu doğrulama hatası yalnız 'Doğrulama hatası' olarak gösteriliyor; aria-invalid/aria-describedby kullanılmıyor, istemci kısıtları sunucuyla uyumsuz

| Alan                | Değer                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                                     |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                           |
| Konum               | `src/app/register/page.tsx:39`                                                                                                                                                                                                                                                                                           |
| Diğer konumlar      | `src/app/login/page.tsx:88`, `src/app/forgot-password/page.tsx:19`, `src/app/forgot-password/page.tsx:29`, `src/app/reset-password/page.tsx:57`, `src/lib/http/errors.ts:154`, `src/app/api/auth/register/route.ts:16`, `src/components/ui/ui.tsx:47`, `src/lib/auth/password-policy.ts:8`, `src/lib/http/errors.ts:155` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                     |
| Prensip             | accessibility · WCAG 3.3.1 Error Identification / recoverability                                                                                                                                                                                                                                                         |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                      |
| WCAG                | 3.3.1                                                                                                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                                                                                                                                        |
| Kaynak denetçiler   | area:auth, lens:forms                                                                                                                                                                                                                                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                                                                                                                                                                                             |

**Kanıt:** register/page.tsx:39 `throw new Error(data.error ?? ...)`: ZodError yanıtı (errors.ts:154 `{ error: "Doğrulama hatası", code: "VALIDATION_ERROR", details: error.flatten() }`) için `details.fieldErrors` hiç okunmuyor. Ad ve soyad input'larında (:66-88) minLength yok, oysa sunucu register/route.ts:16-17 `min(2)` istiyor. type=email 'ali@gmail' değerini kabul ediyor ama zod .email() reddediyor. forgot-password/page.tsx:19 400 yanıtını genel 'İstek gönderilemedi, tekrar deneyin' metniyle gösteriyor. Hiçbir auth input'unda aria-invalid ya da aria-describedby yok; tüm hatalar tek bir role=alert kutusunda (login :120-124, register :127-131). Bu bağlamayı yapan `Field` (ui.tsx:47-88) auth sayfalarında kullanılmıyor.

**Etki:** Adını tek harfle yazan ya da sunucunun reddettiği bir e-posta giren kullanıcı yalnız 'Doğrulama hatası' görür ve hangi alanın neden hatalı olduğunu bilemez. Şifremi unuttum sayfasında da 'tekrar deneyin' döngüsüne girer. Ekran okuyucu kullanıcısı hatalı alana döndüğünde 'geçersiz' bilgisini duymaz.

**Önerilen aksiyon:** Auth input'larını ui.tsx `Field` ile sarın (`label`, `id`, `error` prop'u). VALIDATION_ERROR yanıtında `details.fieldErrors` anahtarlarını (firstName, lastName, email, password) çevrilmiş alan mesajlarına eşleyip ilgili Field'ın `error` prop'una verin ve ilk hatalı input'a `focus()` yapın. Genel hata kutusunu yalnız alan dışı hatalar (kimlik bilgisi, ağ) için tutun. İstemci kısıtlarını sunucuyla hizalayın: ad ve soyad `minLength={2}`, gönderimde parola rakam kontrolü. forgot-password'de 400'ü ayrı bir `invalid` durumu olarak ele alıp e-posta alanının Field error'ünde 'Geçerli bir e-posta adresi girin (ör. ad@ornek.com)' gösterin.

**Yapılan düzeltme:** Added AuthField to AuthCard.tsx. It follows the ui.tsx Field pattern (aria-describedby, aria-invalid) but keeps the existing gray-700 label color. On VALIDATION_ERROR, register maps details.fieldErrors for firstName, lastName, email and password to translated messages (register.errors.*) and moves focus to the first invalid field. EMAIL_TAKEN shows as a field error on email. The name inputs now have minLength=2. Before sending, the form checks name length and that the password has 8+ characters and a digit. In forgot-password, a 400 becomes a separate 'invalid' state: the email field shows forgot.invalidEmail and gets focus. — dosyalar: `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`, `src/components/auth/AuthCard.tsx`

## F37 — Şifre sıfırlamada eksik/süresi dolmuş bağlantı ancak gönderimden sonra ve genel metinle bildiriliyor; yeni bağlantı isteme yolu yok

| Alan                | Değer                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                    |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                          |
| Konum               | `src/app/reset-password/page.tsx:19`                                                                                                                    |
| Diğer konumlar      | `src/app/reset-password/page.tsx:33`, `src/app/reset-password/page.tsx:76`, `src/app/api/auth/password/reset/route.ts:9`, `src/lib/auth/account.ts:271` |
| Kullanıcılar        | tümü                                                                                                                                                    |
| Prensip             | robustness · recoverability                                                                                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                     |
| WCAG                | 3.3.3                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                   |
| Efor                | S                                                                                                                                                       |
| Kaynak denetçiler   | area:auth, lens:forms                                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                            |

**Kanıt:** reset-password/page.tsx:19 token yalnız submit sırasında okunuyor. Token yoksa sunucuda password/reset/route.ts:9 `token: z.string().min(20)` ZodError üretiyor; istemci :33 `fieldErrors?.password?.[0] ?? body.error` token hatasını atlayıp 'Doğrulama hatası' gösteriyor. Süresi dolmuş ya da kullanılmış token'da account.ts consumeToken 'Bağlantı geçersiz veya süresi dolmuş' dönüyor; :76 Notice'te /forgot-password bağlantısı yok ve sayfada başka gezinme bağlantısı da bulunmuyor.

**Etki:** 30 dakikalık süresi dolmuş bağlantıyı açan kullanıcı yeni parolayı yazıp gönderdikten sonra hatayı öğrenir. Çıkış yolu yalnız tarayıcının geri tuşu ya da menüden elle gezinmedir. E-postadan açılan mobil sekmede bu belirgin bir sürtünme yaratır.

**Önerilen aksiyon:** Mount'ta (useEffect) token'ı okuyun; token yoksa ya da 20 karakterden kısaysa formu göstermeyin, Notice içinde 'Bu bağlantı eksik veya geçersiz.' metni ve `<Link href="/forgot-password">{t('reset.requestNew')}</Link>` gösterin. Gönderimde `fieldErrors.token` dolu geldiğinde ya da kod VALIDATION_ERROR olup hata password alanına ait değilse aynı CTA'yı hata Notice'ine ekleyin.

**Yapılan düzeltme:** reset-password reads the token as soon as the page loads (useSearchParam, safe for hydration). If the token is missing or shorter than 20 characters, the form is not shown. Instead the page shows an invalidTitle card with the invalidLink notice, a primary 'Yeni bağlantı iste' link to /forgot-password and a 'Girişe dön' link. A link that turns out invalid or expired on submit goes to the same card. The form screen and the done screen also got a back-to-login link. — dosyalar: `src/app/reset-password/page.tsx`

## F46 — Sunucu hata metinleri sabit Türkçe; EN arayüzde çevrilmeden gösteriliyor

| Alan                | Değer                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                               |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                         |
| Konum               | `src/app/login/page.tsx:61`                                                                                                                                                                                                                                                                        |
| Diğer konumlar      | `src/app/register/page.tsx:39`, `src/app/reset-password/page.tsx:33`, `src/components/auth/PasskeyLoginButton.tsx:24`, `src/lib/auth/passkey-client.ts:87`, `src/app/api/auth/register/route.ts:46`, `src/lib/http/errors.ts:154`, `src/lib/auth/password-policy.ts:6`, `src/lib/api-client.ts:40` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                               |
| Prensip             | accessibility · WCAG 3.1.2 Language of Parts / consistency                                                                                                                                                                                                                                         |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                                                                                                                                  |
| Kaynak denetçiler   | area:auth                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                                                                                                                                                                       |

**Kanıt:** login/page.tsx:61 `throw new Error(data.error ?? t("login.failed"))`, register/page.tsx:39 ve reset-password/page.tsx:33 sunucunun `error` metnini doğrudan gösteriyor. PasskeyLoginButton.tsx:24 → passkey-client.ts `if ("status" in err) return err.message` aynı şeyi yapıyor. Sunucu metinleri sabit Türkçe: login/route.ts 'E-posta veya parola hatalı', register/route.ts:46 'Bu e-posta adresi zaten kayıtlı', account.ts consumeToken 'Bağlantı geçersiz veya süresi dolmuş', errors.ts ZodError 'Doğrulama hatası', password-policy.ts:6,8, api-client.ts:40 'İstek başarısız (...)'. İstemci `data.code`'a hiç bakmıyor. Oysa projede kod→çeviri deseni zaten var (pay/share/[token]/page.tsx:43-60 switch, resolution/shared.tsx KNOWN_ERROR_CODES).

**Etki:** EN arayüzü seçen misafir en kritik anlarda (yanlış parola, e-posta zaten kayıtlı, bağlantının süresi dolmuş, zayıf parola) anlamadığı Türkçe metin görür. Ekran okuyucu da Türkçe cümleyi İngilizce sesle okur.

**Önerilen aksiyon:** src/lib/auth altına `useAuthErrorText()` hook'u ekleyin (resolution/shared.tsx deseni). Hook şu eşlemeleri yapsın: UNAUTHORIZED→auth.errors.invalidCredentials, EMAIL_TAKEN→auth.errors.emailTaken, RATE_LIMITED→auth.errors.rateLimited, VALIDATION_ERROR→auth.errors.validation, EMAIL_NOT_VERIFIED→auth.errors.emailNotVerified, SERVICE_UNAVAILABLE→auth.errors.unavailable. Bilinmeyen kodda sayfanın kendi `*.failed` anahtarını kullansın, sunucu metnini göstermesin. Login, register, reset ve PasskeyLoginButton bu hook'u kullansın; TR/EN auth.json'a `errors` bölümü eklenmeli.

**Yapılan düzeltme:** Added a useAuthErrorText() hook to AuthCard.tsx. It maps UNAUTHORIZED, EMAIL_TAKEN, RATE_LIMITED, POW_REQUIRED, VALIDATION_ERROR, SERVICE_UNAVAILABLE, EMAIL_NOT_VERIFIED and network errors to auth.errors.*. Unknown codes fall back to the page's own *.failed key, so server text is never shown. Login, register, forgot, reset and PasskeyLoginButton all use it. PasskeyLoginButton now calls passkeyErrorCode instead of passkeyErrorMessage, which returned hardcoded Turkish text. Its UNAUTHORIZED case shows passkey.failed. — dosyalar: `src/components/auth/AuthCard.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/reset-password/page.tsx`, `src/app/forgot-password/page.tsx`, `src/components/auth/PasskeyLoginButton.tsx`

## F47 — Auth alan kenarlıkları beyaz zeminde ~1.47:1 kontrastta (3:1 altında)

| Alan                | Değer                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                       |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                 |
| Konum               | `src/app/login/page.tsx:95`                                                                                                                                                                                                                                                |
| Diğer konumlar      | `src/app/login/page.tsx:110`, `src/app/register/page.tsx:73`, `src/app/register/page.tsx:87`, `src/app/register/page.tsx:103`, `src/app/register/page.tsx:120`, `src/app/forgot-password/page.tsx:36`, `src/app/reset-password/page.tsx:65`, `src/components/ui/ui.tsx:21` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                       |
| Prensip             | accessibility · WCAG 1.4.11 Non-text Contrast                                                                                                                                                                                                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                      |
| WCAG                | 1.4.11                                                                                                                                                                                                                                                                     |
| Renk/tema           | Evet — onaylandı ve uygulandı                                                                                                                                                                                                                                              |
| Efor                | S                                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | area:auth                                                                                                                                                                                                                                                                  |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**                                                                                                                                                                                                                                    |

**Kanıt:** login/page.tsx:95 ve :110, register :73/:87/:103/:120, forgot :36, reset :65 `border border-gray-300` kullanıyor. #D1D5DB beyaz kart (bg-white) üzerinde ≈1.47:1 kontrast veriyor. Input'ların dolgusu yok; alanın sınırını gösteren tek görsel öğe bu kenarlık. Ortak ui.tsx:21 inputClass'taki `border-gray-400` (#9CA3AF ≈2.5:1) de 3:1'in altında.

**Etki:** Az gören ya da güneş altında telefon kullanan kullanıcı boş alanların sınırını ayırt etmekte zorlanır ve dokunma hedefini tahmin etmek zorunda kalır.

**Önerilen aksiyon:** Kenarlık rengini ≥3:1 bir griye çekin (ör. `border-gray-500` #6B7280 ≈4.8:1). Bu bir renk sınıfı değişikliğidir ve kullanıcı renk/temaya dokunulmasını istemediği için ayrıca onay gerekir. Renk dışı bir alternatif 1.4.11'i karşılamaz (kenarlığı kalınlaştırmak kontrastı değiştirmez). Onay çıkmazsa bulgu kayıt altında bırakılmalı.

## F48 — Giriş → Kayıt / Şifremi unuttum geçişinde redirect bağlamı kayboluyor; kayıt her zaman ana sayfaya atıyor

| Alan                | Değer                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                |
| Durum               | Doğrulandı                                                                                                                                                          |
| Konum               | `src/app/login/page.tsx:149`                                                                                                                                        |
| Diğer konumlar      | `src/app/login/page.tsx:115`, `src/app/register/page.tsx:41`, `src/app/register/page.tsx:144`, `src/app/checkout/page.tsx:121`, `src/components/cart/useCart.ts:24` |
| Kullanıcılar        | misafir                                                                                                                                                             |
| Prensip             | robustness · task conformance                                                                                                                                       |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                               |
| Efor                | S                                                                                                                                                                   |
| Kaynak denetçiler   | area:auth                                                                                                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                                        |

**Kanıt:** login/page.tsx:149 `<Link href="/register">` ve :115 `<Link href="/forgot-password">` gelen `?redirect=` değerini iletmiyor. register/page.tsx'te redirect okunmuyor; :41 `router.push("/")` sabit. :144'teki 'Giriş Yap' bağlantısı da parametresiz. Buna karşın checkout/page.tsx:121-124 401 alınca seçimi `/login?redirect=...` olarak URL'de taşıyor; useCart.ts:24 de aynı deseni kullanıyor.

**Etki:** Hesabı olmayan misafir checkout → giriş → 'Kayıt Ol' yolunu izlediğinde seçili tesis, oda, tarih ve kişi bilgisini kaybeder. Kayıttan sonra ana sayfaya düşer ve aramayı baştan yapmak zorunda kalır; bu sırada teklif fiyatı da değişebilir.

**Önerilen aksiyon:** login/page.tsx'te `const redirect = safeRedirect(searchParams.get('redirect'))` değerini hesaplayın. Register ve forgot bağlantılarını `href={redirect !== '/' ? `/register?redirect=${encodeURIComponent(redirect)}` : '/register'}` biçiminde yazın. register/page.tsx bu değeri okusun, başarıda `router.push(safeRedirect(...))` çağırsın ve :144'teki giriş bağlantısı parametreyi geri taşısın.

**Yapılan düzeltme:** Login computes the redirect with safeRedirect(useSearchParam('redirect')) and passes it through withRedirect() on the register and forgot-password links. Register reads the parameter, goes there after success (router.push(redirect), or through the Continue link on the success screen), and its 'Giriş Yap' link carries the parameter back. The forgot-password 'Girişe dön' link carries it too. — dosyalar: `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`, `src/components/auth/AuthCard.tsx`

## F49 — Kayıt sonrası doğrulama e-postası ve rezervasyon için doğrulama şartı hiç bildirilmiyor

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | High                                                                             |
| Durum               | Doğrulandı                                                                       |
| Konum               | `src/app/register/page.tsx:41`                                                   |
| Diğer konumlar      | `src/app/api/auth/register/route.ts:50`, `src/app/api/auth/register/route.ts:56` |
| Kullanıcılar        | misafir                                                                          |
| Prensip             | robustness · observability                                                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                   |
| Renk/tema           | Hayır                                                                            |
| Efor                | M                                                                                |
| Kaynak denetçiler   | area:auth                                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: auth)                                              |

**Kanıt:** register/page.tsx:41-42 `router.push("/"); router.refresh();` başarı sonrası hiçbir mesaj göstermiyor. Sunucu api/auth/register/route.ts:50 `issueEmailToken(user, AuthTokenKind.EMAIL_VERIFY)` ile e-posta gönderiyor ve :56 `emailVerified: false` döndürüyor, ancak istemci bu alanı okumuyor. Hiçbir .tsx dosyasında doğrulanmamış hesap için banner yok.

**Etki:** Yeni misafir doğrulama e-postası beklemesi gerektiğini bilmez. İlk rezervasyon denemesinde checkout'ta, akışın en hassas adımında, doğrulama hatasıyla karşılaşır ve akış orada kopar.

**Önerilen aksiyon:** register/page.tsx başarı dalında `data.user.emailVerified === false` ise hedef sayfaya sessionStorage bayrağıyla (URL'de e-posta taşımadan) geçin; orada kapatılabilir bir `Status` şeridi gösterin: 'Hesabınız oluşturuldu. E-posta adresinize doğrulama bağlantısı gönderdik; rezervasyon yapabilmek için 24 saat içinde bağlantıya tıklayın.' Ek olarak /api/user/me yanıtına `emailVerified` ekleyin; Header altında doğrulanmamış hesaplar için ResendVerificationButton içeren kalıcı bir 'E-postanızı doğrulayın' şeridi gösterin.

**Yapılan düzeltme:** After a successful register with user.emailVerified===false, the page no longer jumps to the home page. It shows a register.successTitle card: a role=status notice saying a verification link was sent to {email} and must be clicked within 24 hours to book, a 'Devam et' link to the safe redirect, a spam-folder hint and a ResendVerificationButton. It also calls router.refresh() so the header picks up the signed-in session. No email is put in the URL or in sessionStorage. The persistent 'verify your email' strip in the Header and the emailVerified field in /api/user/me belong to other owners and are in crossOwner. — dosyalar: `src/app/register/page.tsx`

## F50 — Kayıt akışı redirect parametresini kaybediyor; yeni kullanıcı checkout veya davet bağlamından kopuyor

| Alan                | Değer                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                 |
| Durum               | Doğrulandı                                                                                                                                                           |
| Konum               | `src/app/register/page.tsx:41`                                                                                                                                       |
| Diğer konumlar      | `src/app/login/page.tsx:149`, `src/app/login/page.tsx:63`, `src/app/register/page.tsx:144`, `src/app/checkout/page.tsx:123`, `src/app/pay/share/[token]/page.tsx:77` |
| Kullanıcılar        | misafir                                                                                                                                                              |
| Prensip             | robustness · task conformance                                                                                                                                        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                |
| Efor                | S                                                                                                                                                                    |
| Kaynak denetçiler   | lens:nav                                                                                                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                                         |

**Kanıt:** register/page.tsx:41 `router.push("/");` başarıda her zaman ana sayfaya gidiyor. login/page.tsx:149 `<Link href="/register">` ve register/page.tsx:144 `<Link href="/login">` mevcut `?redirect=` değerini taşımıyor. checkout/page.tsx:123 ve pay/share/[token]/page.tsx:77 kullanıcıyı `/login?redirect=…` adresine gönderiyor. Ek olarak login/page.tsx:63-64 parola yolunda redirect doğrulanmadan `router.push(redirect)` yapılıyor; passkey yolu (:142) ise `startsWith("/") && !startsWith("//")` kontrolü uyguluyor.

**Etki:** Checkout'ta ya da bölünmüş ödeme davetinde girişe yönlenen, hesabı olmayan misafir 'Kayıt Ol'a bastığında dönüş adresi silinir; kayıttan sonra ana sayfaya düşer, seçtiği ilan, tarih ve davet bağlantısı kaybolur. İlk rezervasyonu en çok yeni kullanıcılar yaptığı için dönüşüm doğrudan etkilenir.

**Önerilen aksiyon:** Ortak bir `safeRedirect(raw)` yardımcı fonksiyonu yazın (`raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/"`). login/page.tsx:63'te ve passkey onSuccess'te bunu kullanın. login:149 bağlantısını `/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}` yapın; register sayfası parametreyi okuyup :41'de `router.push(safeRedirect(redirect))` uygulasın ve :144 giriş bağlantısı da parametreyi taşısın.

**Yapılan düzeltme:** Same fix as F48 and F35. — dosyalar: `src/app/login/page.tsx`, `src/app/register/page.tsx`

## F83 — Sunucu hata mesajları her dilde Türkçe: İngilizce arayüzde 'E-posta veya parola hatalı' / 'Bu e-posta adresi zaten kayıtlı'

| Alan                | Değer                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                         |
| Durum               | Gözlemlendi                                                                                                                                                                                  |
| Konum               | `src/app/login/page.tsx:61`                                                                                                                                                                  |
| Diğer konumlar      | `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts`, `src/app/register/page.tsx`, `src/lib/http/errors.ts`, `src/lib/auth/account.ts`, `src/app/reset-password/page.tsx` |
| Kullanıcılar        | tümü                                                                                                                                                                                         |
| Prensip             | accessibility · Dix Learnability — Familiarity; dil tutarlılığı                                                                                                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                        |
| WCAG                | 3.1.2 Language of Parts (AA)                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                        |
| Efor                | M                                                                                                                                                                                            |
| Kaynak denetçiler   | runtime:auth                                                                                                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                                                                 |

**Kanıt:** RUNTIME: /login mobile EN (html lang=en), yanlış parola -> role=alert 'E-posta veya parola hatalı', alert'te lang özniteliği yok (login2.mjs). Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/login-wrong-mobile-en.png. /register mobile EN, mevcut e-posta -> 'Bu e-posta adresi zaten kayıtlı' (register-en.mjs, ekran register-exists-mobile-en.png aynı klasörde). Gecikme mesajı istemcide çevrilirken (login.delayed) sunucu mesajları ham geçiriliyor. KOD: login/page.tsx:61 'data.error ?? t(...)', register/page.tsx:39 aynı desen; route.ts:67 ve register/route.ts:46 sabit Türkçe metin; errors.ts:154 'Doğrulama hatası'; account.ts:266 'Bağlantı geçersiz veya süresi dolmuş' (reset sayfasında da ham gösteriliyor).

**Etki:** İngilizce konuşan misafirler en kritik anda (giriş/kayıt hatası) anlamadıkları bir dille karşılaşır; ekran okuyucu Türkçe metni İngilizce telaffuz kurallarıyla okur.

**Önerilen aksiyon:** İstemcide hata 'code' alanını i18n anahtarına eşleyin (UNAUTHORIZED -> auth.login.invalidCredentials, EMAIL_TAKEN -> auth.register.emailTaken, VALIDATION_ERROR+fieldErrors -> alan anahtarları, RATE_LIMITED, POW_REQUIRED, link geçersiz -> auth.reset.invalidLink); bilinmeyen kodlarda çevrilmiş genel mesaja düşün, ham sunucu metnini göstermeyin.

**Yapılan düzeltme:** Same fix as F46. — dosyalar: `src/components/auth/AuthCard.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/components/auth/PasskeyLoginButton.tsx`

## F84 — Parola ile girişte redirect parametresi doğrulanmıyor: giriş sonrası harici siteye yönlendirme (açık yönlendirme)

| Alan                | Değer                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                              |
| Durum               | Gözlemlendi                                                                                                       |
| Konum               | `src/app/login/page.tsx:63`                                                                                       |
| Diğer konumlar      | `src/components/auth/PasskeyLoginButton.tsx`                                                                      |
| Kullanıcılar        | tümü                                                                                                              |
| Prensip             | robustness · Dix Robustness — güvenli varsayılan / Task conformance; tutarsız doğrulama (passkey yolu doğruluyor) |
| Sezgisel madde      | H5 — Hata önleme                                                                                                  |
| Renk/tema           | Hayır                                                                                                             |
| Efor                | S                                                                                                                 |
| Kaynak denetçiler   | runtime:auth                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                      |

**Kanıt:** RUNTIME (login API page.route ile mock'landı, gerçek kimlik bilgisi yok; example.org istekleri yerelde fulfill edildi): /login?redirect=https%3A%2F%2Fexample.org%2Fphish -> gönderim sonrası final URL https://example.org/phish; /login?redirect=%2F%2Fexample.org%2Fphish -> http://example.org/phish; /login?redirect=%2Fcart -> /cart (probe redirect.mjs). KOD: login/page.tsx:63-64 'router.push(redirect)' kontrolsüz; aynı dosyada passkey onSuccess (satır 141-142) startsWith('/') && !startsWith('//') kontrolü yapıyor.

**Etki:** Saldırgan, sitenin gerçek giriş sayfasına işaret eden bir bağlantıyla kullanıcıyı başarılı girişten hemen sonra sahte bir 'oturum süresi doldu, tekrar giriş yapın' sayfasına taşıyabilir; kullanıcı güveni ve hesap güvenliği zarar görür. İki giriş yolunun farklı davranması da tutarsızlık.

**Önerilen aksiyon:** Tek bir safeRedirect(raw) yardımcı fonksiyonu yazın (yalnız '/' ile başlayan, '//' ve '/\\' ile başlamayan, new URL(raw, location.origin).origin === location.origin olan yolları kabul etsin, aksi halde '/'); hem parola hem passkey hem de (ileride) kayıt akışında kullanın.

**Yapılan düzeltme:** Same fix as F35 (safeRedirect with the same-origin check). — dosyalar: `src/components/auth/AuthCard.tsx`, `src/app/login/page.tsx`

## F85 — Gönderim sırasında düğmenin disabled yapılması klavye odağını body'ye düşürüyor (5 formda)

| Alan                | Değer                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                             |
| Durum               | Gözlemlendi                                                                                                                                      |
| Konum               | `src/app/login/page.tsx:128`                                                                                                                     |
| Diğer konumlar      | `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/components/auth/PasskeyLoginButton.tsx` |
| Kullanıcılar        | tümü                                                                                                                                             |
| Prensip             | accessibility · Dix Robustness — Observability; klavye sürekliliği                                                                               |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                            |
| WCAG                | 2.4.3 Focus Order (A)                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                            |
| Efor                | S                                                                                                                                                |
| Kaynak denetçiler   | runtime:auth                                                                                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                                                                                     |

**Kanıt:** RUNTIME desktop TR: /login 'Giriş Yap' tıklanınca hata sonrası document.activeElement=body (login1.mjs); /register düğmeye odaklanıp Enter -> hata sonrası focus=body (register.mjs); /forgot-password düğme+Enter -> hem hata ('a@b') hem başarı sonrası focus=body (forgot.mjs); /reset-password düğme+Enter -> 4 senaryonun hepsinde focus=body (reset.mjs); 'Passkey ile giriş' Enter -> bekleme ve hata sonrası focus=body (passkey.mjs). Yalnız parola alanında Enter'a basıldığında odak alanda kalıyor (login2.mjs). KOD: login:128, register:135, forgot:41, reset:70, PasskeyLoginButton:49 'disabled={...}'.

**Etki:** Klavye ve ekran okuyucu kullanıcıları her hatalı gönderimden sonra sayfanın başına (header'a) düşer, forma geri dönmek için ~10 Tab gerekir; hata mesajı ile alan arasındaki bağ kopar.

**Önerilen aksiyon:** Düğmede disabled yerine aria-disabled='true' + handleSubmit içinde 'if (submitting) return' koruması kullanın (odak düğmede kalır). Hata geldiğinde odağı hata kutusuna (tabIndex=-1) veya ilk hatalı alana taşıyın; başarı durumunda (forgot 'sent', reset 'done') başlığa/mesaja odaklayın.

**Yapılan düzeltme:** In all five forms and in the passkey button, disabled is replaced by aria-disabled plus aria-busy (submitButtonProps), so keyboard focus stays on the button. Double submission is blocked with an 'if (busy) return' guard. Visually it looks the same: the aria-disabled: variants reuse the same gray-300/gray-700 values as the existing disabled: classes. On field errors, focus moves to the first invalid field. Success and error messages are announced through the Notice role=status/alert regions, and focus stays on the button. — dosyalar: `src/components/auth/AuthCard.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/components/auth/PasskeyLoginButton.tsx`

## F86 — Kayıt ve şifre sıfırlamada alan bazlı sunucu hataları atılıp yalnız 'Doğrulama hatası' gösteriliyor

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | High                                                                                  |
| Durum               | Gözlemlendi                                                                           |
| Konum               | `src/app/register/page.tsx:39`                                                        |
| Diğer konumlar      | `src/lib/http/errors.ts`, `src/app/reset-password/page.tsx`, `src/app/login/page.tsx` |
| Kullanıcılar        | misafir                                                                               |
| Prensip             | robustness · Dix Robustness — Observability (sistem durumunun anlaşılabilirliği)      |
| Sezgisel madde      | H9 — Hata mesajları                                                                   |
| WCAG                | 3.3.1 Error Identification (A)                                                        |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | runtime:auth                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                          |

**Kanıt:** RUNTIME /register desktop TR (register.mjs, hiçbir istek hesap oluşturmadı): parola 'abcdefgh' -> yanıt 400 fieldErrors.password ['Parola en az bir rakam içermelidir'] ama alert 'Doğrulama hatası'; Ad='A' -> yanıt fieldErrors.firstName ['Ad en az 2 karakter olmalıdır'] ama alert yine 'Doğrulama hatası'. Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/register-weak-desktop-tr.png. /reset-password?token=invalid (veya token'sız) + geçerli parola -> 'Doğrulama hatası' (fieldErrors.token İngilizce zod metni) — reset.mjs, ekran reset-invalid-desktop-tr.png. /login e-posta 'a@b' (HTML type=email geçerli sayar, zod reddeder) -> 'Doğrulama hatası' (login1.mjs, login-ab-desktop.png). KOD: register/page.tsx:39 'data.error' kullanıyor, details.fieldErrors'ı okumuyor; errors.ts:154.

**Etki:** Kullanıcı hangi alanın neden hatalı olduğunu bilemez; ad için 2 karakter kuralı hiçbir yerde yazmadığından tek harfli ad giren kullanıcı tahmin yürütmek zorunda kalır, kayıt terk edilir.

**Önerilen aksiyon:** Yanıttaki details.fieldErrors'ı alan bazında state'e alın, ilgili input altında id'li hata metni olarak gösterin (aria-describedby + aria-invalid), ilk hatalı alana odaklayın; formErrors veya bilinmeyen durumda üstte özet gösterin. Reset'te fieldErrors.token varsa 'Bağlantı geçersiz' akışına (bkz. ayrı bulgu) yönlendirin.

**Yapılan düzeltme:** Same fix as F36. In reset-password, fieldErrors.password shows as an error on the password field and that field gets focus. fieldErrors.token, or a VALIDATION_ERROR without field errors, switches the page to the invalid-link state. — dosyalar: `src/app/register/page.tsx`, `src/app/reset-password/page.tsx`

## F87 — Kayıt: parola kuralı yalnız düşük kontrastlı placeholder'da, ad/soyad kuralı hiç yok; ipucu ilişkilendirilmemiş ve yazarken hata gibi beliriyor

| Alan                | Değer                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Severity            | High                                                                              |
| Durum               | Gözlemlendi                                                                       |
| Konum               | `src/app/register/page.tsx:119`                                                   |
| Diğer konumlar      | `messages/tr/auth.json`                                                           |
| Kullanıcılar        | misafir                                                                           |
| Prensip             | learnability · Dix Learnability — Predictability / Synthesizability (feedforward) |
| Sezgisel madde      | H13 — Feedforward                                                                 |
| WCAG                | 3.3.2 Labels or Instructions (A); 1.4.3 Contrast (AA, placeholder)                |
| Renk/tema           | Hayır                                                                             |
| Efor                | S                                                                                 |
| Kaynak denetçiler   | runtime:auth                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: auth)                                                      |

**Kanıt:** RUNTIME /register desktop TR (register.mjs): yazmadan önce kural yalnız placeholder 'En az 8 karakter ve bir rakam' (renk rgb(156,163,175) beyaz üzerinde ≈2.5:1), main metninde kural yok, aria-describedby=null; ad/soyad için '2 karakter' kuralı sayfada yok. 'abc' yazınca 12px kırmızı (rgb(220,38,38)) ipucu ilk tuşta beliriyor; id yok, aria-describedby yok, aria-invalid yok, canlı bölge değil. Geçerli parola girilince ipucu kayboluyor, olumlu onay yok. 'abcdefgh' ile ipucu görünürken bile form gönderilebiliyor (minLength=8 karşılandı, rakam kuralı istemcide engellenmiyor). Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/full/shots/015-anon-tr-mobile-_register.png ve probes/auth/register-weak-desktop-tr.png. Not: reset sayfası kuralı kalıcı alt başlıkta gösteriyor (tutarsız).

**Etki:** Kullanıcı yazmaya başlayınca kuralı göremez (hatırlamak zorunda), düşük görüşlü kullanıcı placeholder'ı hiç okuyamayabilir; gereksiz sunucu turları ve 'Doğrulama hatası' ile karşılaşır.

**Önerilen aksiyon:** Kuralı input altında kalıcı yardımcı metin olarak (text-gray-600, ≥14px, id='password-rules') gösterip aria-describedby ile bağlayın; placeholder'ı kaldırın. Kuralları kontrol listesi olarak (✓ 8+ karakter, ✓ bir rakam) metin+ikonla anlık durumla gösterin; hatayı blur/submit'te gösterin; istemcide pattern='(?=.*\\d).{8,}' veya submit öncesi kontrolle gönderimi engelleyin. Ad/Soyad için minLength={2} ve görünür ipucu ekleyin. Renk teması değişmeden çözülür.

**Yapılan düzeltme:** The low-contrast placeholder is gone. The password rule (register.passwordHint) is now permanent help text under the field, linked with aria-describedby (password-hint, text-gray-600). The red hint that appeared on the first keystroke is removed: the error appears on blur or submit, is linked with aria-describedby and sets aria-invalid. Submission is blocked on the client. First and last name got minLength=2 and a visible 'En az 2 karakter' hint. The name grid now stacks to one column on mobile (grid-cols-1 sm:grid-cols-2). The live checklist with check icons was not added; the hint plus field error covers the requirement without any color change. — dosyalar: `src/app/register/page.tsx`, `src/components/auth/AuthCard.tsx`

## F88 — Geçersiz/süresi dolmuş şifre sıfırlama bağlantısı: form önceden doğrulanmadan gösteriliyor, hata sonrası kartta hiçbir çıkış bağlantısı yok

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | High                                                                  |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/app/reset-password/page.tsx:76`                                  |
| Diğer konumlar      | `src/app/api/auth/password/reset/route.ts`, `src/lib/auth/account.ts` |
| Kullanıcılar        | tümü                                                                  |
| Prensip             | robustness · Dix Robustness — Recoverability                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                     |
| WCAG                | 3.3.3 Error Suggestion (AA)                                           |
| Renk/tema           | Hayır                                                                 |
| Efor                | M                                                                     |
| Kaynak denetçiler   | runtime:auth                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: auth)                                   |

**Kanıt:** RUNTIME desktop TR (reset.mjs): /reset-password?token=invalid -> normal 'Yeni şifre belirleyin' formu; 'abcdefg1' girilince 'Doğrulama hatası'; 25+ karakterlik sahte token ile 'Bağlantı geçersiz veya süresi dolmuş'; token'sız URL'de de form açılıyor ve 'Doğrulama hatası'. Her durumda main içindeki bağlantılar [] (ne 'Yeni bağlantı iste' ne 'Girişe dön'). Sahte token + rakamsız parola -> önce parola hatası gösteriliyor, kullanıcı düzeltince bağlantının geçersiz olduğunu öğreniyor. Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/reset-invalid-desktop-tr.png. Reset token TTL 30 dk (app-config.ts:362) → süresi dolmuş bağlantı sık durum.

**Etki:** Hesabına erişemeyen kullanıcı yeni parola yazma emeğinden sonra çıkmaz sokağa düşer; yeni bağlantı istemek için header > Giriş yap > Şifremi unuttum yolunu kendisi bulmalı.

**Önerilen aksiyon:** Token yoksa/biçimsizse formu hiç göstermeyin; sayfa açılışında (veya ilk gönderimde) 'bağlantı geçersiz' durumunda formu gizleyip açık bir hata kartı gösterin: 'Bu bağlantı geçersiz ya da süresi dolmuş (30 dk).' + birincil düğme 'Yeni bağlantı iste' (/forgot-password) + 'Girişe dön'. İdeal: GET /api/auth/password/reset/check?token= ile ön doğrulama.

**Yapılan düzeltme:** Same fix as F37. The page does not check the token with the server before showing the form, because GET /api/auth/password/reset/check does not exist (needs backend/API change). A malformed token is caught on the client, and an expired one is caught on the first submit. The client now checks the password before sending, so the user no longer fixes the password first and only then learns the link is invalid. — dosyalar: `src/app/reset-password/page.tsx`

## F378 — Parola kuralı alana bağlı değil, iki ekranda tutarsız; kayıtta kural ilk tuşta kırmızı hata olarak beliriyor ve duyurulmuyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/app/register/page.tsx:122`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Diğer konumlar      | `src/app/register/page.tsx:119`, `src/app/reset-password/page.tsx:51`, `src/app/reset-password/page.tsx:61`, `messages/tr/auth.json:23`, `messages/tr/auth.json:40`, `src/app/register/page.tsx:122`, `src/app/reset-password/page.tsx:57`, `src/app/search/page.tsx:331`, `src/components/account/PasskeyManager.tsx:146`, `src/components/booking/BookingMessages.tsx:179`, `src/components/cart/SplitPayPanel.tsx:339`, `src/components/booking/BookingActions.tsx:327` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Prensip             | learnability · consistency / WCAG 3.3.2 Labels or Instructions                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| WCAG                | 3.3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | area:auth, lens:forms, lens:a11y, lens:copy                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Kanıt:** register/page.tsx:119 kural placeholder'da ('En az 8 karakter ve bir rakam'); :122-123 `{password.length > 0 && (!/[0-9]/.test(password) || password.length < 8) && <p className="mt-1 text-xs text-red-600">...}` ilk karakterde kırmızı hata olarak çıkıyor. Bu paragrafın id'si yok, input'ta aria-describedby ya da aria-invalid yok, canlı bölge değil. Hangi koşulun eksik olduğu ayrıştırılmıyor; koşul sağlanınca metin yalnızca kayboluyor. reset-password/page.tsx:51'de kural yalnız subtitle içinde, alandan uzakta duruyor; :61 yalnız `minLength={8}` kullanıyor, rakam kontrolü ve canlı ipucu yok.

**Etki:** Misafir henüz yazmayı bitirmeden 'hata yaptın' sinyali alır ve eksik koşulu tahmin etmek zorunda kalır. Sıfırlamada kural farklı bir yerde ve biçimde sunulur; 'abcdefgh' girildiğinde uyarı ancak sunucu hatasıyla gelir. Ekran okuyucu kullanıcısı kuralı alanla birlikte duymaz.

**Önerilen aksiyon:** src/components/auth/PasswordField.tsx oluşturun ve `Field` ile sarın. Etiketin altında kalıcı bir hint olsun: id='password-hint' ile iki maddelik kontrol listesi ('En az 8 karakter', 'En az 1 rakam'). Her maddede ✓/○ ikonu ve `sr-only` 'karşılandı/karşılanmadı' metni bulunsun (bilgi yalnız renge bağlı kalmasın). Listeyi input'a aria-describedby ile bağlayın. Hata stilini ve aria-invalid'i yalnız blur ya da gönderimde uygulayın. Placeholder'ı kaldırın. register ve reset aynı bileşeni ve aynı gönderim kontrolünü kullansın.

## F379 — Kayıt formunda gizlilik/KVKK aydınlatma bağlantısı yok

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Medium                                                              |
| Durum               | Doğrulandı (2 kaynak birleşti)                                      |
| Konum               | `src/app/register/page.tsx:133`                                     |
| Diğer konumlar      | `src/app/privacy/page.tsx:1`, `src/components/layout/Footer.tsx:52` |
| Kullanıcılar        | misafir                                                             |
| Prensip             | learnability · predictability (feedforward)                         |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                          |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | area:auth, runtime:auth                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                        |

**Kanıt:** register/page.tsx:127-147 gönder düğmesi ile 'Zaten hesabınız var mı?' arasında veri işleme ya da aydınlatma metni bulunmuyor. /privacy sayfası mevcut (src/app/privacy/page.tsx) ama yalnız Footer.tsx:52'de bağlantı olarak duruyor.

**Etki:** Misafir ad ve e-posta verirken verisinin nasıl işleneceğini görmeden karar verir. Bu güveni zedeler ve KVKK'nın veri toplama anında aydınlatma beklentisiyle uyuşmaz.

**Önerilen aksiyon:** Gönder düğmesinin (:133) hemen üstüne `<p className="text-xs text-gray-600">` ekleyin. İçeriği `t.rich('register.privacy', { link: (c) => <Link href="/privacy" target="_blank" rel="noopener">{c}<span className="sr-only"> (yeni sekmede açılır)</span></Link> })` olsun: 'Hesap oluşturarak Gizlilik ve KVKK Aydınlatma Metni'ni okuduğunuzu kabul edersiniz.' (TR/EN). Mevcut renk sınıflarını kullanın.

## F380 — Şifre sıfırlamada ağ hatası formu kalıcı olarak 'Kaydediliyor...' durumunda bırakıyor

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Doğrulandı (2 kaynak birleşti)               |
| Konum               | `src/app/reset-password/page.tsx:20`         |
| Kullanıcılar        | tümü                                         |
| Prensip             | robustness · responsiveness / recoverability |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü               |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:auth, runtime:auth                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** reset-password/page.tsx:18 `setState("saving")` sonrasında :20-24 `await fetch(...)` try/catch dışında kalıyor. fetch reddedilirse işlenmemiş bir promise hatası oluşur ve durum 'saving'de kalır. :70 `disabled={state === "saving"}` düğmeyi kalıcı devre dışı bırakır, :73 etiketi 'Kaydediliyor...' olarak kalır.

**Etki:** Bağlantısı kopan kullanıcı sonu gelmeyen bir 'Kaydediliyor...' görür ve parolanın değişip değişmediğini bilemez. İstek sunucuya ulaştıysa token tüketilmiştir; sayfayı yenileyip tekrar denediğinde 'Bağlantı geçersiz' alır.

**Önerilen aksiyon:** Submit gövdesini try/catch ile sarın. catch'te `setState("idle")` yapın ve `setError(t('reset.networkError'))` ile şu metni gösterin: 'Bağlantı kurulamadı. Parolanız değişmiş olabilir: önce yeni parolanızla giriş yapmayı deneyin, olmazsa yeni bağlantı isteyin.' Notice içinde /login ve /forgot-password bağlantılarını verin.

## F381 — Başarı ve yükleniyor durumları ekran okuyucuya güvenilir biçimde iletilmiyor (canlı bölge içerikle birlikte ekleniyor)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                      |
| Konum               | `src/components/auth/AuthCard.tsx:37`                                                                                                                                                                                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/app/forgot-password/page.tsx:47`, `src/app/verify-email/page.tsx:29`, `src/app/reset-password/page.tsx:40`, `src/app/login/page.tsx:131`, `src/app/reset-password/page.tsx:37`, `src/components/account/PasskeyManager.tsx:111`, `src/components/booking/BookingActions.tsx:365`, `src/components/account/SessionManager.tsx:99`, `src/components/compliance/NoticeForm.tsx:62`, `src/components/compliance/AppealForm.tsx:57` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages                                                                                                                                                                                                                                                                                                                                                                                          |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                                                                                                                                                                                                                      |
| WCAG                | 4.1.3                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Kaynak denetçiler   | area:auth, lens:a11y                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                                        |

**Kanıt:** AuthCard.tsx:37 `role={kind === "error" ? "alert" : "status"}`, ancak Notice yalnız koşullu render ediliyor: forgot-password:47 `{state === "sent" && <Notice ...>}`, verify-email:34 (pending durumundaki role=status <p> öğesi :29'da kaldırılıp yerine yeni bir Notice ekleniyor), reset-password:40. İçerikle aynı anda DOM'a eklenen role=status bölgeleri ekran okuyucularca tutarlı biçimde duyurulmuyor. Yükleniyor bilgisi yalnız düğme etiketinde (login :131-135, forgot :44, reset :73); aria-live ya da aria-busy yok.

**Etki:** Ekran okuyucu kullanıcısı 'Bağlantı gönderildi' ya da 'E-posta adresiniz doğrulandı' mesajını kaçırabilir. Saniyeler süren 'Tarayıcı doğrulanıyor' aşamasında sistemin çalıştığını bilmez ve tekrar dener ya da vazgeçer.

**Önerilen aksiyon:** AuthCard'a ilk render'dan itibaren DOM'da duran bir canlı bölge ekleyin (ui.tsx:144 `Status` bileşenini kullanın ya da `<div role="status" aria-live="polite" aria-atomic="true">`). Başarı ve yükleniyor metinlerini bu bölgenin içeriğine yazın. verify-email'de pending, ok ve error metinlerini aynı kalıcı öğe içinde değiştirin. Gönderim sırasında `<form aria-busy={submitting}>` ekleyin.

## F388 — Şifremi unuttum 'gönderildi' durumu: form etkin kalıyor, tekrar gönderim önceki bağlantıyı geçersiz kılıyor ve bu söylenmiyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                   |
| Durum               | Doğrulandı                                                                               |
| Konum               | `src/app/forgot-password/page.tsx:47`                                                    |
| Diğer konumlar      | `src/lib/auth/account.ts:227`, `src/lib/auth/account.ts:296`, `messages/tr/auth.json:35` |
| Kullanıcılar        | tümü                                                                                     |
| Prensip             | robustness · observability (feedforward)                                                 |
| Sezgisel madde      | H13 — Feedforward                                                                        |
| Renk/tema           | Hayır                                                                                    |
| Efor                | S                                                                                        |
| Kaynak denetçiler   | area:auth                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                             |

**Kanıt:** forgot-password/page.tsx:24-47 'sent' durumunda form ve 'Bağlantı gönder' düğmesi etkin kalıyor; Notice formun altında beliriyor. auth.json:35 metni spam ipucu içermiyor ve yalnız son bağlantının geçerli olduğunu söylemiyor. Her yeni istek öncekileri geçersiz kılıyor (account.ts issueEmailToken `tx.authToken.updateMany({... usedAt: null }, data: { usedAt: now })`). E-posta başına saatte 3'ü aşan istekler sessizce gönderilmiyor (account.ts allowResetEmail, AUTH_RESET_PER_EMAIL_MAX=3).

**Etki:** E-postayı bekleyemeyen kullanıcı düğmeye tekrar basar. İlk gelen e-postadaki bağlantı artık geçersiz olduğu için reset sayfasında 'Bağlantı geçersiz' döngüsüne girer. 4. denemeden sonra 'gönderildi' mesajı çıksa da e-posta hiç gelmez.

**Önerilen aksiyon:** 'sent' durumunda formu gizleyin; Notice metnini şöyle güncelleyin: 'Hesap varsa sıfırlama bağlantısı gönderildi. Spam klasörünü de kontrol edin. Yalnızca en son gönderilen bağlantı geçerlidir.' (TR/EN). Altına 60 sn geri sayımlı 'Yeniden gönder' ve 'Farklı e-posta dene' (formu geri açan) `Button`'ları ekleyin. Sınır aşımını açıklamak hesap varlığını sızdırmaz, çünkü sayaç e-posta bazlı.

## F389 — İş kanıtı (PoW) doğrulaması belirsiz: neden ve süre bilgisi, iptal yok; kayıt ve şifremi unuttumda ayrı bir etiket bile yok

| Alan                | Değer                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                  |
| Durum               | Doğrulandı                                                                                                                              |
| Konum               | `src/app/login/page.tsx:49`                                                                                                             |
| Diğer konumlar      | `src/lib/auth/pow-solver.ts:65`, `src/lib/auth/pow-fetch.ts:21`, `src/app/register/page.tsx:138`, `src/app/forgot-password/page.tsx:44` |
| Kullanıcılar        | tümü                                                                                                                                    |
| Prensip             | robustness · responsiveness                                                                                                             |
| Sezgisel madde      | H15 — Performans                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                   |
| Efor                | M                                                                                                                                       |
| Kaynak denetçiler   | area:auth                                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                            |

**Kanıt:** login/page.tsx:49-52 POW_REQUIRED geldiğinde kullanıcı yalnız düğmede :132 'Tarayıcı doğrulanıyor...' görüyor. pow-solver.ts:65-73 `maxIterations = 2 ** 26`; ilerleme bildirimi ya da AbortSignal yok. Zorluk AUTH_POW_DIFFICULTY_BITS varsayılan 16, en çok 28 (app-config). register ve forgot'ta pow-fetch.ts:21 bulmacayı sessizce çözüyor; etiket 'Kaydediliyor...' / 'Gönderiliyor...' olarak kalıyor.

**Etki:** Düşük donanımlı telefondaki kullanıcı saniyelerce, zorluk artarsa çok daha uzun süre, değişmeyen bir düğmeye bakar. Sayfanın donduğunu sanıp yeniler ya da terk eder; işlemi iptal edemez.

**Önerilen aksiyon:** `postJsonWithPow`'a `onChallenge?: () => void` geri çağrısı, `solvePow`'a `signal?: AbortSignal` ve `onProgress?` parametreleri ekleyin. Login, register ve forgot'ta doğrulama başlarken kalıcı Status bölgesine şu metni yazın: 'Güvenliğiniz için kısa bir tarayıcı doğrulaması yapılıyor; birkaç saniye sürebilir.' Yanına bir 'İptal' `Button`'ı koyun (abort edip formu idle'a döndürsün). İsteğe bağlı olarak hesaplamayı bir Web Worker'a taşıyın.

## F390 — Gecikmeli giriş (LOGIN_DELAYED): geri sayım yok, düğme hemen yeniden etkin; EN metninde çoğul hatası

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Doğrulandı                                             |
| Konum               | `src/app/login/page.tsx:57`                            |
| Diğer konumlar      | `messages/en/auth.json:14`, `messages/tr/auth.json:14` |
| Kullanıcılar        | tümü                                                   |
| Prensip             | robustness · responsiveness / error prevention         |
| Sezgisel madde      | H5 — Hata önleme                                       |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:auth                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** login/page.tsx:57-58 `throw new Error(t("login.delayed", { seconds: data.details?.retryAfterSeconds ?? 1 }))`, ardından :68 `setSubmitting(false)` düğmeyi anında yeniden etkinleştiriyor; saniye değeri sabit metin, geri sayım yok. messages/en/auth.json:14 'Try again in {seconds} seconds.' ICU çoğul kuralı içermiyor; AUTH_LOGIN_DELAY_BASE_MS=1000 olduğu için '1 seconds' çıktısı gerçekten oluşuyor.

**Etki:** Kullanıcı süre dolmadan tekrar dener ve her seferinde aynı hatayı alır; ne kadar beklediğini takip edemez. EN kullanıcısı dilbilgisi hatası görür.

**Önerilen aksiyon:** LOGIN_DELAYED geldiğinde `retryAfterSeconds` değerini state'e alıp setInterval ile geri sayın. Bu süre boyunca gönder düğmesini `aria-disabled` tutun ve etiketi `t('login.retryIn', {seconds})` ('Tekrar deneyin (12)') olarak gösterin. Süre dolunca Status bölgesine 'Şimdi tekrar deneyebilirsiniz' yazın. EN metni: `Try again in {seconds, plural, one {# second} other {# seconds}}.`

## F391 — Ev sahibi ve yönetici girişten sonra kendi paneline değil misafir ana sayfasına düşüyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Doğrulandı                                                                    |
| Konum               | `src/app/login/page.tsx:63`                                                   |
| Diğer konumlar      | `src/app/login/page.tsx:141`, `src/components/auth/PasskeyLoginButton.tsx:31` |
| Kullanıcılar        | ev sahibi, admin                                                              |
| Prensip             | flexibility · task conformance                                                |
| Sezgisel madde      | H7 — Esneklik/verim                                                           |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:auth                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** login/page.tsx:13 `LoginResponse.user.role` alınıyor ama :63 `.get("redirect") ?? "/"` rolden bağımsız olarak ana sayfaya gidiyor. Passkey yolunda :140-142 `onSuccess` rolü almıyor; oysa passkey-client.ts loginWithPasskey `{ user: { id, role } }` döndürüyor ve PasskeyLoginButton.tsx:31 bu değeri atıyor.

**Etki:** Ev sahibi ve yönetici her girişte önce misafir arama sayfasına düşer ve kendi kuyruğuna/takvimine geçmek için ek gezinme yapar. Günde birkaç kez giriş yapan kullanıcı için tekrarlayan bir sürtünmedir.

**Önerilen aksiyon:** redirect yoksa hedefi role göre seçin: `role === 'ADMIN' ? '/admin' : role === 'HOST' ? '/host' : '/'`. PasskeyLoginButton'da `const { user } = await loginWithPasskey(); onSuccess(user.role)` yapın ve `onSuccess` imzasını `(role: string) => void` olarak değiştirin.

## F392 — Ağ/sunucu hatalarında ham teknik istisna metni gösteriliyor ('Failed to fetch', JSON ayrıştırma hatası, 'PoW çözülemedi')

| Alan                | Değer                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                       |
| Durum               | Doğrulandı                                                                                                                   |
| Konum               | `src/app/login/page.tsx:67`                                                                                                  |
| Diğer konumlar      | `src/app/login/page.tsx:38`, `src/app/register/page.tsx:37`, `src/app/register/page.tsx:44`, `src/lib/auth/pow-solver.ts:73` |
| Kullanıcılar        | tümü                                                                                                                         |
| Prensip             | robustness · recoverability                                                                                                  |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                          |
| Renk/tema           | Hayır                                                                                                                        |
| Efor                | S                                                                                                                            |
| Kaynak denetçiler   | area:auth                                                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                 |

**Kanıt:** login/page.tsx:38 `data: (await res.json())`, JSON olmayan bir yanıtta (502/504 HTML sayfası) SyntaxError fırlatıyor; ağ kesildiğinde fetch `TypeError: Failed to fetch` fırlatıyor. :67 `setError(err instanceof Error ? err.message : ...)` bu metni olduğu gibi gösteriyor. pow-solver.ts:73 `throw new Error("PoW çözülemedi")` de aynı yoldan kullanıcıya ulaşıyor. register/page.tsx:37 ve :44'te aynı desen var.

**Etki:** Zayıf mobil bağlantıdaki kullanıcı 'Failed to fetch' ya da `Unexpected token '<'` gibi İngilizce ve teknik bir metin görür. Sorunun bağlantıda olduğunu ve yeniden denemesi gerektiğini anlamaz; 'PoW' jargonu da güveni zedeler.

**Önerilen aksiyon:** Login ve register'da `res.json()` çağrısını `.catch(() => ({}))` ile sarın. catch bloğunda `err.message`'ı göstermek yerine: `TypeError` için t('errors.network') ('Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.'), 5xx ya da gövdesiz yanıt için t('errors.server') ('Şu an işlem yapılamıyor, birazdan tekrar deneyin.'), kodlu yanıtlar için useAuthErrorText eşlemesini kullanın.

## F393 — Checkout/sepetten girişe yönlendirilen misafire neden giriş istendiği ve sonra ne olacağı söylenmiyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Medium                                                               |
| Durum               | Doğrulandı                                                           |
| Konum               | `src/app/login/page.tsx:81`                                          |
| Diğer konumlar      | `src/app/checkout/page.tsx:121`, `src/components/cart/useCart.ts:24` |
| Kullanıcılar        | misafir                                                              |
| Prensip             | learnability · predictability (feedforward)                          |
| Sezgisel madde      | H13 — Feedforward                                                    |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | area:auth                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** login/page.tsx:80-81 başlık ve alt başlık sabit: 'Giriş Yap' / 'Rezervasyonlarınıza ve favorilerinize erişin.' `redirect` parametresi yalnız :63'te yönlendirme için okunuyor. checkout/page.tsx:121-124 ve useCart.ts:24 kullanıcıyı açıklama göstermeden `router.replace` ile login'e gönderiyor.

**Etki:** 'Rezervasyon yap'a basan misafir kendini aniden giriş formunda bulur. Seçiminin korunup korunmadığını ve giriş sonrası nereye döneceğini bilmediği için bir kısmı akışı terk eder.

**Önerilen aksiyon:** login/page.tsx'te `safeRedirect` sonucu '/checkout', '/cart' ya da '/pay' ile başlıyorsa formun üstünde bir Status/Notice bilgi kutusu gösterin: t('login.continueBooking') 'Rezervasyonunuzu tamamlamak için giriş yapın veya hesap oluşturun. Seçimleriniz korunur; giriş sonrası kaldığınız yere döneceksiniz.' (TR/EN).

## F394 — Parola alanlarında göster/gizle denetimi yok

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Doğrulandı                                                            |
| Konum               | `src/app/login/page.tsx:105`                                          |
| Diğer konumlar      | `src/app/register/page.tsx:113`, `src/app/reset-password/page.tsx:59` |
| Kullanıcılar        | tümü                                                                  |
| Prensip             | robustness · error prevention                                         |
| Sezgisel madde      | H5 — Hata önleme                                                      |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | area:auth                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                          |

**Kanıt:** login/page.tsx:105, register/page.tsx:113 ve reset-password/page.tsx:59'da `type="password"` sabit. Göster/gizle düğmesi yok; kayıt ve sıfırlamada parola tekrar alanı da yok.

**Etki:** Mobil klavyede otomatik düzeltme ya da ı/i, ş/s karışıklığıyla yanlış yazılan parola kayıt veya sıfırlama sırasında fark edilmez. Kullanıcı sonraki girişte 'parola hatalı' alır ve şifre sıfırlama akışına zorlanır.

**Önerilen aksiyon:** PasswordField bileşenine input'un sağında `type="button"` bir 'Göster'/'Gizle' düğmesi ekleyin: `aria-pressed`, `aria-controls` input id'si, en az 44×44 px dokunma alanı, `focusRing`. Tıklamada input type'ını password/text arasında değiştirin, form gönderilirken password'e döndürün. login, register ve reset bu bileşeni kullansın.

## F395 — Durum geçişlerinde odak yönetimi yok; gönder düğmesi devre dışı kalınca odak kayboluyor

| Alan                | Değer                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                                                     |
| Durum               | Doğrulandı                                                                                                                                                                                                                                 |
| Konum               | `src/app/login/page.tsx:128`                                                                                                                                                                                                               |
| Diğer konumlar      | `src/app/register/page.tsx:135`, `src/app/forgot-password/page.tsx:41`, `src/app/reset-password/page.tsx:37`, `src/app/reset-password/page.tsx:70`, `src/components/auth/PasskeyLoginButton.tsx:49`, `src/components/auth/AuthCard.tsx:23` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                       |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order                                                                                                                                                                                                     |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                      |
| WCAG                | 2.4.3                                                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                                      |
| Efor                | S                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | area:auth                                                                                                                                                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                               |

**Kanıt:** login/page.tsx:128 `disabled={submitting}`: klavyeyle etkinleştirilen düğme devre dışı kalınca tarayıcı odağı body'ye düşürüyor. :66-68 catch bloğu odağı geri taşımıyor (hata role=alert ile duyuruluyor ama odak konumu kayboluyor). register :135, forgot :41, reset :70 ve PasskeyLoginButton :49'da aynı durum var. reset-password/page.tsx:37-48 `state === "done"` olduğunda formu tümüyle kaldırıp yeni bir kart çiziyor; odak kayboluyor.

**Etki:** Klavye ve ekran okuyucu kullanıcısı başarısız bir girişten sonra sayfadaki konumunu kaybeder ve düzeltme yapacağı alana yeniden gezinmek zorunda kalır. Şifre sıfırlama sonrasında yeni içeriği ve 'Giriş yap' bağlantısını ayrıca araması gerekir.

**Önerilen aksiyon:** Gönderim sırasında `disabled` yerine `aria-disabled={submitting}` kullanın ve handler başına `if (submitting) return;` koruması ekleyin. Hata kutusuna `tabIndex={-1}` ve ref verip hata oluşunca `ref.current?.focus()` çağırın (alan hatasında ilk hatalı input'a odaklanın). AuthCard'daki h1'e `tabIndex={-1}` ve isteğe bağlı `autoFocusTitle` prop'u ekleyin; reset done, forgot sent ve verify sonuç ekranlarında başlığa odaklanın.

## F396 — 'E-posta zaten kayıtlı' hatası kurtarma eylemi sunmuyor

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Medium                                                                   |
| Durum               | Doğrulandı                                                               |
| Konum               | `src/app/register/page.tsx:39`                                           |
| Diğer konumlar      | `src/app/api/auth/register/route.ts:46`, `src/app/register/page.tsx:127` |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | robustness · recoverability                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                      |
| WCAG                | 3.3.3                                                                    |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | area:auth                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                             |

**Kanıt:** register/page.tsx:38-39 `throw new Error(data.error ?? ...)`: sunucu register/route.ts:46 `ConflictError("Bu e-posta adresi zaten kayıtlı", "EMAIL_TAKEN")` ile kod döndürse de istemci `data.code`'a bakmıyor. :127-131 hata kutusu düz metin; giriş ya da şifre sıfırlama bağlantısı içermiyor.

**Etki:** Daha önce hesap açtığını unutan misafir ne yapacağını bilemez. Kartın altındaki küçük 'Giriş Yap' bağlantısını fark etmezse başka bir e-postayla ikinci hesap açar ve rezervasyon geçmişi bölünür.

**Önerilen aksiyon:** `data.code === "EMAIL_TAKEN"` durumunda hata kutusunda çevrilmiş mesajla birlikte iki bağlantı gösterin: `<Link href="/login">{t('register.loginInstead')}</Link>` ve `<Link href="/forgot-password">{t('login.forgotPassword')}</Link>`. Varsa redirect parametresini de taşıyın. E-posta değerini URL'ye koymadan sessionStorage ile hedef formun email alanına önceden doldurun.

## F397 — Şifre sıfırlamada geçersiz, süresi dolmuş veya eksik token için yeni bağlantı isteme yolu yok

| Alan                | Değer                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                    |
| Durum               | Doğrulandı                                                                                                |
| Konum               | `src/app/reset-password/page.tsx:76`                                                                      |
| Diğer konumlar      | `src/app/reset-password/page.tsx:19`, `src/app/reset-password/page.tsx:33`, `src/lib/auth/account.ts:266` |
| Kullanıcılar        | tümü                                                                                                      |
| Prensip             | robustness · recoverability                                                                               |
| Sezgisel madde      | H9 — Hata mesajları                                                                                       |
| Renk/tema           | Hayır                                                                                                     |
| Efor                | S                                                                                                         |
| Kaynak denetçiler   | lens:nav                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                              |

**Kanıt:** Dosya 80 satır; adayın verdiği 120/134/142/177 numaraları yanlış. Token yalnız gönderimde okunuyor: 19 `const token = new URLSearchParams(window.location.search).get("token") ?? "";`. Token yoksa da form (52-75) gösteriliyor. Hata yalnız 76'da `{error && <Notice kind="error">{error}</Notice>}` ile çıkıyor ve yanında /forgot-password bağlantısı yok. Giriş bağlantısı yalnız başarı durumunda var (41-45). Sunucu tarafı: boş token zod'da (route.ts:9 `token: z.string().min(20)`) düşüyor ve genel "Doğrulama hatası" dönüyor. Sayfa yalnız `fieldErrors.password`'ü okuyor (33), bu yüzden kullanıcı nedeni bilmeden genel mesajı görüyor. Geçersiz veya süresi dolmuş token için account.ts:266/271 "Bağlantı geçersiz veya süresi dolmuş" dönüyor; bu metin sabit Türkçe, en dilinde de çevrilmeden çıkıyor.

**Etki:** Süresi dolmuş, kullanılmış ya da bozuk bağlantıyla gelen kullanıcı yeni şifreyi yazıp gönderiyor, sonra hata alıyor ve sayfada çıkış yolu yok. Adresi bilmiyorsa sıfırlama akışını yeniden başlatamıyor, ya da girişe gidip 'Şifremi unuttum'u kendisi bulması gerekiyor. Token hiç yoksa mesaj yalnızca 'Doğrulama hatası' oluyor ve nedeni anlaşılmıyor.

**Önerilen aksiyon:** src/app/reset-password/page.tsx: (1) `const [token, setToken] = useState<string | null>(null)` ekleyin ve `useEffect` içinde `window.location.search`'ten okuyun. Token boşsa ya da 20 karakterden kısaysa formu göstermeyin: `<AuthCard title={t("reset.invalidTitle")}>` içinde `<Notice kind="error">{t("reset.invalidLink")}</Notice>` ile `<Link href="/forgot-password">{t("reset.requestNew")}</Link>` gösterin; bağlantı, başarı ekranındaki giriş bağlantısıyla (42) aynı sınıfları kullansın. (2) submit içinde `res.status === 400` iken `fieldErrors.password` yoksa (yani token hatasıysa) `setError` yanında `tokenInvalid` bayrağını true yapın ve 76'daki Notice'in altına aynı /forgot-password bağlantısını koyun. Mesajı sunucu metni yerine `t("reset.invalidLink")` ile gösterin, böylece en dilinde de çevrilmiş olur. (3) messages/tr/auth.json ve messages/en/auth.json içindeki `reset` nesnesine `invalidTitle`, `invalidLink` ve `requestNew` anahtarlarını ekleyin. Renk değişikliği gerekmiyor.

## F398 — E-posta doğrulama sayfası her başarısızlığı (ağ, 5xx, 429, zaten kullanılmış token) 'bağlantı geçersiz' olarak gösteriyor; tekrar dene yok

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Medium                                                    |
| Durum               | Doğrulandı                                                |
| Konum               | `src/app/verify-email/page.tsx:23`                        |
| Diğer konumlar      | `src/lib/auth/account.ts:271`, `messages/tr/auth.json:52` |
| Kullanıcılar        | misafir, ev sahibi                                        |
| Prensip             | robustness · observability                                |
| Sezgisel madde      | H9 — Hata mesajları                                       |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | area:auth                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** verify-email/page.tsx:23-24 `.then((res) => setState(res.ok ? "ok" : "error")).catch(() => setState("error"))`: ağ hatası, 503, 429 ve daha önce kullanılmış token (account.ts consumeToken, aynı ValidationError) tek bir 'error' durumuna düşüyor ve auth.json:52 'Bağlantı geçersiz veya süresi dolmuş.' metni gösteriliyor. Tekrar dene düğmesi yok.

**Etki:** Bağlantıya ikinci kez tıklayan ve aslında zaten doğrulanmış misafir 'geçersiz' mesajını görüp doğrulamanın başarısız olduğunu sanır. Geçici bir sunucu sorununda geçerli bağlantısını çöpe atar; yeniden gönderme UI'ı da olmadığından çıkmaza girer.

**Önerilen aksiyon:** Durumları ayırın. Fetch hatası, 5xx ya da 429 için 'retryable' durumu: 'Şu an doğrulanamadı' metni ve aynı token'la POST'u tekrarlayan bir 'Tekrar dene' `Button`'ı. 400 için 'invalid' durumu: ResendVerificationButton. Sunucuda verifyEmail, kullanılmış token'ın sahibi zaten doğrulanmışsa 200 `{ alreadyVerified: true }` dönsün; istemci bu durumda t('verify.alreadyVerified') gösterip 'Giriş yap' / 'Ana sayfa' bağlantısı versin.

## F471 — HTML ve sunucu e-posta kuralları uyumsuz: 'a@b' istemcide geçiyor, sunucu reddediyor; şifremi unuttum bunu ağ hatası gibi raporluyor

| Alan                | Değer                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                         |
| Durum               | Gözlemlendi                                                                                    |
| Konum               | `src/app/forgot-password/page.tsx:19`                                                          |
| Diğer konumlar      | `src/app/api/auth/password/forgot/route.ts`, `src/app/login/page.tsx`, `messages/tr/auth.json` |
| Kullanıcılar        | tümü                                                                                           |
| Prensip             | robustness · Dix Robustness — Observability; hata mesajının doğruluğu                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                            |
| WCAG                | 3.3.1 Error Identification (A)                                                                 |
| Renk/tema           | Hayır                                                                                          |
| Efor                | S                                                                                              |
| Kaynak denetçiler   | runtime:auth                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                   |

**Kanıt:** RUNTIME /forgot-password mobile TR (forgot.mjs): 'a@b' -> yanıt 400 fieldErrors.email ['Geçerli bir e-posta girin'] ama ekranda 'İstek gönderilemedi, tekrar deneyin.' (alanla ilişkisiz, aria-invalid=null). Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/forgot-ab-mobile-tr.png. /login 'a@b' -> 'Doğrulama hatası' (login1.mjs). KOD: forgot-password/page.tsx:19 202 dışındaki her yanıtı 'error' sayıyor.

**Etki:** Kullanıcı yazım hatasını fark etmek yerine aynı adresle tekrar tekrar dener; mesaj sorunun kendisinde değil ağda olduğunu ima ediyor.

**Önerilen aksiyon:** 400 VALIDATION_ERROR'da alan altında 'Geçerli bir e-posta adresi girin (ör. ad@alanadi.com)' gösterin; ağ/5xx için mevcut mesajı koruyun. İstemci kuralını sunucuyla hizalayın (ör. pattern='[^@\\s]+@[^@\\s]+\\.[^@\\s]+').

## F472 — Ağ/proxy hatasında ham teknik İngilizce mesaj gösteriliyor: 'Failed to fetch', 'Unexpected token '<'...'

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Medium                                                                   |
| Durum               | Gözlemlendi                                                              |
| Konum               | `src/app/login/page.tsx:67`                                              |
| Diğer konumlar      | `src/app/register/page.tsx`                                              |
| Kullanıcılar        | tümü                                                                     |
| Prensip             | robustness · Dix Robustness — Recoverability; Learnability — Familiarity |
| Sezgisel madde      | H9 — Hata mesajları                                                      |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | runtime:auth                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                             |

**Kanıt:** RUNTIME desktop TR, API isteği page.route ile yerelde kesildi (neterr.mjs): offline -> /login ve /register role=alert 'Failed to fetch'; HTML gövdeli 502 -> /login ve /register 'Unexpected token '<', "<html><bod"... is not valid JSON'. Aynı koşulda /forgot-password düzgün 'İstek gönderilemedi, tekrar deneyin.' gösteriyor (tutarsız). KOD: login/page.tsx:38 koşulsuz res.json(), :67 err.message doğrudan setError; register/page.tsx:37 ve :44 aynı desen.

**Etki:** Mobil ağda bağlantı kopan misafir anlamsız İngilizce teknik metin görür, ne olduğunu ve ne yapacağını bilemez.

**Önerilen aksiyon:** catch bloğunda yalnız bilinen/çevrilmiş mesajları gösterin: TypeError (fetch) -> t('common.networkError') 'Bağlantı kurulamadı, internetinizi kontrol edip tekrar deneyin'; res.json() başarısızsa -> t('login.failed'). navigator.onLine=false iken ayrıca belirtin.

## F473 — Hatalarda alanlar işaretlenmiyor: aria-invalid / aria-describedby yok, kenarlık değişmiyor

| Alan                | Değer                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                 |
| Durum               | Gözlemlendi                                                                                                                            |
| Konum               | `src/app/login/page.tsx:88`                                                                                                            |
| Diğer konumlar      | `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/components/auth/AuthCard.tsx` |
| Kullanıcılar        | tümü                                                                                                                                   |
| Prensip             | accessibility · Dix Robustness — Observability                                                                                         |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                  |
| WCAG                | 3.3.1 Error Identification (A), 1.3.1 Info and Relationships (A)                                                                       |
| Renk/tema           | Hayır                                                                                                                                  |
| Efor                | S                                                                                                                                      |
| Kaynak denetçiler   | runtime:auth                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                           |

**Kanıt:** RUNTIME /login desktop TR yanlış parola (guest@booking.test, 1 deneme): email/password aria-invalid=null, aria-describedby=null, e-posta kenarlığı rgb(209,213,219) (değişmedi) (login2.mjs). Boş gönderim ve 'abc' e-postası yalnız tarayıcı yerel balonuna dayanıyor, aria-invalid yok (login1.mjs). /register zayıf parola, /forgot 'a@b' ve /reset hatalarında da tüm input'lar aria-invalid=null (register.mjs, forgot.mjs). Hata kutusu formun altında ayrı bir div; hiçbir alana bağlı değil.

**Etki:** Ekran okuyucu kullanıcısı alana geri döndüğünde alanın hatalı olduğunu duymaz; görsel kullanıcı hangi alanın sorunlu olduğunu yalnız metinden çıkarmak zorunda.

**Önerilen aksiyon:** Her alan için hata state'i tutun: <input aria-invalid={!!err} aria-describedby={err ? 'email-error' : undefined}> + <p id='email-error'>; kenarlığa ek olarak hata ikonu/metin kullanın (renge tek başına dayanmayın). Kimlik hatasında (yanlış parola) her iki alanı da genel hata metnine describedby ile bağlayın.

## F474 — Mobilde form alanları 14px yazı ve 38px yükseklikte: iOS Safari odakta sayfayı yakınlaştırır, dokunma hedefi 44px altı

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                             |
| Durum               | Gözlemlendi                                                                                        |
| Konum               | `src/app/login/page.tsx:95`                                                                        |
| Diğer konumlar      | `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx` |
| Kullanıcılar        | misafir                                                                                            |
| Prensip             | accessibility · Dix Flexibility — Multi-modality / cihaz uyumu                                     |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                              |
| WCAG                | 2.5.5 Target Size Enhanced (AAA, öneri)                                                            |
| Renk/tema           | Hayır                                                                                              |
| Efor                | S                                                                                                  |
| Kaynak denetçiler   | runtime:auth                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                       |

**Kanıt:** RUNTIME mobile 390x844 TR (mobilemisc.mjs): /login, /register, /forgot-password, /reset-password tüm input'lar font-size 14px, yükseklik 38px; viewport meta 'width=device-width, initial-scale=1'. Kart içi metin bağlantıları 'Şifremi unuttum' 100x19, 'Kayıt Ol' 50x19, 'Girişe dön' 65x19 (Şifremi unuttum cümle içi değil, kendi satırında). KOD: input className 'px-3 py-2 text-sm'.

**Etki:** iPhone kullanıcısı her alana dokunduğunda sayfa yakınlaşır ve yatay kaydırma gerekir (başlıktaki bilinen taşmayla birleşince daha kötü); küçük bağlantılara isabet zorlaşır.

**Önerilen aksiyon:** Input'larda mobilde 'text-base sm:text-sm' (16px) ve 'py-2.5/min-h-[44px]' kullanın; 'Şifremi unuttum' ve 'Girişe dön' bağlantılarına 'inline-block py-3' ile ≥44px dokunma alanı verin.

## F475 — Parola göster/gizle yok (giriş, kayıt, sıfırlama) ve kayıt/sıfırlamada onay alanı da yok

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/app/login/page.tsx:103`                                              |
| Diğer konumlar      | `src/app/register/page.tsx`, `src/app/reset-password/page.tsx`            |
| Kullanıcılar        | tümü                                                                      |
| Prensip             | flexibility · Dix Flexibility — Customizability; Robustness — hata önleme |
| Sezgisel madde      | H5 — Hata önleme                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:auth                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** RUNTIME /login desktop TR: form içindeki buton/anahtar listesi yalnız ['Giriş Yap'] (login1.mjs); /register ve /reset-password formlarında da tek düğme submit; reset sayfası input listesi yalnız #password (mobilemisc.mjs). Yeni parola belirlenen iki ekranda girilen değeri doğrulamanın hiçbir yolu yok.

**Etki:** Mobil ağırlıklı misafirler küçük klavyede parola yazım hatası yapar; kayıt/sıfırlamada hatalı yazılan parola hesabı kullanılamaz hale getirir ve yeni bir sıfırlama döngüsüne yol açar.

**Önerilen aksiyon:** Her parola alanına type='button' aria-pressed'li 'Göster/Gizle' düğmesi ekleyin (aria-controls ile alana bağlı, ≥44px dokunma alanı); yeni parola alanlarında göster/gizle onay alanı yerine yeterli olur.

## F476 — Giriş/kayıt arasında görev bağlamı kayboluyor: redirect parametresi kayıt bağlantısına taşınmıyor, kayıt redirect'i yok sayıyor, girişte 'neden' bilgisi yok

| Alan                | Değer                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Severity            | Medium                                                                            |
| Durum               | Gözlemlendi                                                                       |
| Konum               | `src/app/login/page.tsx:149`                                                      |
| Diğer konumlar      | `src/app/register/page.tsx`, `src/app/forgot-password/page.tsx`                   |
| Kullanıcılar        | misafir                                                                           |
| Prensip             | flexibility · Dix Flexibility — Task migratability; Learnability — Predictability |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                 |
| Renk/tema           | Hayır                                                                             |
| Efor                | S                                                                                 |
| Kaynak denetçiler   | runtime:auth                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                      |

**Kanıt:** RUNTIME /login?redirect=%2Fcart desktop TR (misc.mjs): kart bağlantıları 'Şifremi unuttum -> /forgot-password', 'Kayıt Ol -> /register' (redirect düşüyor); sayfada sepete dönüleceğini belirten bağlam metni yok (yalnız genel alt başlık). /register?redirect=%2Fcart (API mock 201, hesap oluşmadı) gönderimden sonra navigasyon '/' (regredirect.mjs). /login?redirect=%2Fcart doğrudan giriş yolunda /cart'a dönüş çalışıyor (redirect.mjs). KOD: login/page.tsx:149 href='/register'; register/page.tsx:41 router.push('/').

**Etki:** Sepetten veya ödeme adımından gelen yeni kullanıcı kayıt olunca ana sayfaya atılır, sepetini/ilanını yeniden aramak zorunda kalır (rezervasyon dönüşümü düşer).

**Önerilen aksiyon:** Login sayfasında redirect'i Kayıt Ol ve Şifremi unuttum bağlantılarına (güvenli doğrulanmış haliyle) ekleyin; register sayfası redirect'i okuyup başarıda oraya gitsin. redirect varsa başlık altında 'Sepetinize devam etmek için giriş yapın' gibi bağlam metni gösterin.

## F477 — Kayıtta 'Bu e-posta adresi zaten kayıtlı' hatası çıkış yolu sunmuyor (Giriş yap / Şifremi unuttum bağlantısı yok)

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Gözlemlendi                                  |
| Konum               | `src/app/register/page.tsx:127`              |
| Diğer konumlar      | `src/app/api/auth/register/route.ts`         |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · Dix Robustness — Recoverability |
| Sezgisel madde      | H9 — Hata mesajları                          |
| WCAG                | 3.3.3 Error Suggestion (AA)                  |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | runtime:auth                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** RUNTIME /register desktop TR ve mobile EN, e-posta guest@booking.test (409, hesap oluşmadı): alert 'Bu e-posta adresi zaten kayıtlı', alert içinde bağlantı sayısı 0, odak body (register.mjs, register-en.mjs). Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/register-exists-desktop-tr.png. Ayrıca login ve forgot uçları hesap keşfine karşı genel mesaj verirken kayıt ucu (register/route.ts:46) hesabın varlığını açıkça doğruluyor — politika tutarsızlığı.

**Etki:** Hesabı olduğunu unutan misafir ne yapacağını bilemez; formun altındaki küçük 'Giriş Yap' bağlantısını kendisi keşfetmeli ve e-postayı yeniden yazmalı.

**Önerilen aksiyon:** EMAIL_TAKEN kodunda hata kutusuna 'Bu e-postayla bir hesabınız var. [Giriş yapın] veya [şifrenizi sıfırlayın]' bağlantılarını e-posta ön-dolu (/login?email=…&redirect=…) olarak ekleyin; hesap keşfi politikası gereği istenirse kayıt yanıtını da genel 'Doğrulama e-postası gönderildi' akışına çevirin.

## F478 — E-posta doğrulama sayfası ağ/sunucu hatasını da 'Bağlantı geçersiz veya süresi dolmuş' diye gösteriyor; yeniden dene yok

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/app/verify-email/page.tsx:23`                           |
| Kullanıcılar        | misafir                                                      |
| Prensip             | robustness · Dix Robustness — Observability / Recoverability |
| Sezgisel madde      | H9 — Hata mesajları                                          |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:auth                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** RUNTIME /verify-email?token=<25+ karakter> desktop TR, /api/auth/verify-email yerelde abort ve 503 olarak yanıtlandı (verifyoffline.mjs): her iki durumda alert 'Bağlantı geçersiz veya süresi dolmuş. Hesabınızdan yeni bir doğrulama e-postası isteyebilirsiniz.', main içinde button sayısı 0. KOD: satır 23 'setState(res.ok ? "ok" : "error")' ve 24 '.catch(() => setState("error"))' tüm hataları aynı kategoriye koyuyor.

**Etki:** Geçerli bir bağlantıyla gelen kullanıcı geçici bir kesintide bağlantısının bozuk olduğuna inanır ve (zaten mevcut olmayan) yeni e-posta arayışına girer.

**Önerilen aksiyon:** 400/410 'geçersiz bağlantı' ile 5xx/ağ hatasını ayırın; ikincisinde 'Şu an doğrulanamadı, bağlantınız hâlâ geçerli' + 'Tekrar dene' düğmesi gösterin (token tüketilmediği için güvenli).

## F1028 — Sıfırlama formunda parola yöneticisi için kullanıcı adı alanı yok

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Low                                  |
| Durum               | Doğrulandı (2 kaynak birleşti)       |
| Konum               | `src/app/reset-password/page.tsx:52` |
| Kullanıcılar        | tümü                                 |
| Prensip             | flexibility · substitutivity         |
| Sezgisel madde      | H7 — Esneklik/verim                  |
| Renk/tema           | Hayır                                |
| Efor                | M                                    |
| Kaynak denetçiler   | area:auth, runtime:auth              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** reset-password/page.tsx:52-67 form yalnız `autoComplete="new-password"` alanı içeriyor; hesabı belirten `autoComplete="username"` alanı yok.

**Etki:** Parola yöneticisi yeni şifreyi hangi hesaba ait olduğunu bilmeden kaydeder; sonraki girişte otomatik doldurma çalışmayabilir.

**Önerilen aksiyon:** Token ön-kontrol uç noktası (ya da reset sayfası açılışında hafif bir GET) hesabın e-postasını döndürsün; forma görünür salt okunur 'Hesap: ad@ornek.com' satırı ve `<input type="email" autoComplete="username" value={email} readOnly hidden>` ekleyin.

## F1034 — Oturumu açık kullanıcı /login ve /register'da yine form görüyor

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Low                                                            |
| Durum               | Doğrulandı                                                     |
| Konum               | `src/app/login/page.tsx:23`                                    |
| Diğer konumlar      | `src/app/register/page.tsx:16`, `src/components/ui/ui.tsx:183` |
| Kullanıcılar        | tümü                                                           |
| Prensip             | learnability · predictability                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                 |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:auth                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                   |

**Kanıt:** login/page.tsx:23-30 ve register/page.tsx:16-24 oturum kontrolü yapmıyor; ui.tsx:183 `useSession()` hazır ve Header aynı sayfada oturumu biliyor.

**Etki:** Yer imiyle /login'e gelen oturumu açık kullanıcı gereksiz yere tekrar giriş yapar ya da farkında olmadan başka hesaba geçer.

**Önerilen aksiyon:** İki sayfada `useSession()` ile `status === "ready" && user` ise formun yerine '{ad} olarak giriş yaptınız' metni, 'Devam et' (safeRedirect hedefi) birincil Button'ı ve 'Farklı hesapla giriş yap' (önce çıkış) ikincil Button'ı gösterin.

## F1035 — Auth sayfaları ortak primitifleri kullanmıyor: kopya kart düzeni, farklı odak ve disabled stilleri

| Alan                | Değer                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                         |
| Durum               | Doğrulandı                                                                                                                                  |
| Konum               | `src/app/login/page.tsx:73`                                                                                                                 |
| Diğer konumlar      | `src/app/register/page.tsx:50`, `src/components/auth/PasskeyLoginButton.tsx:50`, `src/components/ui/ui.tsx:18`, `src/styles/globals.css:61` |
| Kullanıcılar        | tümü                                                                                                                                        |
| Prensip             | learnability · consistency                                                                                                                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                       |
| Efor                | M                                                                                                                                           |
| Kaynak denetçiler   | area:auth                                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                |

**Kanıt:** login/page.tsx:73-79 ve register/page.tsx:50-56 AuthCard.tsx:16-26 düzenini kopyalıyor. Input odak stili `focus:ring-1 focus:ring-[#003580]` (login:95), ortak ui.tsx:18-19 `focus-visible:ring-2 … ring-offset-2`. Disabled: gönder düğmesi `disabled:bg-gray-300 disabled:text-gray-700` (login:129), PasskeyLoginButton.tsx:50 `disabled:opacity-60`. Denetçinin 'düğmelerde odak stili yok, tarayıcı varsayılanı' iddiası yanlış: styles/globals.css:61 ring sınıfı olmayan button/a öğelerine 2px outline veriyor.

**Etki:** Aynı kartta iki düğme bekleme durumunda farklı görünür; input odak halkası sitenin geri kalanından ince olduğu için odak takibi tutarsızdır; kopya düzenler zamanla ayrışır.

**Önerilen aksiyon:** login ve register'ı AuthCard'a taşıyın (yalnız yapı). Input'larda `focus:ring-1 focus:ring-[#003580] focus:border-[#003580]` yerine ui.tsx `focusRing` kullanın (aynı renk, yalnız kalınlık ve offset değişir). Düğmeleri `Button` primitifine taşımak ve disabled stillerini birleştirmek renk sınıfı değişikliği gerektirdiğinden kapsam dışında bırakın; yalnız yapısal birleştirme yapın.

## F1036 — Hidrasyon öncesi gönderim sayfayı yeniden yükleyip girilen veriyi siliyor

| Alan                | Değer                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                         |
| Durum               | Doğrulandı                                                                                                  |
| Konum               | `src/app/login/page.tsx:83`                                                                                 |
| Diğer konumlar      | `src/app/register/page.tsx:60`, `src/app/forgot-password/page.tsx:24`, `src/app/reset-password/page.tsx:52` |
| Kullanıcılar        | misafir                                                                                                     |
| Prensip             | robustness · responsiveness                                                                                 |
| Sezgisel madde      | H15 — Performans                                                                                            |
| Renk/tema           | Hayır                                                                                                       |
| Efor                | S                                                                                                           |
| Kaynak denetçiler   | area:auth                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                |

**Kanıt:** login/page.tsx:83 `<form onSubmit={handleSubmit}>` `action`/`method` içermiyor, input'larda `name` yok; sayfa 'use client' ve JS hidrasyonundan önce Enter yerel GET gönderimi yapar, sayfa yeniden yüklenir ve yazılanlar kaybolur (name olmadığı için parola URL'ye sızmaz). Aynı yapı register:60, forgot:24, reset:52.

**Etki:** Yavaş bağlantıda otomatik doldurup hemen Enter'a basan misafirin formu sıfırlanır ve nedenini anlamaz.

**Önerilen aksiyon:** `useSyncExternalStore(noopSubscribe, () => true, () => false)` ile `hydrated` bayrağı türetin (PasskeyLoginButton.tsx:13'teki kalıp); hidrasyondan önce gönder düğmesini `disabled` render edin. Alternatif olarak form'a `onSubmit` dışında `action="javascript:void 0"` yerine Next sunucu eylemi bağlayın.

## F1037 — Giriş e-posta alanı 'webauthn' belirtecini taşımıyor; passkey otomatik doldurma önerisi yok

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Low                                 |
| Durum               | Doğrulandı                          |
| Konum               | `src/app/login/page.tsx:92`         |
| Diğer konumlar      | `src/lib/auth/passkey-client.ts:25` |
| Kullanıcılar        | tümü                                |
| Prensip             | flexibility · substitutivity        |
| Sezgisel madde      | H7 — Esneklik/verim                 |
| Renk/tema           | Hayır                               |
| Efor                | M                                   |
| Kaynak denetçiler   | area:auth                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** login/page.tsx:92 `autoComplete="email"`; passkey-client.ts:25 yalnız modal `startAuthentication({ optionsJSON: options })`. Kurulu @simplewebauthn/browser 13.3.0 `useBrowserAutofill` seçeneğini destekliyor.

**Etki:** Passkey'i olan kullanıcı e-posta alanına dokunduğunda klavye önerisinde anahtarını görmez, ayrı düğmeyi bulmak zorunda kalır.

**Önerilen aksiyon:** login:92'yi `autoComplete="username webauthn"` yapın; passkey-client.ts'e `loginWithPasskeyAutofill()` ekleyin (`startAuthentication({ optionsJSON, useBrowserAutofill: true })`); login sayfası mount'ta `PublicKeyCredential.isConditionalMediationAvailable?.()` doğruysa bunu başlatsın, modal düğme ise öncesinde `WebAuthnAbortService` ile iptal edip devam etsin.

## F1038 — Ortak Field/inputClass/focusRing ve AuthCard/Notice auth formlarında tutarlı kullanılmıyor; odak göstergesi projenin geri kalanından zayıf

| Alan                | Değer                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                                                                                                  |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                           |
| Konum               | `src/app/login/page.tsx:95`                                                                                                                                                                                                                                                                          |
| Diğer konumlar      | `src/app/register/page.tsx:73`, `src/app/forgot-password/page.tsx:36`, `src/app/reset-password/page.tsx:65`, `src/components/auth/PasskeyLoginButton.tsx:50`, `src/components/ui/ui.tsx:18`, `src/components/booking/BookingWidget.tsx:170`, `src/components/search/DestinationAutocomplete.tsx:142` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                 |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                                                           |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                |
| Efor                | M                                                                                                                                                                                                                                                                                                    |
| Kaynak denetçiler   | area:shell                                                                                                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                         |

**Kanıt:** ui.tsx:18-21 focusRing `focus-visible:ring-2 ... ring-offset-2`; auth input'ları ise yerel sınıf kullanıyor: `rounded-lg border border-gray-300 ... focus:ring-1 focus:ring-[#003580]` (login :95/:110, register :73/:87/:103/:120, forgot :36, reset :65). Bu 1px'lik, offsetsiz bir halka. Auth düğmelerinde focusRing yok, varsayılan outline'a kalıyorlar (login :129, PasskeyLoginButton :50). login ve register AuthCard'ı kullanmayıp aynı düzeni kopyalıyor (login :73-79, register :50-56), hata kutusunu da Notice yerine elle yazılmış div ile gösteriyor (login :121, register :128).

**Etki:** Klavye kullanıcısı auth sayfalarında diğer sayfalardan farklı ve daha ince bir odak göstergesi görür. Kopyalanmış düzen ileride yapılacak düzeltmelerin (canlı bölge, odak) sayfalar arasında ayrışmasına yol açar.

**Önerilen aksiyon:** Auth input'larında `focus:ring-1 focus:ring-[#003580] focus:border-[#003580] focus:outline-none` yerine `focusRing` sabitini kullanın (renk aynı #003580 kalır, yalnız halka kalınlığı ve offset değişir). Submit düğmelerine `focusRing` ekleyin ya da `Button` primitifini kullanın. login ve register'ı `AuthCard` ile sarın, hata kutularını `Notice kind="error"` ile değiştirin. Kenarlık rengi bu düzeltmenin kapsamı dışında (bkz. kontrast bulgusu).

## F1039 — Girişte yazılan e-posta 'Şifremi unuttum' formuna taşınmıyor

| Alan                | Değer                                 |
| ------------------- | ------------------------------------- |
| Severity            | Low                                   |
| Durum               | Doğrulandı                            |
| Konum               | `src/app/login/page.tsx:115`          |
| Diğer konumlar      | `src/app/forgot-password/page.tsx:12` |
| Kullanıcılar        | tümü                                  |
| Prensip             | flexibility · task migratability      |
| Sezgisel madde      | H7 — Esneklik/verim                   |
| Renk/tema           | Hayır                                 |
| Efor                | S                                     |
| Kaynak denetçiler   | area:auth                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**          |

**Kanıt:** login/page.tsx:115 `<Link href="/forgot-password">` girilen `email`'i iletmiyor; forgot-password/page.tsx:12 `useState("")` boş başlıyor.

**Etki:** Şifresini hatırlayamayan mobil misafir e-postasını ikinci kez yazmak zorunda kalır; yazım hatası riski artar.

**Önerilen aksiyon:** Bağlantının onClick'inde e-postayı try/catch içinde `sessionStorage.setItem("auth.email", email)` ile saklayın; forgot sayfasında `useState(() => readStoredEmail())` ile başlangıç değeri yapın. Kişisel veriyi URL sorgusuna koymayın.

## F1040 — 360 px'te ad/soyad iki sütunda ~125 px'e sıkışıyor; kart dolgusu mobilde sabit p-8

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Low                                                                |
| Durum               | Doğrulandı                                                         |
| Konum               | `src/app/register/page.tsx:61`                                     |
| Diğer konumlar      | `src/components/auth/AuthCard.tsx:22`, `src/app/login/page.tsx:79` |
| Kullanıcılar        | misafir                                                            |
| Prensip             | accessibility · responsive layout                                  |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                       |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | area:auth                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                       |

**Kanıt:** register/page.tsx:61 `grid grid-cols-2 gap-3` her genişlikte iki sütun; :56 kart `p-8`. 360 px'te 360 − 32 (main px-4) − 64 (p-8) − 2 (border) − 12 (gap) ≈ 250 → her alan ≈125 px. AuthCard.tsx:22 ve login/page.tsx:79 aynı p-8.

**Etki:** Mobil misafir uzun adları dar alanda kesik görür, yazım hatasını fark etmesi zorlaşır; dolgu yatay alanın önemli bir kısmını tüketir.

**Önerilen aksiyon:** register/page.tsx:61'i `grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3` yapın; kartlarda (register:56, login:79, AuthCard:22) `p-6 sm:p-8` kullanın.

## F1041 — Ad/soyad alanlarında mobil klavye ipuçları eksik (autoCapitalize, spellCheck)

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Low                            |
| Durum               | Doğrulandı                     |
| Konum               | `src/app/register/page.tsx:66` |
| Diğer konumlar      | `src/app/register/page.tsx:80` |
| Kullanıcılar        | misafir                        |
| Prensip             | robustness · error prevention  |
| Sezgisel madde      | H5 — Hata önleme               |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:auth                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** register/page.tsx:66-74 ve :80-88 input'larında yalnız `autoComplete="given-name"/"family-name"` var; `autoCapitalize="words"` ve `spellCheck={false}` yok.

**Etki:** Mobil klavye ikinci adın baş harfini küçük bırakabilir; masaüstü tarayıcı Türkçe adların altını yazım hatası gibi çizip kullanıcıyı tedirgin edebilir.

**Önerilen aksiyon:** İki input'a `autoCapitalize="words"` ve `spellCheck={false}` ekleyin.

## F1042 — Kayıt ve sıfırlamada yükleniyor etiketi genel 'Kaydediliyor...'

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | Low                                                             |
| Durum               | Doğrulandı                                                      |
| Konum               | `src/app/register/page.tsx:138`                                 |
| Diğer konumlar      | `src/app/reset-password/page.tsx:73`, `messages/tr/auth.json:5` |
| Kullanıcılar        | tümü                                                            |
| Prensip             | learnability · predictability                                   |
| Sezgisel madde      | H12 — Feedback                                                  |
| Renk/tema           | Hayır                                                           |
| Efor                | S                                                               |
| Kaynak denetçiler   | area:auth                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                    |

**Kanıt:** register/page.tsx:138 `{submitting ? t("saving") : t("register.submit")}` ve reset-password/page.tsx:73 `t("saving")` → auth.json:5 'Kaydediliyor...'. Kayıtta postJsonWithPow (pow-fetch.ts) 429'da bulmaca çözerken de aynı etiket kalıyor; login ise :131-135 ayrı 'Tarayıcı doğrulanıyor...' gösteriyor.

**Etki:** Kullanıcı neyin kaydedildiğini anlamaz; PoW çözümü sürerken bekleme açıklanmaz ve tekrar tıklama ya da terk riski doğar.

**Önerilen aksiyon:** auth.json'a `register.submitting` ('Hesap oluşturuluyor…') ve `reset.submitting` ('Şifre değiştiriliyor…') ekleyip iki sayfada kullanın. Kayıtta PoW aşamasını göstermek için postJsonWithPow'a `onPow` callback'i ekleyip login'deki `login.verifying` metnini kullanın.

## F1043 — Şifre sıfırlama formunda 'Girişe dön' bağlantısı yok

| Alan                | Değer                                 |
| ------------------- | ------------------------------------- |
| Severity            | Low                                   |
| Durum               | Doğrulandı                            |
| Konum               | `src/app/reset-password/page.tsx:75`  |
| Diğer konumlar      | `src/app/forgot-password/page.tsx:49` |
| Kullanıcılar        | tümü                                  |
| Prensip             | learnability · consistency            |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü     |
| Renk/tema           | Hayır                                 |
| Efor                | S                                     |
| Kaynak denetçiler   | area:auth                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**          |

**Kanıt:** reset-password/page.tsx:50-78 form görünümünde gezinme bağlantısı yok (yalnız :41-45 'done' görünümünde var); aynı AuthCard'ı kullanan forgot-password/page.tsx:49-53 `<Link href="/login">{t("backToLogin")}</Link>` sunuyor.

**Etki:** Eski şifresini hatırlayan ya da vazgeçen kullanıcı kart içinden çıkamaz, Header'a gitmek zorunda kalır; kardeş sayfalarla tutarsız.

**Önerilen aksiyon:** reset-password/page.tsx:76'dan sonra forgot sayfasındaki `<p className="mt-6 text-center text-sm text-gray-600"><Link href="/login" …>{t("backToLogin")}</Link></p>` bloğunu aynen ekleyin.

## F1044 — Doğrulama sonuç ekranında başlık sonucu yansıtmıyor ve tek eylem ana sayfa

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Doğrulandı                                  |
| Konum               | `src/app/verify-email/page.tsx:28`          |
| Diğer konumlar      | `src/app/verify-email/page.tsx:36`          |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · predictability (feedforward) |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:auth                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** verify-email/page.tsx:28 `<AuthCard title={t("verify.title")}>` her durumda 'E-posta doğrulama'; :36-40 tek eylem `<Link href="/">{t("verify.home")}</Link>`; başarıda 'Giriş yap' ya da 'Aramaya devam et' gibi duruma özel sonraki adım yok.

**Etki:** E-postayı başka cihazda açan misafir doğrulamadan sonra oturumsuz ana sayfaya düşer; rezervasyona nasıl devam edeceği açık değildir.

**Önerilen aksiyon:** ok durumunda başlığı 'E-postanız doğrulandı' yapın; useSession() ile oturum varsa birincil eylem 'Aramaya devam et' (/search), yoksa 'Giriş yap' (/login) olsun. Hata durumundaki yeniden gönder eylemi Critical bulguda ele alınıyor.

## F1045 — Passkey bloğu hidrasyondan sonra ekleniyor; dikey ortalanmış kart yerinden kayıyor (CLS)

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Low                                                |
| Durum               | Doğrulandı                                         |
| Konum               | `src/components/auth/PasskeyLoginButton.tsx:17`    |
| Diğer konumlar      | `src/app/login/page.tsx:77`                        |
| Kullanıcılar        | tümü                                               |
| Prensip             | robustness · responsiveness (algılanan kararlılık) |
| Sezgisel madde      | H15 — Performans                                   |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | area:auth                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** PasskeyLoginButton.tsx:13 `useSyncExternalStore(noopSubscribe, passkeySupported, () => false)` ve :17 `if (!supported) return null;`. SSR'da render edilmeyen 'veya' ayıracı ile düğme (~90 px) hidrasyondan sonra ekleniyor. login/page.tsx:77 `items-center` dikey ortalama yaptığı için tüm kart yukarı kayıyor.

**Etki:** Yavaş mobil ağda e-posta alanına dokunmak üzere olan kullanıcı kart kaydığı için yanlış öğeye dokunabilir.

**Önerilen aksiyon:** PasskeyLoginButton'da `!supported` iken null yerine aynı yükseklikte bir yer tutucu render edin: `<div className="mt-4 min-h-[5.5rem]" aria-hidden="true" />`. Destek yoksa hidrasyondan sonra yer tutucu kalabilir ya da kaldırılabilir. Alternatif olarak login/page.tsx:77'de `items-center` yerine `items-start` ve sabit bir üst boşluk kullanın.

## F1046 — Passkey iptali ya da cihazda anahtar olmaması kırmızı role=alert hata olarak gösteriliyor

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Low                                                                         |
| Durum               | Doğrulandı                                                                  |
| Konum               | `src/components/auth/PasskeyLoginButton.tsx:21`                             |
| Diğer konumlar      | `messages/tr/auth.json:60`, `src/components/auth/PasskeyLoginButton.tsx:55` |
| Kullanıcılar        | tümü                                                                        |
| Prensip             | robustness · observability                                                  |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                           |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | area:auth                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** PasskeyLoginButton.tsx:21 `if (err.name === "NotAllowedError") return t("passkey.cancelled")` ve :54-57 `<p role="alert" className="mt-2 text-sm text-red-700">`. Kullanıcının bilinçli iptali ve 'bu cihazda anahtar yok' durumu (WebAuthn her ikisinde de NotAllowedError verir) 'iptal edildi veya zaman aşımına uğradı' diye alarm olarak gösteriliyor.

**Etki:** İşletim sistemi penceresini kapatıp parolayla devam etmek isteyen kullanıcı hata yapmış gibi uyarılır. Passkey'i olmayan kullanıcı neden çalışmadığını anlamaz.

**Önerilen aksiyon:** NotAllowedError için ayrı bir `notice` state'i tutun ve `role="status"` ile nötr metin (`text-gray-600`, mevcut sınıf) gösterin: 'Geçiş anahtarı kullanılmadı. Bu cihazda kayıtlı anahtarınız yoksa e-posta ve parolanızla giriş yapın.' role="alert" ve kırmızı stili gerçek sunucu/doğrulama hatalarına ayırın.

## F1047 — Parola ve passkey girişi eşzamanlı başlatılabiliyor; iki hata alanı birbirini temizlemiyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Low                                                        |
| Durum               | Doğrulandı                                                 |
| Konum               | `src/components/auth/PasskeyLoginButton.tsx:49`            |
| Diğer konumlar      | `src/app/login/page.tsx:128`, `src/app/login/page.tsx:120` |
| Kullanıcılar        | tümü                                                       |
| Prensip             | robustness · observability / consistency                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | area:auth                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                               |

**Kanıt:** PasskeyLoginButton.tsx:49 `disabled={busy}` yalnız kendi durumuna bakıyor; login/page.tsx:128 `disabled={submitting}` passkey durumunu bilmiyor. Hatalar ayrı tutuluyor: login :120-124 ve PasskeyLoginButton :54-58; biri başlarken diğeri temizlenmiyor.

**Etki:** Parola hatası ekranda dururken passkey denenirse iki hata aynı anda görünür; hangi yöntemin başarısız olduğu karışır. Ender ama kafa karıştırıcı.

**Önerilen aksiyon:** PasskeyLoginButton'a `disabled?: boolean` ve `onStart?: () => void` prop'ları ekleyin; login sayfası `disabled={submitting}` ve `onStart={() => setError(null)}` geçsin. Passkey busy iken login gönder düğmesini de devre dışı bırakmak için `onBusyChange` callback'i ekleyin.

## F1048 — 'Passkey' terimi açıklamasız ve Türkçe karşılığı olmadan kullanılıyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Low                                                    |
| Durum               | Doğrulandı                                             |
| Konum               | `src/components/auth/PasskeyLoginButton.tsx:52`        |
| Diğer konumlar      | `messages/tr/auth.json:57`, `messages/en/auth.json:57` |
| Kullanıcılar        | misafir                                                |
| Prensip             | learnability · familiarity                             |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                            |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:auth                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** PasskeyLoginButton.tsx:52 `{busy ? t("passkey.waiting") : t("passkey.login")}` → messages/tr/auth.json:57-58 'Passkey ile giriş', 'Passkey bekleniyor...'. Yanında açıklama, ikon ya da yardım metni yok. Türkçe iOS/Android arayüzleri 'geçiş anahtarı' terimini kullanıyor.

**Etki:** Terimi bilmeyen misafir düğmenin ne yaptığını anlamaz; ya hiç kullanmaz ya da açılan işletim sistemi penceresine hazırlıksız yakalanır. Parola yolu ayrıca mevcut olduğu için etki sınırlı.

**Önerilen aksiyon:** TR metinlerini 'Geçiş anahtarı (passkey) ile giriş' ve 'Geçiş anahtarı bekleniyor...' yapın. Düğmenin altına id='passkey-hint' olan `text-xs text-gray-600` bir açıklama ekleyip düğmeye aria-describedby ile bağlayın: 'Parola yerine parmak izi, yüz tanıma veya ekran kilidinizi kullanın.' EN: 'Use your fingerprint, face or screen lock instead of a password.'

## F1093 — Şifremi unuttum başarı durumu: form aktif kalıyor, sonraki adım yönlendirmesi yok, login'de yazılan e-posta taşınmıyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Low                                                                           |
| Durum               | Gözlemlendi                                                                   |
| Konum               | `src/app/forgot-password/page.tsx:47`                                         |
| Diğer konumlar      | `src/app/login/page.tsx`                                                      |
| Kullanıcılar        | tümü                                                                          |
| Prensip             | learnability · Dix Learnability — Predictability; Robustness — Responsiveness |
| Sezgisel madde      | H12 — Feedback                                                                |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | runtime:auth                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** RUNTIME /forgot-password mobile TR (forgot.mjs), var olmayan e-posta: 802 ms sonra role=status 'Hesap varsa şifre sıfırlama bağlantısı e-postayla gönderildi. Bağlantı 30 dakika geçerlidir.'; form görünür ve 'Bağlantı gönder' düğmesi aktif kalıyor, odak body, sayfada yalnız 'Girişe dön' bağlantısı (spam klasörü/yeniden gönderme süresi/demo 'Posta kutusu' yönlendirmesi yok). Status bölgesi gönderimden önce DOM'da yok (canlı bölge sayısı 0) — içerikle birlikte ekleniyor. Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/forgot-sent-mobile-tr.png. login/page.tsx:115 'Şifremi unuttum' bağlantısı yazılmış e-postayı taşımıyor.

**Etki:** Kullanıcı tekrar tekrar gönderir (her gönderim önceki bağlantıyı geçersiz kılar — issueEmailToken), e-postayı bulamazsa ne yapacağını bilmez; e-postasını iki kez yazmak zorunda kalır.

**Önerilen aksiyon:** Başarıda formu 'E-postanızı kontrol edin' durum kartıyla değiştirin (adres, 30 dk, spam klasörü, demo'da Posta kutusu bağlantısı, 60 sn sonra etkinleşen 'Yeniden gönder'); başlığa odaklanın; status bölgesini baştan DOM'da boş tutun. Login'deki e-postayı /forgot-password?email= ile ön-doldurun.

## F1094 — Hatalı giriş mesajı çözüm önermiyor; gecikme mesajı 'X saniye sonra' derken düğme hemen aktif, geri sayım yok

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | Low                                                                        |
| Durum               | Gözlemlendi                                                                |
| Konum               | `src/app/login/page.tsx:57`                                                |
| Kullanıcılar        | tümü                                                                       |
| Prensip             | robustness · Dix Robustness — Observability; Learnability — Predictability |
| Sezgisel madde      | H9 — Hata mesajları                                                        |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | runtime:auth                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                               |

**Kanıt:** RUNTIME /login desktop TR, rastgele var olmayan e-postayla 6 hızlı deneme (login3.mjs): 1-4. deneme 'E-posta veya parola hatalı' (çözüm/ 'Şifremi unuttum' önerisi yok, kalan deneme bilgisi yok); 5. deneme 429 LOGIN_DELAYED -> 'Çok fazla başarısız deneme. 1 saniye sonra tekrar deneyin.' ve düğme anında yeniden aktif (btnDisabledAfter=false), geri sayım yok. Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/login-delayed.png. Gecikme üstel artıyor (30 sn'ye kadar; account.ts:83-90).

**Etki:** Parolasını hatırlamayan kullanıcı sıfırlama yerine denemeye devam eder ve artan gecikmelere takılır; ne kadar beklemesi gerektiğini düğme durumundan anlayamaz.

**Önerilen aksiyon:** Kimlik hatası metnine 'Parolanızı mı unuttunuz? [Sıfırlayın]' bağlantısı (e-posta ön-dolu) ekleyin. LOGIN_DELAYED'de retryAfterSeconds boyunca düğmeyi aria-disabled tutup '{n} sn sonra tekrar deneyin' geri sayımını gösterin.

## F1095 — Passkey hata metni kök nedeni açıklamıyor; passkey'in ne olduğu/nasıl ekleneceği konusunda yardım yok

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/components/auth/PasskeyLoginButton.tsx:21`              |
| Kullanıcılar        | tümü                                                         |
| Prensip             | learnability · Dix Learnability — Familiarity / Guessability |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                   |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:auth                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** RUNTIME /login desktop TR, CDP sanal kimlik doğrulayıcı (kayıtlı kimlik yok) (passkey.mjs): düğme 'Passkey bekleniyor...' (disabled, odak body), 4.3 sn sonra role=alert 'Passkey işlemi iptal edildi veya zaman aşımına uğradı' — kullanıcı iptal etmediği halde. Sayfada passkey açıklaması/yardım bağlantısı yok. WebAuthn desteklenmeyen ortamda (PublicKeyCredential=undefined, mobile) düğme ve 'veya' ayırıcı tamamen gizleniyor (passkey-unsupported-mobile.png) — bu doğru. Ekran: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/auth/passkey-fail-desktop.png

**Etki:** Passkey kavramına yabancı misafir düğmeyi dener, yanıltıcı mesaj alır ve bir sonraki adımı bilemez.

**Önerilen aksiyon:** NotAllowedError metnini 'Bu cihazda kullanılabilir passkey bulunamadı veya işlem iptal edildi. E-posta ve parolanızla giriş yapıp Hesabım > Güvenlik'ten passkey ekleyebilirsiniz.' olarak genişletin; düğme altına kısa 'Passkey nedir?' açıklaması (details/summary) ekleyin.
