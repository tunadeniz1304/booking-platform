# Uyum, bildirim/itiraz, güven merkezi — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 67 bulgu · Severity: Critical 1, High 15, Medium 29, Low 22

## F25 — Geri alınamaz DSA bildirim ve itiraz kararları onay adımı olmadan kaydediliyor; tek satırlı alanda Enter formu gönderiyor

| Alan                | Değer                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                      |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:162`                                                                                                                   |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx:105`, `src/components/compliance/AppealQueue.tsx:151`, `src/lib/compliance/dsa.ts:180`, `src/lib/compliance/dsa-appeal.ts:245` |
| Kullanıcılar        | admin                                                                                                                                                                     |
| Prensip             | robustness · recoverability / error prevention                                                                                                                            |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                          |
| WCAG                | 3.3.4                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                         |
| Kaynak denetçiler   | area:compliance                                                                                                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                                                                                                                        |

**Kanıt:** ComplianceDashboard.tsx:162 `<form onSubmit={decide(n.id)} ...>` ve :196 `<input id={`l-${n.id}`} name="legalReference" ...>`: tek satırlı alanda Enter'a basmak formu örtük olarak gönderiyor. :84-95 `apiFetch(`/api/admin/notices/${id}`, { method: "POST" ...})` doğrudan çalışıyor. Sunucu tarafında karar kesinleşiyor: dsa.ts:180-181 `throw new ConflictError("Bildirim için zaten karar verildi", "NOTICE_DECIDED")`, REMOVED kararında ilan pasife alınıyor (dsa.ts:196-197) ve outbox üzerinden bildirene ve ev sahibine gerekçeli karar e-postası gidiyor. AppealQueue.tsx:105 ile :151'de de aynı akış var: dsa-appeal.ts:245-246 `"İtiraz için zaten karar verildi"`; UPHELD+NO_ACTION ilanı kaldırıyor (dsa-appeal.ts:255).

**Etki:** Yönetici kuyruğu hızlı işlerken yanlış seçeneği seçebilir ya da 'Hukuki referans' alanında Enter'a basabilir. Bu durumda hukuken bağlayıcı karar kaydedilir, ilan kaldırılabilir ve taraflara e-posta gider. Arayüzde bunu geri almanın yolu yok; yanlış karar yalnızca taraflardan biri itiraz ederse düzeltilebilir.

**Önerilen aksiyon:** Submit'te kaydı hemen göndermeyin; önce yerel bir <dialog> onay penceresi açın (role=dialog, aria-modal, odak içeride tutulur, Esc ile kapanır). Pencerede şunlar listelensin: seçilen karar, dayanak, ilan başlığı, e-posta alacak taraflar ve 'Bu karar kaydedildikten sonra değiştirilemez; yalnızca itirazla geri alınabilir' metni. Düğmeler 'Kararı onayla ve gönder' ile 'Vazgeç' olsun. Aynı onay AppealQueue'da 'İtiraz kararını kaydet' için de eklensin. Örtük gönderimi engellemek için legalReference input'una onKeyDown ile Enter'ı yutan bir işleyici eklenebilir ya da onay penceresi bu riski zaten karşılar.

**Yapılan düzeltme:** Before saving, a DSA notice decision now opens a useConfirm dialog (danger tone for REMOVED). The dialog shows the decision, the content URL, the ground, the effect (listing taken down / emails to both parties) and that the decision cannot be changed. Pressing Enter in the single-line field also goes through this dialog. AppealQueue's 'İtiraz kararını kaydet' got the same confirmation, worded by outcome (upheldRemove/upheldRestore/rejected). Files: ComplianceDashboard.tsx decide(), AppealQueue.tsx decide(). — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`

## F107 — 7565 kaldırma formu: ilan önizlemesi ve onay yok, gönderim kilidi yok, başarıdan sonra form temizlenmiyor; çift tıklama iki kaldırma kaydı oluşturuyor

| Alan                | Değer                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                |
| Durum               | Gözlemlendi                                                                                                                         |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:180`                                                                             |
| Diğer konumlar      | `src/lib/compliance/takedown.ts`                                                                                                    |
| Kullanıcılar        | admin, ev sahibi                                                                                                                    |
| Prensip             | robustness · Hata önleme ve kurtarılabilirlik: canlı ilanı yayından kaldıran işlem ham kimlikle, görsel doğrulama olmadan yapılıyor |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                               |
| Efor                | M                                                                                                                                   |
| Kaynak denetçiler   | runtime:admin                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: compliance)                                                                                           |

**Kanıt:** RUNTIME p5-compliance.mjs (stub): İlan kimliği=cmg1prop0009 ve Gerekçe dolu iken 'Talebi kaydet ve ilanı kaldır' tıklanınca POST /api/admin/takedowns hemen gidiyor, dialogs=[]. Başarı sonrası alanlar hâlâ dolu (['cmg1prop0009','Bakanlık yazısı']). Düğme disabled olmuyor. dblclick 2 POST gönderiyor. Sunucuda receiveTakedown (takedown.ts:55-80) idempotent değil: her çağrı yeni TakedownRequest kaydı açıyor ve ilanı pasife alıyor. 'İlan kimliği' serbest metin; hangi ilanın kaldırılacağı (başlık/şehir) gösterilmiyor.

**Etki:** Yinelenen kaldırma kayıtları şeffaflık raporunu ve SLA metriklerini bozar. Kimlikte bir yazım hatası başka bir ev sahibinin ilanını yayından indirebilir. Formun dolu kalması ikinci bir yanlışlıkla gönderimi kolaylaştırır.

**Önerilen aksiyon:** İlan kimliği alanından çıkınca ilanı arayıp 'Kaldırılacak ilan: Boğaz Otel · İstanbul · Ev sahibi Ahmet Y.' önizlemesini gösterin. Onay adımı ekleyin. Gönderim sırasında düğmeyi disabled yapıp 'Kaydediliyor…' gösterin. Başarıda form.reset() çağırın. Sunucuda source+referenceNo+propertyId ile idempotency anahtarı kullanın.

**Yapılan düzeltme:** Takedown form: on blur of the listing ID field, the listing is looked up via GET /api/properties/{id} and an aria-live preview appears ('Kaldırılacak ilan: {title} · {city}', or a not-found warning). Submitting opens a danger confirmation that names the listing. While the request runs, the button has busy (aria-disabled + aria-busy) and reads 'Kaydediliyor…'; a pendingRef guard drops a second submit. On success the form is reset with form.reset() and the preview is cleared. Not done: the host name is not in the public API response, and the server-side idempotency key needs a backend change. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`

## F108 — Sunucu doğrulama hatası genel mesajla veriliyor; hatalı alan belirtilmiyor, mesaj ekran dışında kalıyor

| Alan                | Değer                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Severity            | High                                                                                    |
| Durum               | Gözlemlendi                                                                             |
| Konum               | `src/components/compliance/NoticeForm.tsx:57`                                           |
| Diğer konumlar      | `src/app/api/notices/route.ts`, `src/lib/compliance/dsa.ts`, `src/components/ui/ui.tsx` |
| Kullanıcılar        | misafir, ev sahibi                                                                      |
| Prensip             | robustness · Recoverability (kurtarılabilirlik)                                         |
| Sezgisel madde      | H9 — Hata mesajları                                                                     |
| WCAG                | 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA)                             |
| Renk/tema           | Hayır                                                                                   |
| Efor                | M                                                                                       |
| Kaynak denetçiler   | runtime:compliance                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                                      |

**Kanıt:** p2, desktop 1280x800: (a) açıklama alanına 24 boşluk girildiğinde native minLength=20 kontrolü geçiyor, API 400 dönüyor: fieldErrors.explanation. (b) 'probe@local' e-postası native validity=true sayılıyor, API 400 dönüyor: fieldErrors.reporterEmail. İki durumda da UI yalnızca 'Lütfen tüm zorunlu alanları doğru doldurun.' diyor; [aria-invalid=true] olan alan yok, focus=body. Uyarının rect değeri top=807 > innerHeight=800, yani ekran dışında. RT/crops/compliance/p2-400-whitespace.png'de hiçbir hata görünmüyor ve boşluklarla dolu textarea boş gibi duruyor. Mobilde (p10) uyarı 860-900 aralığında, fold'un altında. API yanıtı alan bazında details.fieldErrors içeriyor ama NoticeForm bunu kullanmıyor (NoticeForm.tsx:51-60). Button disabled={state==='sending'} (satır 132) odaklı butonu devre dışı bırakınca odak body'ye düşüyor.

**Etki:** Kullanıcı hangi alanın hatalı olduğunu göremiyor, çoğu zaman mesajı fark etmiyor bile. Yasal bildirim kanalında görev başarısızlığına ve terk etmeye yol açıyor. Klavye ve ekran okuyucu kullanıcısı formun başına geri dönmek zorunda kalıyor.

**Önerilen aksiyon:** 400 yanıtındaki details.fieldErrors'ı alan bazlı state'e eşleyin ve Field bileşeninin error prop'una verin (Field zaten aria-invalid ve aria-describedby bağlıyor). İlk hatalı alana focus() verin. Formun üstüne bağlantılı bir hata özeti ekleyin. İstemci tarafında açıklama için trim().length>=20 kontrolü ve sunucuyla aynı e-posta desenini uygulayın. Butonda disabled yerine aria-disabled kullanın ki odak kaybolmasın.

**Yapılan düzeltme:** NoticeForm: details.fieldErrors from the 400 response is mapped to per-field i18n messages (errors.*) and passed to Field's error prop, so aria-invalid and aria-describedby are set. The first invalid field gets focus. Client side, the explanation is checked with trim().length>=20 and the email with a regex that requires a TLD before sending. Each error clears once the user fixes it while typing. The button uses busy instead of disabled, so focus is not lost. — dosyalar: `src/components/compliance/NoticeForm.tsx`

## F109 — Mobilde başarılı bildirim onayı görünüm alanının dışında kalıyor, odak body'ye düşüyor

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | High                                                                                      |
| Durum               | Gözlemlendi                                                                               |
| Konum               | `src/components/compliance/NoticeForm.tsx:62`                                             |
| Diğer konumlar      | `src/components/ui/ui.tsx`                                                                |
| Kullanıcılar        | misafir, ev sahibi                                                                        |
| Prensip             | robustness · Observability (gözlemlenebilirlik): sistem durumu kullanıcıya görünür olmalı |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                            |
| WCAG                | 4.1.3 Status Messages (AA), 2.4.3 Focus Order (A)                                         |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | runtime:compliance                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                                        |

**Kanıt:** p3 (gerçek API, 201, referans cmv2xa4e4003vkd9zfp46lk49), /report?propertyId=cmv2uydl30fot92w2i9c8a4fa, mobile 390x844: gönderimden sonra scrollY=359, onay paragrafının rect değeri top=-61 bottom=-1, yani tamamen görüş alanının üstünde. RT/crops/compliance/p3-sent-mobile.png ekranda yalnızca footer'ı gösteriyor. p14 (mock 201): masaüstünde onay görünüyor (top=242) ama iki görünümde de focus=body, sonraki Tab footer'daki 'Yardım Merkezi'ne gidiyor. Başarı mesajı, içi zaten dolu olarak YENİ eklenen bir <div aria-live=polite> içinde render ediliyor (formdaki boş Status bileşeni kaldırılıyor); NoticeForm.tsx:62-68, ui.tsx:144-155. Bu yüzden ekran okuyucu duyurusu garanti değil.

**Etki:** Mobil ağırlıklı misafir, 'Bildirimi gönder'e bastıktan sonra form kaybolmuş ve yalnızca footer görünür halde kalıyor. İşlemin başarılı olup olmadığını bilemiyor, sayfayı terk ediyor ya da tekrar bildirim yapmaya çalışıyor. Ekran okuyucu kullanıcısı referans numarasını duymuyor.

**Önerilen aksiyon:** sent durumunda onay kartına tabIndex={-1} ve ref verin; useEffect içinde ref.current.focus() ile scrollIntoView({block:'start'}) çağırın. Karta 'Bildiriminiz alındı' başlıklı bir h2 ekleyin. Canlı bölgeyi form kaldırıldığında DOM'dan çıkmayacak şekilde kalıcı bir üst öğede tutun ve yalnız içeriğini değiştirin.

**Yapılan düzeltme:** NoticeForm sent state: the Card and an aria-live region stay mounted the whole time, and only their content changes. An h2 'Bildiriminiz alındı' (tabIndex=-1, scroll-mt-24) and the reference message are shown. A useEffect calls scrollIntoView({block:'start'}) and then focus(). — dosyalar: `src/components/compliance/NoticeForm.tsx`

## F248 — Güven merkezi ve uyum paneli sayfalarına özgü bir <title> yok; tüm sitenin genel başlığını kullanıyorlar

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Aday                                                           |
| Konum               | `src/app/trust/page.tsx:1`                                     |
| Diğer konumlar      | `src/app/admin/compliance/page.tsx:1`, `src/app/layout.tsx:16` |
| Kullanıcılar        | tümü                                                           |
| Prensip             | accessibility · Page Titled (WCAG 2.4.2)                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                          |
| WCAG                | 2.4.2                                                          |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:compliance                                                |
| **Düzeltme durumu** | **Zaten uygun** (paket: compliance)                            |

**Kanıt:** trust/page.tsx:1 `"use client";` olduğu için metadata ya da generateMetadata export edilemiyor. admin/compliance/page.tsx:1 de `"use client"`. Bu dizinlerde layout.tsx yok; bu yüzden layout.tsx:16'daki `title: t("meta.title")` geçerli oluyor: "booking-platform — konaklama arama ve rezervasyon (demo)" (messages/tr/common.json:3). Karşılaştırma: report/page.tsx:6-9 ve report/appeal/page.tsx:12-15 generateMetadata kullanıyor, ancak kök layout'ta title template olmadığından bu sayfaların başlığında site adı yer almıyor.

**Etki:** Ekran okuyucu kullanıcıları sayfaya girdiklerinde hangi sayfada olduklarını başlıktan öğrenemez. Birden çok yönetim sekmesi açık olan yönetici sekmeleri birbirinden ayırt edemez; tarayıcı geçmişi ve yer imleri anlamsız kalır.

**Önerilen aksiyon:** Her iki sayfayı server page.tsx + client alt bileşen olarak ayırın. page.tsx'te `export async function generateMetadata() { const t = await getTranslations("trustCenter"); return { title: t("pageTitle") }; }` (uyum için `compliance.admin.title`) tanımlayın. Kök layout'ta `title: { template: "%s · booking-platform", default: t("meta.title") }` kullanın.

**Yapılan düzeltme:** Page titles are handled globally (wave 1). Per the task instruction I added no title or metadata, so trust/page.tsx and admin/compliance/page.tsx were not changed.

## F249 — İtiraz formundaki istemci tarafı doğrulama hatası duyurulmuyor ve odak hatalı alana taşınmıyor

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | High                                                                |
| Durum               | Aday                                                                |
| Konum               | `src/components/compliance/AppealForm.tsx:27`                       |
| Diğer konumlar      | `src/components/ui/ui.tsx:81`                                       |
| Kullanıcılar        | misafir, ev sahibi                                                  |
| Prensip             | accessibility · Error Identification (WCAG 3.3.1) / Status Messages |
| Sezgisel madde      | H9 — Hata mesajları                                                 |
| WCAG                | 3.3.1                                                               |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | area:compliance                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                  |

**Kanıt:** AppealForm.tsx:27-30 `if (reason.length < 20) { setFieldError(t("reasonTooShort")); return; }`. Field hata <p>'si (ui.tsx:81-85 `<p id={errorId} className="mt-1 text-xs font-medium text-red-700">`) bir live region değil ve odak submit düğmesinde kalıyor. fieldError kullanıcı yazarken temizlenmiyor; ancak bir sonraki submit'te siliniyor.

**Etki:** Ekran okuyucu kullanıcısı 'İtirazı gönder'e bastığında hiçbir geri bildirim almaz; formun neden gönderilmediğini anlayamaz. Gören kullanıcı ise yeterince yazdıktan sonra da kırmızı hata metnini görmeye devam eder.

**Önerilen aksiyon:** Hata durumunda `document.getElementById("appeal-reason")?.focus()` çağırın; böylece etiket, aria-invalid ve aria-describedby ile hata birlikte okunur. textarea'ya `onChange={(e) => fieldError && e.target.value.trim().length >= 20 && setFieldError(null)}` ekleyin. Field'daki hata <p>'sine `role="alert"` eklemeyi değerlendirin.

**Yapılan düzeltme:** AppealForm: when the reason is shorter than 20 characters, focus moves to #appeal-reason, so the label, aria-invalid and the error text are read together. The textarea onChange clears the error once the trimmed length reaches 20. No role=alert was added (it was unnecessary). The button uses busy instead of disabled, and a guard blocks double submits. — dosyalar: `src/components/compliance/AppealForm.tsx`

## F250 — Kuyruk öğesi işlendikten sonra öğe DOM'dan kalkıyor ve klavye odağı belgenin başına düşüyor

| Alan                | Değer                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                         |
| Durum               | Aday                                                                                                                                                                         |
| Konum               | `src/components/compliance/AppealQueue.tsx:60`                                                                                                                               |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:44`, `src/components/compliance/ComplianceDashboard.tsx:140`, `src/components/compliance/AccessibilityReviewQueue.tsx:45` |
| Kullanıcılar        | admin                                                                                                                                                                        |
| Prensip             | accessibility · Focus Order (WCAG 2.4.3)                                                                                                                                     |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                        |
| WCAG                | 2.4.3                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                        |
| Efor                | M                                                                                                                                                                            |
| Kaynak denetçiler   | area:compliance                                                                                                                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                                                                                                                           |

**Kanıt:** AppealQueue.tsx:60-63 `.then(() => { setStatus({ message: t("decided") }); appeals.reload(); })`: yalnızca PENDING itirazlar listelendiği için odaktaki submit düğmesini içeren <li> kaldırılıyor. ComplianceDashboard.tsx:44-46'da `notices.reload()` karar verilen bildirimi listeden çıkarıyor; kapatılan talepte `td.status !== "CLOSED"` (:140) koşulu odaktaki Kapat düğmesini kaldırıyor. AccessibilityReviewQueue.tsx:45'te `rows.reload()` doğrulanan satırı bekleyen listeden çıkarıyor. Odağı taşıyan bir kod yok.

**Etki:** Yalnızca klavye ya da ekran okuyucu kullanan yönetici her karardan sonra <body>'ye düşer ve sonraki öğeye ulaşmak için sayfanın başından (header, takedown formu, tüm bildirimler) yeniden Tab'lamak zorunda kalır. 200 öğeye kadar uzayan bir kuyrukta bu ciddi bir sürtünme.

**Önerilen aksiyon:** Her öğeye `<h3 id={`appeal-${row.id}-title`} tabIndex={-1}>` ekleyin ve reload tamamlandığında bir sonraki öğenin başlığına `focus()` yapın. Liste boşaldıysa Card başlığına (`${id}-title`, tabIndex=-1) odaklanın. Kapatılan takedown'da odak satırın durum metnine taşınsın.

**Yapılan düzeltme:** Notices, appeals and the accessibility queue: each item has an h3 with tabIndex=-1 (notice-/appeal-/a11y-{id}-title). Before an action, the neighbouring item (next, or previous if there is none) is stored. After reload, a useEffect moves focus to that item's heading, or to the Card heading ({id}-title, tabindex=-1 added) when the list is empty. When a takedown is closed, focus goes to that row's status text (td-{id}-state). — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx`

## F251 — Yönetici eylem düğmeleri istek sürerken devre dışı kalmıyor; çift gönderim yinelenen kayıt ya da yanıltıcı hata üretiyor

| Alan                | Değer                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                     |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:39`                                                                                                   |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx:151`, `src/components/compliance/AccessibilityReviewQueue.tsx:104`, `src/app/api/admin/takedowns/route.ts:24` |
| Kullanıcılar        | admin                                                                                                                                                    |
| Prensip             | robustness · responsiveness / error prevention                                                                                                           |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                         |
| Renk/tema           | Hayır                                                                                                                                                    |
| Efor                | S                                                                                                                                                        |
| Kaynak denetçiler   | area:compliance                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: compliance)                                                                                                                |

**Kanıt:** ComplianceDashboard.tsx:39-50 `const run = async (fn, ok) => { setError(null); setMessage(null); try { await fn(); setMessage(ok); ...} catch (e) { setError(errorMessage(e)); } }`: bekleme durumu tutulmuyor. :128 `<Button type="submit">{t("createTakedown")}</Button>`, :141 Kapat ve :199 `{t("decide")}` düğmelerinde disabled yok. AppealQueue.tsx:151 ve AccessibilityReviewQueue.tsx:104-108'de de aynı durum var. api/admin/takedowns/route.ts:24-29 POST'ta idempotency yok.

**Etki:** Yavaş ağda 'Talebi kaydet ve ilanı kaldır'a iki kez tıklanırsa iki ayrı TakedownRequest oluşur ve şeffaflık raporundaki sayılar şişer. 'Kararı kaydet'e çift tıklandığında ilk istek başarılı olur, ikincisi 409 "Bildirim için zaten karar verildi" döner. Status'ta `error ?? ...` önceliği nedeniyle başarı mesajının yerine hata görünür; yönetici kararın kaydedilmediğini sanar.

**Önerilen aksiyon:** run()'a ve AppealQueue/AccessibilityReviewQueue'daki eylemlere öğe bazlı `pending` durumu (ör. `pendingId`) ekleyin. İstek sürerken ilgili düğmeye `disabled` ve `aria-busy="true"` verin, metni 'Kaydediliyor…' yapın; pending varken gelen ikinci submit'i yok sayın. Takedown POST'una Idempotency-Key başlığı gönderin (src/lib/http/idempotency.ts mevcut).

**Yapılan düzeltme:** Each action now has its own pending state and a pendingRef guard. While a request runs, the related Button gets busy (aria-disabled + aria-busy) and the label 'Kaydediliyor…'; a second submit or click is ignored. This covers takedown create and close, notice decisions, appeal decisions, and verify/unverify. Not done: the takedown POST would need an Idempotency-Key, but the route does not support one, so that part needs a backend/API change. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx`

## F252 — İşlem sonucu ve hata mesajı, eylemin yapıldığı öğede değil sayfanın ya da kartın en üstünde gösteriliyor

| Alan                | Değer                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                        |
| Durum               | Aday                                                                                                        |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:107`                                                     |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx:71`, `src/components/compliance/AccessibilityReviewQueue.tsx:65` |
| Kullanıcılar        | admin                                                                                                       |
| Prensip             | robustness · observability                                                                                  |
| Sezgisel madde      | H12 — Feedback                                                                                              |
| Renk/tema           | Hayır                                                                                                       |
| Efor                | S                                                                                                           |
| Kaynak denetçiler   | area:compliance                                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                                                          |

**Kanıt:** ComplianceDashboard.tsx:107 `<Status error={error ?? takedowns.error ?? notices.error} message={message} />` tüm kartlardan önce tek bir alan olarak duruyor; karar formları ise :162'de, ekranın çok altında. AppealQueue.tsx:71 ve AccessibilityReviewQueue.tsx:65'te de durum alanı kartın tepesinde. Üç hata kaynağı tek bir string'e indirgenmiş, dolayısıyla eylem hatası varken yükleme hatası görünmüyor.

**Etki:** Gören yönetici listenin ortasındaki bir bildirimde 'Kararı kaydet'e bastığında sunucu hatasını (ör. 'İlana bağlı olmayan bildirimde kaldırma uygulanamaz') görmez, çünkü mesaj ekran dışında kalır. Form yerinde durduğu için kararın kaydedildiğini ya da işlemin takıldığını düşünebilir.

**Önerilen aksiyon:** Eylem sonuçlarını öğe bazında gösterin: `statusById[id]` state'i tutun ve her <li>/<form> içine, submit düğmesinin hemen altına `<Status error={...} message={...} />` koyun. Yükleme hatalarını ilgili kartın içinde gösterin (takedowns.error Takedowns kartında, notices.error Notices kartında) ve yanlarına 'Tekrar dene' (reload) düğmesi ekleyin. Global üst Status kaldırılsın.

**Yapılan düzeltme:** The global Status at the top was removed. Action errors now appear in a Status right under each item's or form's submit button. Success messages show next to the takedown form or row, and in the card's Status when the item drops out of the list. Load errors appear inside the related card with a 'Tekrar dene' (reload) button. The three error sources are no longer merged into one string. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx`

## F253 — Kaldırma talebi kaydı ilanı anında yayından kaldırıyor; ilan yalnızca elle yazılan ham kimlikle seçiliyor, önizleme ve onay yok

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:118` |
| Diğer konumlar      | `src/lib/compliance/takedown.ts:67`                     |
| Kullanıcılar        | admin                                                   |
| Prensip             | robustness · error prevention / recognition over recall |
| Sezgisel madde      | H5 — Hata önleme                                        |
| WCAG                | 3.3.4                                                   |
| Renk/tema           | Hayır                                                   |
| Efor                | M                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: compliance)               |

**Kanıt:** ComplianceDashboard.tsx:118-119 `<Field id="td-property" label={t("propertyId")}><input id="td-property" name="propertyId" required className={input} />`, :128 `<Button type="submit">{t("createTakedown")}</Button>` ("Talebi kaydet ve ilanı kaldır"). takedown.ts:67 aynı işlemde `isActive: false` yapıyor. Formdaki tek satırlı alanlarda (td-ref, td-reason :122, :125) Enter'a basmak da talebi gönderiyor.

**Etki:** Yönetici, ilan başlığını görmeden bir cuid kopyalayıp yapıştırıyor (hatırlama yükü). Yanlış ID yapıştırılırsa başka bir ev sahibinin ilanı anında kalkar. Talep yalnızca 'kapatılabilir' ve ilan kapatılınca otomatik açılmaz (takedown.ts:241), dolayısıyla ev sahibi gelir kaybına uğrar.

**Önerilen aksiyon:** propertyId metin alanını bir ilan arama combobox'ıyla değiştirin (role=combobox, aria-expanded, aria-controls; başlık, şehir, ev sahibi ve yayın durumu listelensin). Seçilen ilan formda 'Kaldırılacak ilan: {başlık} ({şehir})' kartı olarak gösterilsin. Gönderimde onay penceresi açılsın: 'Bu ilan hemen yayından kaldırılacak'. ID alanı kalacaksa autoComplete="off" ve spellCheck={false} eklenmeli, blur'da başlık doğrulanmalı.

**Yapılan düzeltme:** The listing ID field now has autoComplete=off, spellCheck=false, a hint, a title/city preview on blur, and a 'İlan hemen yayından kaldırılsın mı?' danger confirmation before submit, so Enter also goes through the confirmation. Not done: a full listing-search combobox needs an admin listing-search API, which needs a backend change. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`

## F254 — Kaldırma talebini kapatma tek tıkla, onaysız yapılıyor; kapatma gerekçesi girilemiyor ve sonuç önceden bildirilmiyor

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | High                                                                       |
| Durum               | Aday                                                                       |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:141`                    |
| Diğer konumlar      | `src/lib/compliance/takedown.ts:251`, `src/lib/compliance/takedown.ts:225` |
| Kullanıcılar        | admin                                                                      |
| Prensip             | robustness · recoverability / feedforward                                  |
| Sezgisel madde      | H5 — Hata önleme                                                           |
| WCAG                | 3.3.4                                                                      |
| Renk/tema           | Hayır                                                                      |
| Efor                | M                                                                          |
| Kaynak denetçiler   | area:compliance                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                         |

**Kanıt:** ComplianceDashboard.tsx:141-143 `<Button variant="secondary" onClick={() => closeTakedown(td.id)}>{t("close")}</Button>`. :73-75 `body: JSON.stringify({ resolution: t("defaultResolution") })` her kapatmada sabit "Yönetici tarafından kapatıldı" yazıyor; bu metin admin'in arayüz diline göre TR ya da EN olarak denetim kaydına giriyor. takedown.ts:251-252 `"Talep zaten kapalı"` nedeniyle talep yeniden açılamıyor. takedown.ts:225-235'e göre kapatma, ev sahibinin ilanı yeniden yayına almasının önünü açıyor.

**Etki:** Yanlışlıkla tıklanan 'Kapat', yasal bir kaldırma kısıtlamasını geri dönüşsüz biçimde sonlandırır. Neden kapatıldığı (ör. makam talebi geri çekti) kayda geçmez ve denetimde izlenemez.

**Önerilen aksiyon:** 'Kapat' tıklandığında satır içinde küçük bir form açılsın. İçinde zorunlu bir textarea bulunsun: 'Kapatma gerekçesi' (minLength 3, maxLength 2000, aria-describedby ipucu). Feedforward metni: 'Kapatılan talep yeniden açılamaz; ev sahibi ilanı yeniden yayına alabilir.' Düğmeler 'Talebi kapat' ile 'Vazgeç' olsun. resolution değeri bu alandan gönderilmeli; t("defaultResolution") kaldırılmalı.

**Yapılan düzeltme:** 'Kapat' now opens an inline form in the row instead of closing straight away. It has a required 'Kapatma gerekçesi' textarea (minLength 3, maxLength 2000) with a feedforward hint saying the request cannot be reopened and the host may republish the listing, plus 'Talebi kapat' (danger, busy) and 'Vazgeç' buttons. The resolution value comes from this field; t('defaultResolution') is no longer used. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`

## F255 — Bekleyen DSA bildirimleri yüklenirken ve yükleme başarısız olduğunda 'Bekleyen bildirim yok.' gösteriliyor (yanlış boş durum)

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:151` |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:131` |
| Kullanıcılar        | admin                                                   |
| Prensip             | robustness · observability                              |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                          |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                      |

**Kanıt:** ComplianceDashboard.tsx:103 `const pending = notices.data ?? [];` ve :151 `{pending.length === 0 && <p className="text-sm text-gray-600">{t("noNotices")}</p>}`: data=null iken (yükleniyor ya da hata) de boş mesajı çıkıyor. Karşılaştırma: AppealQueue.tsx:72 `{appeals.data && rows.length === 0 && ...}` doğru korumayı yapıyor. Takedown listesinde (:131-147) yükleniyor, boş ve hata durumlarının hiçbiri gösterilmiyor.

**Etki:** Yönetici yasal süreli bildirim kuyruğunun boş olduğuna inanıp sayfadan ayrılabilir. Yükleme hatasında üstte bir hata, kartta ise 'Bekleyen bildirim yok' yazar; bu iki ifade birbiriyle çelişir.

**Önerilen aksiyon:** Durumları ayırın: `notices.data === null && !notices.error` iken `<p role="status">{tc("loading")}</p>`; `notices.error` varsa kart içinde hata mesajı ve 'Tekrar dene' düğmesi; boş mesajı yalnızca `notices.data?.length === 0` olduğunda. Aynı üç durumu takedown listesine de ekleyin ('Kayıtlı talep yok.').

**Yapılan düzeltme:** Notices and takedowns now have separate loading, error and empty states: role=status common.loading while loading, an error plus 'Tekrar dene' on failure, and 'Bekleyen bildirim yok' / 'Kayıtlı talep yok' only when data is an empty array. AppealQueue and AccessibilityReviewQueue also got a loading state. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx`

## F256 — Bildirim listesinde uzun içerik URL'si satıra sığmıyor; dar ekranda yatay taşma oluşuyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:157` |
| Kullanıcılar        | admin                                                   |
| Prensip             | accessibility · Reflow (WCAG 1.4.10)                    |
| Sezgisel madde      | H14 — Erişilebilirlik                                   |
| WCAG                | 1.4.10                                                  |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                      |

**Kanıt:** ComplianceDashboard.tsx:157-159 `<a className="text-[#003580] underline" href={n.contentUrl}>{n.contentUrl}</a>` için kırma kuralı yok. Aynı veriyi gösteren AppealQueue.tsx:87 `className={`break-all text-[#003580] underline ${focusRing}`}` kullanıyor. Boşluksuz URL'ler varsayılan `overflow-wrap: normal` ile bölünmüyor.

**Etki:** 360px genişlikte, hatta sorgu parametreli uzun URL'lerde masaüstünde de karttan dışarı taşan metin yatay kaydırma gerektirir; karar formu ve düğmeler görünür alanın dışına kayar. Yönetici ara sıra mobilden kontrol ettiğinde içerik okunamaz.

**Önerilen aksiyon:** Bağlantıya `break-all` (ya da `[overflow-wrap:anywhere]`) ekleyin; kapsayıcı <p>'ye `min-w-0` verin. Bildirim açıklaması `whitespace-pre-line` paragrafına (:161) da `break-words` ekleyin.

**Yapılan düzeltme:** Added break-all to the notice content URL, min-w-0 to its container, and break-words to the explanation paragraph. Long text in the appeal reason, takedown rows and accessibility notes also got break-words. No colors were changed. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx`

## F257 — Karar formlarında varsayılanlar önceden seçili; dayanak alanı 'İşlem yapma'da da görünüyor ve 'Kullanım koşulları'na sabitlenmiş

| Alan                | Değer                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:168`                                                                                                 |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:174`, `src/components/compliance/AppealQueue.tsx:49`, `src/components/compliance/AppealQueue.tsx:75` |
| Kullanıcılar        | admin                                                                                                                                                   |
| Prensip             | robustness · error prevention / task conformance                                                                                                        |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                        |
| WCAG                | 3.3.4                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                   |
| Efor                | S                                                                                                                                                       |
| Kaynak denetçiler   | area:compliance                                                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                                                                                                      |

**Kanıt:** ComplianceDashboard.tsx:168 `defaultValue="NO_ACTION"` ve :174-183'teki dayanak select'i her zaman render ediliyor, `defaultValue="TERMS_OF_SERVICE"`. :90 `ground: decision === "REMOVED" ? f.get("ground") : undefined` NO_ACTION'da seçilen dayanağı sessizce yok sayıyor; REMOVED'da ise yönetici dayanağa dokunmazsa ToS gönderiliyor ve gerekçeli karara yazılıyor (dsa.ts:162). AppealQueue.tsx:49 ve :75'te `outcomes[row.id] ?? "REJECTED"` ile 'Ret' önceden seçili. Buna karşılık AppealQueue.tsx:124 dayanağı yalnızca gerektiğinde gösteriyor.

**Etki:** Yönetici 'Kaldır'ı seçip dayanağı değiştirmeyi unutursa, hukuka aykırı içerik için verilen karar 'Kullanım koşulları' dayanağıyla ev sahibine ve bildirene e-postalanır; bu yanlış bir hukuki gerekçedir. NO_ACTION'da görünen dayanak alanı da işe yaradığı izlenimi veriyor.

**Önerilen aksiyon:** Karar select'ine boş bir ilk seçenek ekleyin (`<option value="" disabled>Seçin…</option>`) ve `required` yapın. Kararı state'te tutun; dayanak alanını yalnızca decision === "REMOVED" iken render edin, boş varsayılanla ve required olarak. AppealQueue'da radyo grubunda hiçbir seçenek önceden işaretli olmasın; seçim yapılana kadar submit disabled kalsın ve 'Bir sonuç seçin' ipucu gösterilsin.

**Yapılan düzeltme:** The decision select is now controlled and required, and starts on an empty disabled 'Seçin…' option. The ground select is only rendered when decision === REMOVED, also with an empty default and required. In AppealQueue no radio is pre-selected: required, a 'Bir sonuç seçin.' hint linked with aria-describedby, and if nothing is chosen an item-level error is shown and focus goes to the first radio. The ground select there also starts empty and is required. The radio labels are min-h-[44px] on mobile. — dosyalar: `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`

## F258 — Form alanı kenarlıklarının kontrastı 3:1'in altında (bileşen içi yerel input sınıfı)

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | High                                                                                  |
| Durum               | Aday                                                                                  |
| Konum               | `src/components/compliance/NoticeForm.tsx:17`                                         |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:24`, `src/components/ui/ui.tsx:21` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                             |
| Prensip             | accessibility · Non-text Contrast (WCAG 1.4.11)                                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                 |
| WCAG                | 1.4.11                                                                                |
| Renk/tema           | Evet — onaylandı, sonraki oturumda uygulanacak                                        |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | area:compliance                                                                       |
| **Düzeltme durumu** | **Onaylandı — sonraki oturumda uygulanacak (renk)**                                   |

**Kanıt:** NoticeForm.tsx:17-18 `"mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 ..."`: beyaz kart üzerinde #d1d5db kenarlığın kontrastı yaklaşık 1.5:1. ComplianceDashboard.tsx:24-25'te de aynı `border-gray-300` var. Ortak ui.tsx:21 `inputClass` ise `border-gray-400` (#9ca3af) kullanıyor ve kontrastı yaklaşık 2.5:1, yani o da eşiğin altında.

**Etki:** Az gören ya da parlak ortamda mobil kullanan misafir, içerik URL'si, açıklama ve e-posta alanlarının sınırlarını seçmekte zorlanır; tıklanacak alanı bulamayabilir.

**Önerilen aksiyon:** Kenarlık rengini en az 3:1 kontrasta yükseltin (ör. gray-500 #6b7280 yaklaşık 4.8:1). Bu bir renk ya da tema değişikliği olduğundan kullanıcı onayı gerekir. Renk dışı ara çözüm olarak alanlara hafif bir arka plan (bg-gray-50) ve kalınlaştırılmış alt kenarlık eklenebilir; o da renk sayılır.

## F259 — Bildirim ve itiraz formunda başarı mesajı ekran okuyucuya güvenilir biçimde duyurulmuyor ve odak kayboluyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | High                                                                          |
| Durum               | Aday                                                                          |
| Konum               | `src/components/compliance/NoticeForm.tsx:62`                                 |
| Diğer konumlar      | `src/components/compliance/AppealForm.tsx:57`, `src/components/ui/ui.tsx:146` |
| Kullanıcılar        | misafir, ev sahibi                                                            |
| Prensip             | accessibility · Status Messages (WCAG 4.1.3) / Focus Order                    |
| Sezgisel madde      | H14 — Erişilebilirlik                                                         |
| WCAG                | 4.1.3                                                                         |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:compliance                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: compliance)                                            |

**Kanıt:** NoticeForm.tsx:62-68 `if (state === "sent") { return (<Card><Status message={t("sent", ...)} /></Card>); }`: odaktaki submit düğmesini de içeren form tamamen unmount ediliyor. Yeni Status (ui.tsx:146 `<div aria-live="polite">`) içeriğiyle birlikte aynı anda DOM'a ekleniyor; içeriği dolu eklenen live region'lar çoğu ekran okuyucuda duyurulmuyor. AppealForm.tsx:57-63'te de aynı desen var.

**Etki:** Ekran okuyucu kullanan misafir 'Bildirimi gönder'e bastıktan sonra hiçbir şey duymaz, odak <body>'ye düşer. Başvuru numarasını (referans) ve gönderimin başarılı olduğunu kaçırır; tekrar göndermeye çalışabilir.

**Önerilen aksiyon:** Başarı bloğuna odaklanılabilir bir başlık ekleyin: `<h2 ref={doneRef} tabIndex={-1}>Bildiriminiz alındı</h2>`. useEffect içinde `state === "sent"` olduğunda `doneRef.current?.focus()` çağrılsın. Alternatif olarak koşulun dışında her zaman render edilen tek bir `<div role="status">` tutun ve mesajı ona yazın. AppealForm'da da aynısı yapılsın.

**Yapılan düzeltme:** NoticeForm and AppealForm: the Card and its aria-live container stay mounted in every state, and only the content changes, so the message is announced. A focusable heading (h2 sentTitle / h3 sentTitle) is focused and scrolled into view in a useEffect. — dosyalar: `src/components/compliance/NoticeForm.tsx`, `src/components/compliance/AppealForm.tsx`

## F442 — Geçersiz itiraz bağlantısı çıkmaz sayfa: kurtarma yolu yok, 'süresi dolmuş' ifadesi yanıltıcı

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                               |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                      |
| Konum               | `src/app/report/appeal/page.tsx:42`                                                                  |
| Diğer konumlar      | `messages/tr/compliance.json`, `src/lib/compliance/dsa-appeal.ts`, `messages/tr/compliance.json:143` |
| Kullanıcılar        | misafir, ev sahibi                                                                                   |
| Prensip             | robustness · Recoverability                                                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                                  |
| Renk/tema           | Hayır                                                                                                |
| Efor                | M                                                                                                    |
| Kaynak denetçiler   | runtime:compliance, area:compliance                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                         |

**Kanıt:** Sweep 030/031 ve p6: /report/appeal, ?notice=x&role=host&token=invalid-token ve ?notice=x&role=reporter (token yok) adreslerinin üçü de aynı mesajı veriyor: 'İtiraz bağlantısı geçersiz ya da süresi dolmuş. Lütfen karar e-postanızdaki bağlantıyı kullanın.' main içindeki eylemler = []. Üstteki giriş metni hâlâ 'itiraz edebilirsiniz' diyor (RT/crops/compliance/031-anon-tr-mobile-_report_appeal-0.png). Belirteç süresiz bir HMAC (dsa-appeal.ts appealToken); süre dolumu ayrı bir mesajla (windowClosed) ele alınıyor, dolayısıyla 'süresi dolmuş' hiçbir zaman bu mesajın nedeni değil.

**Etki:** Bağlantısı bozulmuş (ör. e-posta istemcisi tarafından kırpılmış) ev sahibi ya da bildiren, yasal itiraz hakkını kullanmanın yolunu bulamıyor. Mesaj, gerçekte olmayan bir 'süre doldu' nedenini ima ediyor.

**Önerilen aksiyon:** Mesajı 'Bağlantı eksik ya da hatalı.' olarak değiştirin. Eylemler ekleyin: 'Destekle iletişime geç' (/support), referans numarası ve e-posta ile 'Karar e-postasını yeniden gönder', 'Yeni bildirim' (/report). Henüz karar verilmemiş bildirim (NotFound) için ayrı bir açıklama gösterin.

## F443 — 'DSA şeffaflık raporu' bağlantısı herkese açık sayfadan yönetici kapısına götürüyor

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | Medium                                                                 |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                        |
| Konum               | `src/app/trust/page.tsx:48`                                            |
| Diğer konumlar      | `messages/tr/trustCenter.json`, `src/app/admin/compliance/page.tsx:17` |
| Kullanıcılar        | misafir, ev sahibi                                                     |
| Prensip             | learnability · Predictability                                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                      |
| Renk/tema           | Hayır                                                                  |
| Efor                | M                                                                      |
| Kaynak denetçiler   | runtime:compliance, area:compliance                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                           |

**Kanıt:** p6, anon: /admin/compliance açıldığında H1 'Uyum' ve 'Bu sayfa için giriş yapın.' görünüyor (RT/crops/compliance/p6-anon-admin-compliance.png). Bağlantı diğer kamu bağlantılarıyla aynı stilde; 'yönetici yetkisi gerekir' notu bağlantıdan SONRA ve 14px.

**Etki:** Halka açık olduğu varsayılan şeffaflık raporu kamuya kapalı. Kullanıcı çıkmaz bir giriş sayfasına düşüyor, güven algısı zedeleniyor.

**Önerilen aksiyon:** Toplu rakamları herkese açık bir /trust/transparency sayfasında (HTML tablo ile CSV/JSON) yayımlayın. Bu yapılamıyorsa yönetici olmayanlar için bağlantıyı kaldırın ya da kilit ikonu ve '(yalnız yöneticiler)' ibaresiyle etiketleyin.

## F503 — Güven merkezi tüketiciye değil geliştiriciye göre yazılmış; tüketiciyi ilgilendiren öğeler en sonda ve açıklamasız

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Gözlemlendi                                         |
| Konum               | `src/app/trust/page.tsx:28`                         |
| Diğer konumlar      | `messages/tr/trustCenter.json`                      |
| Kullanıcılar        | misafir, ev sahibi                                  |
| Prensip             | learnability · Familiarity (gerçek dünya eşleşmesi) |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                         |
| Renk/tema           | Hayır                                               |
| Efor                | M                                                   |
| Kaynak denetçiler   | runtime:compliance                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** Sweep 024/025: H2 sırası 'Tedarik zinciri', 'Doğrulama uçları', 'Politikalar ve şeffaflık'. Metinde SBOM, CycloneDX, SLSA provenance, artefakt, 'main dalı', JWKS, mandate, ES256, OpenAPI 3.1 geçiyor. Misafiri ilgilendiren 'Sıralama nasıl çalışır?', 'Yasa dışı içerik bildir (DSA)' ve 'Gizlilik ve KVKK bildirimi' bağlantıları son kartın son üç öğesi ve açıklamaları yok (RT/crops/compliance/024-anon-tr-desktop-_trust-1.png; mobilde yaklaşık 1,5 ekran kaydırdıktan sonra görünüyor: 025-…-1.png). Footer'daki 'Güven merkezi' etiketi tüketiciye güvenlik vaadi (dolandırıcılık, güvenli ödeme) çağrıştırıyor.

**Etki:** Geniş okuryazarlık yelpazesindeki misafir sayfayı anlamıyor ve aradığı bildirim ya da gizlilik yolunu kaçırıyor. Sayfa güven vermek yerine yabancılaştırıyor.

**Önerilen aksiyon:** Sayfayı 'Güvenliğiniz ve haklarınız' bölümüyle açın: içerik bildir, karara itiraz, sıralama, gizlilik, ödeme güvenliği; her biri için bir cümlelik sade açıklama. SBOM, JWKS ve benzeri öğeleri 'Geliştiriciler ve denetçiler için' başlığı altında bir details öğesine ya da /trust/developers sayfasına taşıyın. Terimler için kısa açıklamalar ekleyin.

## F504 — 'SBOM (CycloneDX) indir' bir indirme değil; üç farklı etiket aynı GitHub iş akışı sayfasına gidiyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Gözlemlendi                                 |
| Konum               | `src/app/trust/page.tsx:32`                 |
| Diğer konumlar      | `messages/tr/trustCenter.json`              |
| Kullanıcılar        | tümü                                        |
| Prensip             | learnability · Predictability (feedforward) |
| Sezgisel madde      | H13 — Feedforward                           |
| WCAG                | 2.4.4 Link Purpose (In Context) (A)         |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | runtime:compliance                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** p6: 'SBOM (CycloneDX) indir', 'SLSA provenance (build kanıtı)' ve 'OpenSSF Scorecard' bağlantılarının üçünün de href'i https://github.com/tunadeniz1304/booking-platform/actions/workflows/security.yml; download özniteliği yok. Hedef sayfanın başlığı (curl) 'Security · Workflow runs'. Scorecard notu 'Yayınlanmadı' dediği halde öğe bağlantı olarak duruyor.

**Etki:** 'İndir' fiili bir dosya beklentisi yaratıyor; kullanıcı iş akışı listesine düşüp ne yapacağını bilemiyor. Yayımlanmamış bir öğeye tıklamak boşa çıkıyor.

**Önerilen aksiyon:** Etiketi 'SBOM — CI iş akışı (GitHub)' yapın ya da doğrudan bir release asset'ine bağlayın. Scorecard yayımlanana kadar bağlantı yerine düz metin kullanın. Her öğenin hedefi kendine özgü olsun.

## F505 — Uyum karar formlarında varsayılanlar ve önden bilgilendirme (feedforward) yanlış: 'İşlem yapma' seçiliyken 'Dayanak' görünüyor, itirazda 'Ret' ön seçili, zorunlu alanlar işaretsiz

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:302` |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx`             |
| Kullanıcılar        | admin, ev sahibi                                        |
| Prensip             | learnability · Öngörülebilirlik (predictability)        |
| Sezgisel madde      | H13 — Feedforward                                       |
| WCAG                | 3.3.2 Etiketler veya Talimatlar (A)                     |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:admin                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** RUNTIME p5-compliance.mjs: DSA bildiriminde karar varsayılanı NO_ACTION, ama 'Dayanak' select'i görünür (groundVisible=true). Bu değer yalnızca REMOVED'da gönderiliyor (satır 218). İtirazda varsayılan sonuç ['REJECTED'] (AppealQueue.tsx:49,75). Takedown'da İlan kimliği ve Gerekçe required, Evrak no isteğe bağlı, ama etiketlerde fark yok; boş gönderimde yalnızca tarayıcı balonu çıkıyor.

**Etki:** Admin anlamsız bir alanı doldurmaya zaman harcıyor ve hangi seçimin etkili olduğunu öngöremiyor. 'Ret' ön seçimi aceleyle verilen kararları itiraz edenin aleyhine çeviriyor (DSA md. 20 adilliği).

**Önerilen aksiyon:** 'Dayanak' alanını yalnızca 'Kaldır' seçiliyken gösterin (AppealQueue'daki needsGround kalıbı gibi). İtiraz sonucunda varsayılan bırakmayın, seçimi zorunlu tutun. Etiketlere '(zorunlu)' ya da '(isteğe bağlı)' ekleyin.

## F506 — Form alanı kenarlıkları 1.47:1 kontrastta; bildirim formu ortak inputClass yerine kendi stilini kullanıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/compliance/NoticeForm.tsx:17` |
| Diğer konumlar      | `src/components/ui/ui.tsx`                    |
| Kullanıcılar        | misafir, ev sahibi                            |
| Prensip             | accessibility · Algılanabilirlik / tutarlılık |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 1.4.11 Non-text Contrast (AA)                 |
| Renk/tema           | Evet — kapsam dışı                            |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:compliance                            |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                   |

**Kanıt:** p12, açık tema: input border rgb(209,213,219), kart arka planı rgb(255,255,255), oran 1.47:1. Input dolgusu da beyaz olduğundan alanın sınırını yalnızca kenarlık belirliyor (RT/crops/compliance/028-anon-tr-desktop-_report-0.png). Koyu temada rgb(75,85,99) ile rgb(17,24,39) arasında 2.35:1. NoticeForm.tsx:17 border-gray-300 ve focus:ring-1 kullanıyor; ortak inputClass (ui.tsx:21) ise border-gray-400 ve focusRing kullanıyor. AppealForm ortak sınıfı kullandığı için iki form tutarsız.

**Etki:** Az gören kullanıcı ve parlak ortamda mobil kullanıcı alanların sınırlarını seçmekte zorlanıyor.

**Önerilen aksiyon:** Renk dışı adım: NoticeForm'da ortak inputClass'ı kullanın (tutarlılık). 3:1 eşiğine ulaşmak için kenarlığı gray-500 (#6b7280, yaklaşık 4.8:1) yapmak gerekiyor; bu bir palet kararı.

## F507 — Gönderim sonrası ekran çıkmaz: sonraki adım, geri dönüş ve kopyalanabilir referans yok

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Gözlemlendi                                                                      |
| Konum               | `src/components/compliance/NoticeForm.tsx:62`                                    |
| Diğer konumlar      | `messages/tr/compliance.json`                                                    |
| Kullanıcılar        | misafir, ev sahibi                                                               |
| Prensip             | robustness · Task conformance / observability: işlem sonrası sürecin görünürlüğü |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                |
| Renk/tema           | Hayır                                                                            |
| Efor                | S                                                                                |
| Kaynak denetçiler   | runtime:compliance                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                     |

**Kanıt:** p3 sonrası main içeriği yalnızca H1, giriş metni ve 'Bildiriminiz alındı. Başvuru numaranız: cmv2xa4e4003vkd9zfp46lk49. Onay e-postası gönderildi.' satırından oluşuyor; main içindeki etkileşimli öğeler = []. propertyId bilindiği halde 'İlana dön' bağlantısı yok; 'Başka bir içerik bildir', 'Kopyala' ve 'Ne olacak?' (inceleme süresi, karar e-postası, md. 20 itiraz hakkı) bilgileri yok. Referans, 25 karakterlik gruplanmamış küçük harfli bir cuid.

**Etki:** Kullanıcı kontrolü kaybediyor: geri dönmek için tarayıcı geri tuşuna ya da header'a muhtaç kalıyor. Referansı not almak hataya açık. Sürecin nasıl ilerleyeceği belirsiz kaldığı için destek talepleri artar.

**Önerilen aksiyon:** Başarı kartına h2 ekleyin. Referansı monospace ve gruplanmış gösterip yanına 'Kopyala' butonu koyun. 2-3 maddelik bir 'Bundan sonra ne olacak?' listesi ekleyin: insan incelemesi, karar ve gerekçe e-postası, itiraz hakkı. Eylem olarak 'İlana dön' (/property/{id}), 'Ana sayfa' ve 'Başka bir içerik bildir' sunun.

## F508 — Bildirim formu tarayıcının geçici balonlarına dayanıyor; itiraz formunun satır içi hata deseniyle tutarsız

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/compliance/NoticeForm.tsx:72`                    |
| Diğer konumlar      | `src/components/compliance/AppealForm.tsx`                       |
| Kullanıcılar        | misafir, ev sahibi                                               |
| Prensip             | learnability · Consistency (tutarlılık)                          |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                      |
| WCAG                | 3.3.1 Error Identification (A), 3.3.2 Labels or Instructions (A) |
| Renk/tema           | Hayır                                                            |
| Efor                | M                                                                |
| Kaynak denetçiler   | runtime:compliance                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                     |

**Kanıt:** p1, desktop: boş gönderimde yalnızca ilk alan (#notice-contentUrl) odaklanıyor ve uygulama dilinden bağımsız tarayıcı balonu çıkıyor ('Please fill out this field.'; headless Chromium'da İngilizce). explanation, email ve goodFaith da invalid ama görsel olarak işaretlenmiyor; tüm alanlarda aria-invalid=null. Dört hatayı görmek için dört ayrı gönderim gerekti (adım A-E). Balon birkaç saniye sonra kayboluyor. RT/crops/compliance/p1-empty-desktop.png. Buna karşılık AppealForm.tsx:67 noValidate ile Field error (satır içi, kalıcı, aria-invalid) kullanıyor.

**Etki:** Hatalar tek tek ve kalıcı olmayan biçimde keşfediliyor. Düşük okuryazarlığa sahip ya da büyüteç kullanan kullanıcı balonu kaçırıyor. Aynı uyum alanındaki iki form farklı davranıyor.

**Önerilen aksiyon:** Forma noValidate ekleyin. Zod şemasının istemci tarafındaki eşiyle tüm alanları tek seferde doğrulayın. Her alanın altında kalıcı Field error ve üstte bağlantılı bir hata özeti gösterin. AppealForm ile aynı ortak bileşeni kullanın.

## F509 — URL alanı hatırlamaya dayanıyor ve şeması olmayan adresi açıklamasız reddediyor; bildirilen ilan tanınabilir değil

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/compliance/NoticeForm.tsx:77` |
| Kullanıcılar        | misafir, ev sahibi                            |
| Prensip             | learnability · Predictability / familiarity   |
| Sezgisel madde      | H6 — Tanıma > hatırlama                       |
| Renk/tema           | Hayır                                         |
| Efor                | M                                             |
| Kaynak denetçiler   | runtime:compliance                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** p13, mobile: 'www.ornek.com/ilan/123' girildiğinde invalid, yalnızca 'Please enter a URL.' mesajı çıkıyor. 'localhost:3000/property/abc' ise geçerli sayılıyor. placeholder=null, ipucu yok (#notice-contentUrl-hint sayısı 0). Trust center'dan açılan genel /report'ta URL boş geliyor; kullanıcı ilanı başka sekmede bulup adresini kopyalamak zorunda. propertyId ile gelindiğinde (p2) alanda yalnızca ham 'http://localhost:3000/property/cmv2uydl30fot92w2i9c8a4fa' adresi var; ilan adı ya da fotoğrafı gösterilmiyor (main metni yalnızca form etiketlerinden oluşuyor).

**Etki:** Mobil kullanıcı URL kopyalama ve yapıştırma ile uğraşırken hata yapıyor. Doğru ilanı bildirdiğinden emin olamıyor. Teknik bilgisi az kullanıcı 'URL' kavramında takılıyor.

**Önerilen aksiyon:** Alana ipucu ekleyin: 'Örn. https://…/property/… — ilan sayfasındaki "Bu ilanı bildir" bağlantısı alanı otomatik doldurur'. Şema eksikse doğrulamadan önce https:// ekleyerek normalize edin. propertyId varsa salt okunur bir ilan özet kartı (ad, şehir, küçük fotoğraf) ve 'Değiştir' seçeneği gösterin. İsteğe bağlı olarak ilan arama alanı ekleyin.

## F593 — Güven merkezinde bağlantı metni ile hedef uyuşmuyor: 'SBOM indir' özel bir deponun Actions sayfasına gidiyor; üç öğe aynı URL'yi kullanıyor; yayınlanmamış Scorecard'a bağlantı veriliyor

| Alan                | Değer                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                       |
| Durum               | Aday (2 kaynak birleşti)                                                                                                     |
| Konum               | `src/app/trust/page.tsx:32`                                                                                                  |
| Diğer konumlar      | `src/app/trust/page.tsx:47`, `messages/tr/trustCenter.json:6`, `messages/tr/trustCenter.json:3`, `src/app/trust/page.tsx:48` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                           |
| Prensip             | learnability · predictability                                                                                                |
| Sezgisel madde      | H13 — Feedforward                                                                                                            |
| WCAG                | 2.4.4                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                        |
| Efor                | S                                                                                                                            |
| Kaynak denetçiler   | area:compliance, lens:a11y                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                 |

**Kanıt:** trust/page.tsx:32-34'te sbom, provenance ve scorecard'ın üçü de `href: SECURITY_WORKFLOW_URL`. tr trustCenter.json:6 "SBOM (CycloneDX) indir"; :7 "(depo erişimi gerekir)"; :11 "Yayınlanmadı: depo şu an özel (private)". :47 güvenlik politikası da aynı özel depoya (SECURITY_POLICY_URL, :11) gidiyor. pageIntro (:3) "Buradaki her bağlantı kamuya açık bilgi içerir" diyor.

**Etki:** Bağlantıya tıklayan misafir dosya indirmek yerine erişim olmadığı için GitHub 404 sayfasıyla karşılaşır. Aynı hedefe giden üç farklı metin ve 'kamuya açık' vaadi güveni azaltır; bu, sayfanın amacının tersidir.

**Önerilen aksiyon:** Bağlantı metinlerini davranışı anlatacak şekilde değiştirin, ör. 'SBOM'u üreten iş akışı (GitHub, depo erişimi gerekir)'. Scorecard'ı bağlantı olmaktan çıkarıp düz metin ve 'Yayınlanmadı' durum etiketi olarak gösterin. SECURITY.md içeriğini uygulamadan servis edin (/.well-known/security.txt ya da /security-policy). pageIntro'yu 'Bazı kaynaklar depo ya da yönetici erişimi gerektirir' olarak düzeltin.

## F772 — Uyum sayfası uzun ve tek parça: bölüm içi gezinme ve sayaç yok, bölüm sırası mantıksız, giriş metni bölümleri eksik sayıyor

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                    |
| Durum               | Aday                                                                                      |
| Konum               | `src/app/admin/compliance/page.tsx:19`                                                    |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:207`, `messages/tr/compliance.json:30` |
| Kullanıcılar        | admin                                                                                     |
| Prensip             | flexibility · multithreading / efficiency                                                 |
| Sezgisel madde      | H7 — Esneklik/verim                                                                       |
| WCAG                | 2.4.5                                                                                     |
| Renk/tema           | Hayır                                                                                     |
| Efor                | M                                                                                         |
| Kaynak denetçiler   | area:compliance                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                              |

**Kanıt:** admin/compliance/page.tsx:19-23'te ComplianceDashboard, AppealQueue ve AccessibilityReviewQueue art arda render ediliyor. ComplianceDashboard.tsx:207'deki 'Şeffaflık raporu' kartı, bildirimler ile itirazlar arasına düşüyor. Kartların id'leri var (takedowns, notices, transparency, appeals, accessibility-review) ama bunlara bağlantı veren bir nav yok. Giriş metni (tr compliance.json:30) "7565 kaldırma talepleri (24 saat SLA), DSA bildirimleri ve şeffaflık raporu." itirazları ve erişilebilirlik kuyruğunu saymıyor.

**Etki:** Her biri 200 öğeye kadar uzayabilen ve her öğesinde form bulunan beş bölümde, itiraz kuyruğuna ulaşmak için yüzlerce alan geçmek gerekir. Hangi kuyrukta iş biriktiği sayfanın başında görünmez.

**Önerilen aksiyon:** PageShell intro'sunun altına `<nav aria-label="Uyum bölümleri">` ekleyin; içinde #takedowns, #notices, #appeals, #accessibility-review ve #transparency bağlantıları ile bekleyen sayılar ('Bildirimler (12)') olsun. Şeffaflık kartını en sona taşıyın. intro metnine '…, md. 20 itirazları ve erişilebilirlik doğrulama kuyruğu' ekleyin.

## F773 — İtiraz sayfasında gerekçeli karar bildirimi kapalı geliyor ve iki dilli ham metin (ISO zaman damgası) olarak sunuluyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/app/report/appeal/page.tsx:63`           |
| Diğer konumlar      | `src/lib/compliance/dsa.ts:157`               |
| Kullanıcılar        | misafir, ev sahibi                            |
| Prensip             | learnability · familiarity / synthesizability |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                   |
| Renk/tema           | Hayır                                         |
| Efor                | M                                             |
| Kaynak denetçiler   | area:compliance                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** appeal/page.tsx:63-70 `<details className="mt-3"><summary ...>{t("statement")}</summary><pre ...>{ctx.statementOfReasons}</pre></details>` varsayılan olarak kapalı. İçerik dsa.ts:157-167'den geliyor: "Tarih / Date: 2026-…T…Z", "Kısıtlama / Restriction: İlan yayından kaldırıldı (görünürlük kısıtlaması: tamamen) / Listing removed", "Otomatik araç / Automated means: …".

**Etki:** İtiraz yazacak misafir ya da ev sahibi, kararın gerekçesini (itirazın asıl dayanağını) açılır bölümde aramak zorunda kalır. Açtığında iki dilin karıştığı, ISO tarihli, hukuki jargonla dolu bir metinle karşılaşır; okuryazarlığı düşük kullanıcı ne itiraz edeceğini sentezleyemez.

**Önerilen aksiyon:** Gerekçeyi yapılandırılmış alanlardan (decisionGround, legalReference, facts) etkin dilde bir <dl> olarak gösterin: 'Dayanak', 'Hukuki referans', 'Olgular ve gerekçe'. Tarihi f.dateTime ile biçimlendirin. Ham resmî metni 'Resmî karar metni (TR/EN)' başlıklı ayrı bir <details> içinde tutun. Olgular bölümü varsayılan olarak açık gelsin.

## F774 — Güven merkezi açıklanmamış teknik jargonla dolu, ama sayfa global footer'dan tüm misafirlere açık

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | Medium                                                                  |
| Durum               | Aday                                                                    |
| Konum               | `src/app/trust/page.tsx:64`                                             |
| Diğer konumlar      | `messages/tr/trustCenter.json:7`, `src/components/layout/Footer.tsx:57` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | learnability · familiarity                                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                             |
| WCAG                | 3.1.3                                                                   |
| Renk/tema           | Hayır                                                                   |
| Efor                | S                                                                       |
| Kaynak denetçiler   | area:compliance                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                            |

**Kanıt:** tr trustCenter.json:7 "sbom-cyclonedx artefaktı", :9 "SLSA provenance", :15-16 "JWKS", "ES256 açık anahtarları", "Ajan yetkilerini (mandate)", :17 "OpenAPI 3.1 sözleşmesi". Footer.tsx:57-62 /trust'a her sayfadan bağlantı veriyor. trust/page.tsx:28-54 bölüm sırası: tedarik zinciri, API'ler, en sonda misafiri ilgilendiren politikalar.

**Etki:** Bilgisayar okuryazarlığı düşük misafir 'Güven merkezi'ne güvenlik ya da veri koruma bilgisi aramak için girer, ilk iki bölümü anlamaz. Kendisi için yararlı olan 'Yasa dışı içerik bildir' ve 'Gizlilik' bağlantıları sayfanın en altında kalır.

**Önerilen aksiyon:** Sayfanın en üstüne düz dilde bir özet kartı ekleyin ('Bu sayfada ne var?' 2-3 cümle). 'Politikalar ve şeffaflık' bölümünü ilk sıraya alın. SBOM, SLSA, JWKS gibi kısaltmaları ilk geçtikleri yerde `<abbr title="…">` ile ve notlarda bir cümlelik açıklamayla tanımlayın.

## F775 — Yönetici kuyruklarında yükleniyor göstergesi yok; filtre değişince bir önceki filtrenin listesi gösterilmeye devam ediyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Medium                                                                         |
| Durum               | Aday                                                                           |
| Konum               | `src/components/compliance/AccessibilityReviewQueue.tsx:28`                    |
| Diğer konumlar      | `src/components/ui/ui.tsx:241`, `src/components/compliance/AppealQueue.tsx:38` |
| Kullanıcılar        | admin                                                                          |
| Prensip             | robustness · responsiveness / observability                                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                 |
| Renk/tema           | Hayır                                                                          |
| Efor                | S                                                                              |
| Kaynak denetçiler   | area:compliance                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                   |

**Kanıt:** AccessibilityReviewQueue.tsx:28-34 `useLoader(() => apiFetch(`/api/admin/accessibility?status=${tab}`)..., [tab])`, :58 `aria-pressed={tab === key}` anında değişiyor. ui.tsx:241-262'deki useLoader deps değişince `data`yı sıfırlamıyor ve `loading` döndürmüyor; `setData` yalnızca promise çözülünce çağrılıyor. AppealQueue.tsx:38-42 yüklenirken yalnızca intro gösteriyor; liste ya da boş durum yok.

**Etki:** Yavaş ağda 'Doğrulanmış' sekmesi seçili görünürken bekleyen kayıtlar listeleniyor. Yönetici neye baktığını yanlış yorumlar; ekran okuyucu kullanıcısı yüklemenin sürdüğünden haberdar olmaz.

**Önerilen aksiyon:** useLoader'a `loading` bayrağı ekleyin (deps değişince true yapılsın ve data null'a çekilsin). Bileşenlerde loading sırasında `<p role="status">Yükleniyor…</p>` gösterin, <ul>'ye `aria-busy={loading}` verin. Filtre düğmeleri loading sırasında disabled olsun.

## F776 — Yönetici panelindeki sunucu hata metinleri yerelleştirilmemiş; EN arayüzde Türkçe hata görünüyor ve alan bilgisi verilmiyor

| Alan                | Değer                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:48`                                                                                                                  |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx:64`, `src/components/compliance/AccessibilityReviewQueue.tsx:47`, `src/lib/api-client.ts:40`, `src/components/ui/ui.tsx:266` |
| Kullanıcılar        | admin                                                                                                                                                                   |
| Prensip             | learnability · consistency (i18n)                                                                                                                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                     |
| WCAG                | 3.1.2                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                   |
| Efor                | M                                                                                                                                                                       |
| Kaynak denetçiler   | area:compliance                                                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                            |

**Kanıt:** ComplianceDashboard.tsx:48 `setError(errorMessage(e))` sunucunun `error` alanını olduğu gibi gösteriyor: dsa.ts:129 "Kaldırma kararı için dayanak (ground) zorunlu", errors.ts:154 "Doğrulama hatası", takedown.ts:66 "İlan bulunamadı". api-client.ts:40 `İstek başarısız (${res.status})` ve ui.tsx:266 `fallback = "Beklenmeyen bir hata oluştu"` sabit Türkçe. AppealQueue.tsx:64 ve AccessibilityReviewQueue.tsx:47'de de aynı desen var.

**Etki:** EN dilini seçmiş yönetici Türkçe ve teknik ('ground') hata metinleri görür. 'Doğrulama hatası' hangi alanın (ör. facts en az 10 karakter) eksik olduğunu söylemez, düzeltme deneme yanılmayla yapılır.

**Önerilen aksiyon:** ApiError.code değerlerini compliance.admin.errors.* çeviri anahtarlarına eşleyin (NOTICE_DECIDED, APPEAL_DECIDED, TAKEDOWN_CLOSED, NOT_FOUND, VALIDATION_ERROR, TRANSACTION_CONFLICT). VALIDATION_ERROR'da `details.fieldErrors` değerlerini ilgili Field'lara verin. Bilinmeyen durumlarda `errorMessage(err, tc("unexpectedError"))` kullanın.

## F777 — Kaldırma talebi formu başarılı kayıttan sonra temizlenmiyor; aynı talebin yeniden gönderilme riski var

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Aday                                                   |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:52` |
| Kullanıcılar        | admin                                                  |
| Prensip             | robustness · error prevention                          |
| Sezgisel madde      | H5 — Hata önleme                                       |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:compliance                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** ComplianceDashboard.tsx:52-67 `createTakedown` başarıdan sonra `e.currentTarget.reset()` çağırmıyor. Alanlar kontrolsüz (:119, :122, :125) olduğundan propertyId, Evrak no ve Gerekçe dolu kalıyor. Sunucuda yineleme kontrolü yok (takedown.ts:68 `tx.takedownRequest.create`).

**Etki:** Başarı mesajı ekranın üstünde kalırken formu hâlâ dolu gören yönetici tekrar gönderebilir. Böylece aynı yazı için iki talep kaydı ve iki SLA işi oluşur.

**Önerilen aksiyon:** submit başında `const formEl = e.currentTarget;` saklayın ve başarıdan sonra `formEl.reset()` çağırın. İlk alana (td-source) odaklanın. Sunucuda aynı propertyId + referenceNo için açık talep varsa 409 döndürmeyi değerlendirin.

## F778 — Kaldırma talebi formunda yazının alındığı zaman girilemiyor; SLA kayıt anından başlıyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Aday                                                   |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:59` |
| Diğer konumlar      | `src/lib/compliance/takedown.ts:45`                    |
| Kullanıcılar        | admin                                                  |
| Prensip             | robustness · task conformance                          |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                            |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:compliance                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** ComplianceDashboard.tsx:59-64 gövdesi `{ source, propertyId, referenceNo, reason }` içeriyor, receivedAt yok. takedown.ts:45-46 `/** Yazının alındığı an (verilmezse şimdi). SLA bu andan sayılır. */ receivedAt: z.coerce.date().optional()`.

**Etki:** Bakanlık yazısı sabah gelip öğleden sonra sisteme girildiğinde SLA bitişi ve şeffaflık raporundaki süreler olduğundan iyi görünür; yasal 24 saatlik süre panelde yanlış izlenir.

**Önerilen aksiyon:** Forma `<input type="datetime-local" name="receivedAt">` alanı ekleyin. Etiket 'Yazının alındığı tarih ve saat', varsayılan şimdi, max şimdi olsun. Hint: '24 saatlik süre bu andan başlar.' Değer ISO formatında gönderilsin.

## F779 — Şeffaflık raporunun dönemi 'bu yıl'a sabit; geçmiş dönem dışa aktarılamıyor ve JSON aynı sekmede ham açılıyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Aday                                                   |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:99` |
| Diğer konumlar      | `src/app/api/admin/compliance/transparency/route.ts:7` |
| Kullanıcılar        | admin                                                  |
| Prensip             | flexibility · customizability                          |
| Sezgisel madde      | H7 — Esneklik/verim                                    |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:compliance                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** ComplianceDashboard.tsx:99-102 `const from = `${now.getUTCFullYear()}-01-01`; const to = ...; const reportUrl = ...`; :209 ve :213 bağlantıları sabit. API keyfî aralığı destekliyor (api/admin/compliance/transparency/route.ts:7-11 `from`, `to`). :213 JSON bağlantısı aynı sekmede ham JSON açıyor; oturum süresi dolduysa {"error":"Oturum açmanız gerekiyor"} gösteriyor.

**Etki:** Ocak ayında geçen yılın yıllık DSA raporunu hazırlayacak yönetici bunu arayüzden indiremez; URL'yi elle düzenlemesi gerekir. JSON'a tıklayan yönetici panelden çıkar.

**Önerilen aksiyon:** Karta iki `<input type="date">` (Başlangıç, Bitiş; label'lı) ve 'Bu yıl / Geçen yıl / Son 6 ay' hazır seçimleri ekleyin; URL state'ten üretilsin. CSV bağlantısına `download` özniteliği ekleyin. JSON bağlantısına `target="_blank" rel="noopener"` ve görünür '(yeni sekmede açılır)' metni ekleyin.

## F780 — Satır/kalem eylemlerinin geri bildirimi eylemden uzakta ve hangi öğeye ait olduğunu söylemiyor

| Alan                | Değer                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                          |
| Durum               | Aday                                                                                                                                            |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:107`                                                                                         |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:322`, `src/components/compliance/AppealQueue.tsx:71`, `src/components/host/PromotionsPanel.tsx:116` |
| Kullanıcılar        | admin, ev sahibi                                                                                                                                |
| Prensip             | robustness · observability                                                                                                                      |
| Sezgisel madde      | H12 — Feedback                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                           |
| Efor                | S                                                                                                                                               |
| Kaynak denetçiler   | lens:status                                                                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                    |

**Kanıt:** ComplianceDashboard.tsx:107 sayfanın tek Status'u en üstte; alttaki bildirim kararı formundan (199) ekran boyu uzakta. AccessibilityPanel.tsx:322 Status kartın en altında; satır içi kanıt seçimi (221 `onChange={(e) => void setEvidence(feature, e.target.value)}`) ve 'Sil' sonuçları oraya düşüyor. AppealQueue.tsx:71 Status listenin üstünde. PromotionsPanel.tsx:116-127 `toggle` başarıda hiç mesaj vermiyor.

**Etki:** Yönetici/ev sahibi uzun listede işlemin sonucunu görmek için kaydırmak zorunda; görsel geri bildirim kaçırılıyor, aynı işlem tekrarlanıyor.

**Önerilen aksiyon:** Sonuç mesajını eylemin yapıldığı satırda (role=status, öğe adıyla) göster; sayfa düzeyi Status'u yalnız yükleme hataları için kullan; PromotionsPanel toggle'da '‘Erken rezervasyon %10’ pasifleştirildi'.

## F781 — Kaldırma talepleri listesinde açık ve kapalı talepler karışık; filtre, sıralama, boş durum ve alt başlık yok

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:131` |
| Diğer konumlar      | `src/lib/compliance/takedown.ts:270`                    |
| Kullanıcılar        | admin                                                   |
| Prensip             | flexibility · customizability                           |
| Sezgisel madde      | H7 — Esneklik/verim                                     |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** ComplianceDashboard.tsx:131-147 `(takedowns.data ?? []).map(...)` statü filtresi olmadan geliyor (takedown.ts:270-276 `take: 200`, receivedAt desc). Liste formun hemen altında başlıksız duruyor; boş liste mesajı yok. API `?status=` parametresini destekliyor (api/admin/takedowns/route.ts:14-17).

**Etki:** Zamanla yüzlerce kapalı talep, açık ve SLA'sı yaklaşan talepleri listenin altına iter. Yönetici acil talebi bulmak için listeyi taramak zorunda kalır.

**Önerilen aksiyon:** Listeye `<h3>Kayıtlı talepler</h3>` ekleyin. AccessibilityReviewQueue'daki gibi aria-pressed ile çalışan 'Açık / Kapalı / Tümü' filtresi koyun (varsayılan Açık). Açık talepleri slaDueAt'e göre artan sıralayın. Boş liste için 'Kayıtlı talep yok.' mesajı gösterin.

## F782 — Kaldırma talepleri listesi ham kimlikleri ve UTC ISO dilimini gösteriyor; ilan adı ve bağlantısı yok

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:135` |
| Diğer konumlar      | `src/lib/i18n/format.ts:68`                             |
| Kullanıcılar        | admin                                                   |
| Prensip             | learnability · familiarity                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                             |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** ComplianceDashboard.tsx:135 `<strong>{td.referenceNo ?? td.id}</strong> — {td.propertyId} —`, :137 `t("slaDue", { at: td.slaDueAt.slice(0, 16).replace("T", " ") })` → "SLA bitişi 2026-10-11 14:30 UTC". Yerelleştirilmiş formatlayıcı mevcut ama kullanılmıyor (src/lib/i18n/format.ts:68 `dateTime(value, timeZone)`).

**Etki:** Türkiye'deki yönetici 24 saatlik yasal süreyi kafasında UTC+3'e çevirmek zorunda kalır, saat hesabında hata yapabilir. Satırda hangi ilanın kaldırıldığı (yalnızca cuid görünüyor) ve evrak no ile iç kimliğin hangisinin hangisi olduğu anlaşılmıyor.

**Önerilen aksiyon:** `const f = useFormat()` ile `f.dateTime(td.slaDueAt, "Europe/Istanbul")` kullanın ve kalan süreyi ekleyin ('12 sa 30 dk kaldı'). Satırı <dl> ile yapılandırın: 'Evrak no', 'İlan' (başlık + /property/{id} bağlantısı), 'Durum', 'SLA bitişi'.

## F783 — Tekrarlanan denetimlerin adları bağlamsız ('Kapat', 'Kararı kaydet', 'Doğrula', 'Kanıt fotoğrafı', 'Karar') ve öğe başlıkları yok

| Alan                | Değer                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                                                                  |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:141`                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:199`, `src/components/compliance/AppealQueue.tsx:107`, `src/components/compliance/AppealQueue.tsx:151`, `src/components/compliance/AccessibilityReviewQueue.tsx:100`, `src/components/compliance/AccessibilityReviewQueue.tsx:104` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                                 |
| Prensip             | accessibility · Headings and Labels (WCAG 2.4.6)                                                                                                                                                                                                                                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                 |
| WCAG                | 2.4.6                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                 |
| Efor                | S                                                                                                                                                                                                                                                                                     |
| Kaynak denetçiler   | area:compliance                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                          |

**Kanıt:** ComplianceDashboard.tsx:141-143 her satırda `{t("close")}` ("Kapat"), :199 `{t("decide")}`, :163 'Karar' etiketi her bildirimde aynı. AppealQueue.tsx:107 legend 'Sonuç', :151 'İtiraz kararını kaydet'. AccessibilityReviewQueue.tsx:100 `{t("evidence")}` bağlantısı ve :104-108 'Doğrula' düğmesi her satırda aynı metne sahip. Öğe başlığı olarak heading değil `<p className="font-semibold">` kullanılıyor (AppealQueue.tsx:79, AccessibilityReviewQueue.tsx:79). Formların erişilebilir adı yok.

**Etki:** Ekran okuyucu kullanıcısı düğme ya da form alanı listesinde 'Kapat, Kapat, Kapat…' duyar; hangi talebi kapatacağını bilemez. Başlık gezinmesiyle öğeler arasında atlayamaz. Ayrıca 'Kapat' bir iletişim kutusunu kapatma eylemiyle karıştırılabilir.

**Önerilen aksiyon:** Bağlamlı aria-label ekleyin, ör. `aria-label={t("closeLabel", { ref: td.referenceNo ?? td.id })}` → '{ref} numaralı talebi kapat', ve görünür metni 'Talebi kapat' yapın. Her <li> içine `<h3 id=...>` (kategori + alan adı / rol + tarih / özellik + ilan) koyun ve `<form aria-labelledby={h3Id}>` verin. Kanıt bağlantısına `aria-label={`${t("evidence")}: ${t(`codes.${row.code}`)} – ${row.propertyTitle}`}` ekleyin.

## F784 — Bildirim kaydında karar için gereken bağlam eksik: alınma zamanı, bekleme süresi, ilan, bildiren ve bekleyen sayısı

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:153` |
| Diğer konumlar      | `src/lib/compliance/dsa.ts:234`                         |
| Kullanıcılar        | admin                                                   |
| Prensip             | robustness · observability                              |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                          |
| Renk/tema           | Hayır                                                   |
| Efor                | M                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** ComplianceDashboard.tsx:153-161'de her bildirim için yalnızca kategori, URL ve açıklama gösteriliyor. dsa.ts:234-239 `listNotices` tüm alanları (createdAt, reporterName, propertyId) döndürüyor ama NoticeRow (:17-22) bunları atıyor. Kart başlığı (:150) `t("notices")` herhangi bir sayı içermiyor.

**Etki:** Yönetici hangi bildirimin en uzun süredir beklediğini göremez, önceliklendiremez; hangi ilanı kaldıracağını da URL'den tahmin etmek zorunda kalır. DSA 'gecikmeksizin' işlem beklentisi takip edilemez.

**Önerilen aksiyon:** Her öğede 'Alındı: {f.dateTime(createdAt)} · {saat} saattir bekliyor' satırı, ilan başlığı bağlantısı ve bildirenin adı gösterilsin. Liste en eski önce sıralansın. Kart başlığı 'Bekleyen DSA bildirimleri ({n})' biçiminde olsun.

## F785 — Bildirim kategorisi ham enum kodu olarak gösteriliyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:156` |
| Kullanıcılar        | admin                                                   |
| Prensip             | learnability · familiarity                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                             |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** ComplianceDashboard.tsx:156 `<strong>{n.category}</strong>` ekranda "FRAUD_SCAM", "IP_INFRINGEMENT" olarak görünüyor. Çeviriler mevcut: messages/tr/compliance.json:8-16 `report.categories` ("Dolandırıcılık", "Fikrî mülkiyet ihlali"…).

**Etki:** Yönetici kategoriyi büyük harfli, alt çizgili kodlardan okumak zorunda kalıyor. Ekran okuyucu 'FRAUD underscore SCAM' gibi okuyor; EN ve TR arayüzde aynı kod çıkıyor.

**Önerilen aksiyon:** `const tr = useTranslations("compliance.report");` tanımlayıp `<strong>{tr(`categories.${n.category}`)}</strong>` kullanın.

## F786 — Yönetici kuyruklarındaki içerik ve ilan bağlantıları aynı sekmede açılıyor; yazılmakta olan gerekçe kayboluyor

| Alan                | Değer                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                      |
| Durum               | Aday                                                                                                        |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:157`                                                     |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx:86`, `src/components/compliance/AccessibilityReviewQueue.tsx:84` |
| Kullanıcılar        | admin                                                                                                       |
| Prensip             | robustness · recoverability                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                           |
| Renk/tema           | Hayır                                                                                                       |
| Efor                | S                                                                                                           |
| Kaynak denetçiler   | area:compliance                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                |

**Kanıt:** ComplianceDashboard.tsx:157 `<a className="text-[#003580] underline" href={n.contentUrl}>` ile AppealQueue.tsx:86-89 `<a ... href={row.notice.contentUrl}>` ve AccessibilityReviewQueue.tsx:84 `<a href={`/property/${row.propertyId}`} ...>` aynı sekmede açılıyor. Karar alanları kontrolsüz textarea'lar (ComplianceDashboard.tsx:186-193, AppealQueue.tsx:139-147) ve kalıcı bir taslak tutulmuyor.

**Etki:** Yönetici olgular metnini yazarken içeriği doğrulamak için URL'ye tıklarsa sayfadan çıkar. Geri döndüğünde istemci tarafı state ve yazdığı gerekçe kaybolur; kuyruğu yeniden yüklemesi gerekir.

**Önerilen aksiyon:** Bu bağlantılara `target="_blank" rel="noopener noreferrer"` ve görünür ya da sr-only '(yeni sekmede açılır)' metni ekleyin. Ek olarak facts ve response alanlarının taslaklarını sessionStorage'da öğe id'sine göre saklayın (try/catch içinde).

## F787 — 'Kaldır' seçeneği bir ilana bağlı olmayan bildirimlerde de sunuluyor; bildirimin ilanla ilişkisi gösterilmiyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Aday                                                    |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:170` |
| Diğer konumlar      | `src/lib/compliance/dsa.ts:183`                         |
| Kullanıcılar        | admin                                                   |
| Prensip             | robustness · error prevention                           |
| Sezgisel madde      | H5 — Hata önleme                                        |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:compliance                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** ComplianceDashboard.tsx:17-22 `interface NoticeRow { id; contentUrl; category; explanation }`: propertyId istemciye alınmıyor. :170 `<option value="REMOVED">` her bildirimde sunuluyor. Sunucu dsa.ts:183-184'te `throw new ValidationError("İlana bağlı olmayan bildirimde kaldırma uygulanamaz")` ile reddediyor.

**Etki:** Yönetici olgular metnini yazıp 'Kaldır'ı seçtikten sonra hata alır; bu hata da sayfanın en üstünde gösterildiği için çoğu zaman fark edilmez. Kaldırılamaz bir içerik için zaman harcanır.

**Önerilen aksiyon:** NoticeRow'a propertyId ekleyin (API zaten döndürüyor, dsa.ts:234-239) ve mümkünse ilan başlığını da alın. propertyId null ise REMOVED seçeneğini `disabled` yapın ve Field hint'i olarak 'Bu bildirim bir ilana bağlı değil; yalnızca İşlem yapma seçilebilir' metnini gösterin. propertyId varsa 'İlan: {başlık}' bağlantısını görüntüleyin.

## F788 — İlandan bildirim akışında ilan adı gösterilmiyor; URL değiştirilebilir ama gizli propertyId sabit kalıyor; ön-doldurma hydration'a bağlı

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/compliance/NoticeForm.tsx:27` |
| Diğer konumlar      | `src/app/report/page.tsx:19`                  |
| Kullanıcılar        | misafir                                       |
| Prensip             | learnability · predictability / feedforward   |
| Sezgisel madde      | H13 — Feedforward                             |
| Renk/tema           | Hayır                                         |
| Efor                | M                                             |
| Kaynak denetçiler   | area:compliance                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** NoticeForm.tsx:27-30 `propertyId && typeof window !== "undefined" ? `${window.location.origin}/property/${propertyId}` : ""`: sunucu render'ında boş, istemcide dolu oluyor (hydration uyumsuzluğu). :41 `propertyId: propertyId || undefined` her durumda gönderiliyor; kullanıcı :79'daki `defaultValue={defaultUrl}` alanını başka bir içerikle değiştirse bile. report/page.tsx:19 yalnızca ID'yi geçiriyor, ilan başlığını geçirmiyor.

**Etki:** 'Bu ilanı bildir' ile gelen misafir hangi ilanı bildirdiğini yalnızca uzun bir URL'den anlamaya çalışır. URL'yi başka bir ilanla değiştirirse bildirim yine ilk ilana bağlanır ve kaldırma kararı yanlış ilanı etkileyebilir.

**Önerilen aksiyon:** report/page.tsx'te (server) ilan başlığını getirin; contentUrl'yi sunucuda NEXT_PUBLIC_APP_URL ile oluşturup prop olarak geçirin. Formun üstünde salt okunur bir özet gösterin: 'Bildirilen ilan: {başlık}'. Yanına 'Başka bir içerik bildir' bağlantısı koyun (propertyId'siz /report). Kullanıcı contentUrl'yi değiştirirse propertyId'yi düşürün.

## F789 — Sunucu hata kodları genel bir mesaja indirgeniyor; geçersiz propertyId bildirimi kalıcı bir çıkmaza sokuyor

| Alan                | Değer                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                      |
| Durum               | Aday                                                                                                        |
| Konum               | `src/components/compliance/NoticeForm.tsx:57`                                                               |
| Diğer konumlar      | `src/components/compliance/AppealForm.tsx:46`, `src/lib/compliance/dsa.ts:93`, `src/lib/http/errors.ts:153` |
| Kullanıcılar        | misafir, ev sahibi                                                                                          |
| Prensip             | robustness · recoverability                                                                                 |
| Sezgisel madde      | H9 — Hata mesajları                                                                                         |
| WCAG                | 3.3.3                                                                                                       |
| Renk/tema           | Hayır                                                                                                       |
| Efor                | M                                                                                                           |
| Kaynak denetçiler   | area:compliance                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                |

**Kanıt:** NoticeForm.tsx:57-59 `res?.status === 400 ? t("invalid") : t("error")` → "Lütfen tüm zorunlu alanları doğru doldurun." Yanıttaki `details: error.flatten()` (errors.ts:153-155) kullanılmıyor. dsa.ts:93 `throw new ValidationError("Bildirilen ilan bulunamadı")` da aynı 400 mesajına düşüyor; propertyId URL'den geldiği ve formda görünmediği için (:41 `propertyId: propertyId || undefined`) her deneme başarısız oluyor. AppealForm.tsx:46-54'te 403 APPEAL_TOKEN_INVALID, 404 ve NOTICE_NOT_DECIDED için 'İtiraz gönderilemedi. Lütfen tekrar deneyin.' gösteriliyor; yeniden denemek işe yaramıyor.

**Etki:** Kaldırılmış bir ilanı bildirmek isteyen misafir tüm alanları doğru doldursa da sonsuza kadar 'alanları doğru doldurun' hatası alır ve görevi tamamlayamaz. Hangi alanın hatalı olduğu söylenmediği için deneme yanılmaya zorlanır.

**Önerilen aksiyon:** 400 yanıtında `details.fieldErrors` anahtarlarını (contentUrl, explanation, reporterEmail…) ilgili Field `error` prop'larına eşleyin. 'Bildirilen ilan bulunamadı' durumunu ayrı bir koda bağlayın: istemci propertyId'yi düşürsün ve 'Bu ilan artık bulunamadı; içerik adresini kontrol edip yeniden gönderin' desin. AppealForm'da 403/404 için `t("invalidLink")`, NOTICE_NOT_DECIDED için ayrı bir metin gösterin.

## F790 — Formlar tarayıcının yerleşik doğrulamasına bırakılmış: mesajlar uygulama dilinde değil, AppealForm ile tutarsız ve zorunlu alanlar işaretli değil

| Alan                | Değer                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                              |
| Konum               | `src/components/compliance/NoticeForm.tsx:72`                                                                                                                     |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:110`, `src/components/compliance/ComplianceDashboard.tsx:162`, `src/components/compliance/AppealQueue.tsx:105` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                         |
| Prensip             | learnability · consistency / Labels or Instructions                                                                                                               |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                               |
| WCAG                | 3.3.2                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                             |
| Efor                | M                                                                                                                                                                 |
| Kaynak denetçiler   | area:compliance                                                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                      |

**Kanıt:** NoticeForm.tsx:72 `<form onSubmit={submit} className="space-y-4">` noValidate içermiyor; :77 `type="url" required`, :103 `minLength={20}`, :129 checkbox `required` doğrulamayı tarayıcıya bırakıyor. AppealForm.tsx:67 ise `noValidate` ve Field `error` ile yerelleştirilmiş hata gösteriyor. Yönetici formlarında da aynı durum var: ComplianceDashboard.tsx:110, :162; AppealQueue.tsx:105. Zorunluluk işareti yok; yalnızca "Adınız (isteğe bağlı)" yazıyor (tr compliance.json:18). "Evrak no" ve "Hukuki referans" isteğe bağlı olduğu hâlde bu belirtilmiyor (:40, :67).

**Etki:** İngilizce tarayıcıda TR sitede "Please enter a URL." çıkar. Baloncuk birkaç saniyede kaybolur. type=url alanı 'https://' olmadan girilen 'www.site.com' değerini reddeder, ama bunu önceden söyleyen bir ipucu yok. Okuryazarlığı düşük misafir neyi yanlış yaptığını anlamaz.

**Önerilen aksiyon:** Formlara `noValidate` ekleyin. submit'te alan bazlı kontrol yapın ve yerelleştirilmiş mesajları Field `error` prop'u ile gösterin; ilk hatalı alana focus() yapın. contentUrl Field'ına hint ekleyin: 'https:// ile başlayan tam adres'. İsteğe bağlı alan etiketlerine tutarlı olarak '(isteğe bağlı)' ekleyin: 'Evrak no (isteğe bağlı)', 'Hukuki referans (isteğe bağlı)'.

## F1079 — Bildirim türü 'Yasa dışı ilan' olarak önceden seçili; bilinçli seçim yapılmıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Gözlemlendi (2 kaynak birleşti)               |
| Konum               | `src/components/compliance/NoticeForm.tsx:89` |
| Kullanıcılar        | misafir, ev sahibi                            |
| Prensip             | learnability · Predictability                 |
| Sezgisel madde      | H5 — Hata önleme                              |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:compliance, area:compliance           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** Sweep 028/029 ve p2: select varsayılan olarak 'Yasa dışı ilan' gösteriyor. Probe sırasında select'e dokunulmadan gönderilen iki bildirim DB'ye category=ILLEGAL_LISTING olarak kaydedildi.

**Etki:** Dolandırıcılık ya da güvensiz konaklama gibi bildirimler yanlış kategoride kalıyor. Moderasyon önceliklendirmesi ve DSA şeffaflık sayıları bozuluyor.

**Önerilen aksiyon:** Boş bir 'Seçin…' seçeneği ekleyin (value='' ve required). Alternatif olarak her kategoriye bir satırlık açıklama veren bir radio grubu kullanın.

## F1103 — Sayfa başlıkları: /trust genel başlıkla kalıyor; alandaki başlık deseni tutarsız

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Low                                                                         |
| Durum               | Gözlemlendi                                                                 |
| Konum               | `src/app/trust/page.tsx:1`                                                  |
| Diğer konumlar      | `messages/tr/ranking.json`, `src/app/report/page.tsx`, `src/app/layout.tsx` |
| Kullanıcılar        | tümü                                                                        |
| Prensip             | accessibility · Gezinme / yönelim                                           |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                 |
| WCAG                | 2.4.2 Page Titled (A)                                                       |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | runtime:compliance                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** Sweep 024/025: /trust başlığı 'booking-platform — konaklama arama ve rezervasyon (demo)'. p6 EN: /trust başlığı 'booking-platform — search and book stays (demo)', H1 ise 'Trust center'. /ranking 'Sıralama nasıl çalışır? — booking-platform' (marka son ekli), /report 'İçerik bildir' ve /report/appeal 'Karara itiraz' (marka eki yok). Kök neden: trust/page.tsx 'use client' olduğu için metadata export edemiyor.

**Etki:** Sekmeler ve geçmiş listesinde güven merkezi ayırt edilemiyor. Başlık deseni sayfadan sayfaya değişiyor.

**Önerilen aksiyon:** Sayfayı sunucu bileşeni yapın (yalnızca çeviri kullanıyor; getTranslations yeterli) ya da listeyi bir alt istemci bileşenine taşıyıp generateMetadata ile 'Güven merkezi' başlığını verin. Kök layout'ta title.template '%s — booking-platform' kullanıp ranking.metaTitle'daki elle eklenmiş son eki kaldırın.

## F1104 — Dış site ve ham JSON bağlantıları hiçbir şekilde belirtilmiyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Gözlemlendi                   |
| Konum               | `src/app/trust/page.tsx:71`   |
| Kullanıcılar        | tümü                          |
| Prensip             | learnability · Predictability |
| Sezgisel madde      | H13 — Feedforward             |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | runtime:compliance            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** p6: GitHub bağlantılarında target=null, dış bağlantı ikonu ya da sr-only bir ibare yok. JWKS ve OpenAPI bağlantıları aynı sekmede ham JSON açıyor (200, application/jwk-set+json ve application/json).

**Etki:** Misafir habersizce GitHub'a ya da okunamaz bir JSON ekranına düşüyor ve geri dönüş için tarayıcının geri tuşuna muhtaç kalıyor.

**Önerilen aksiyon:** Dış bağlantılara ikon ve sr-only '(GitHub'da açılır)' ekleyin. API bağlantılarına '(JSON, geliştiriciler için)' rozeti koyun.

## F1105 — Güven merkezi açıklamaları masaüstünde satır başına yaklaşık 136 karakter

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Gözlemlendi                            |
| Konum               | `src/app/trust/page.tsx:85`            |
| Kullanıcılar        | tümü                                   |
| Prensip             | learnability · Okunabilirlik           |
| Sezgisel madde      | H8 — Estetik/minimal tasarım           |
| WCAG                | 1.4.8 Visual Presentation (AAA, öneri) |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | runtime:compliance                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** p6, desktop 1280: 'main li p' öğeleri 14px/20px; genişliğe göre tahmin yaklaşık 136 karakter/satır (RT/crops/compliance/024-anon-tr-desktop-_trust-0.png).

**Etki:** Yoğun teknik metinde uzun satırlar satır takibini zorlaştırıyor, okuma hızı ve anlama düşüyor.

**Önerilen aksiyon:** Not paragraflarına max-w-prose (yaklaşık 65ch) verin ya da masaüstünde kartları 2 sütuna bölün.

## F1106 — Erişilebilirlik kuyruğunun filtre düğmeleri eylem düğmeleriyle aynı görünüyor; 'Doğrula' ve 'Doğrulanmış' adları neredeyse aynı

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/components/compliance/AccessibilityReviewQueue.tsx:213` |
| Kullanıcılar        | admin                                                        |
| Prensip             | learnability · Öngörülebilirlik ve affordance                |
| Sezgisel madde      | H11 — Affordance                                             |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:admin                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** crops/admin/p5c-1.png: seçili filtre 'Bekleyen' dolgulu mavi birincil düğme, satır eylemi 'Doğrula' da aynı stilde. p5 probunda Playwright getByRole('button',{name:'Doğrula'}) iki öğeye çözüldü ('Doğrulanmış' ve 'Doğrula').

**Etki:** Filtre ile eylem karışabiliyor. Sesli komut ve arama ile hedeflemek belirsizleşiyor.

**Önerilen aksiyon:** Filtreyi segment/sekme görünümüne çevirin (role=tablist ya da radyo grubu). Adı 'Doğrulananlar' yapın.

## F1107 — SLA son tarihi ham ISO biçiminde ve UTC olarak gösteriliyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Low                                                     |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:265` |
| Kullanıcılar        | admin                                                   |
| Prensip             | learnability · Tutarlılık ve gerçek dünya eşleşmesi     |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                             |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:admin                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** RUNTIME p5-compliance.mjs: 'SLA bitişi 2026-10-11 21:49 UTC' (slaDueAt.slice(0,16)). Aynı uygulamada talepler f.dateTime ile '13.10.2026 00:48' biçiminde gösteriliyor. Probe saat dilimi Europe/Istanbul.

**Etki:** 24 saatlik yasal SLA'da admin UTC'yi zihinde +3 saate çevirmek zorunda; kaçırma riski doğuyor.

**Önerilen aksiyon:** Tarihi f.dateTime ile yerel saatte gösterin ve kalan süreyi ekleyin ('18 sa kaldı'). Son 4 saatte metin uyarısı verin (yalnız renk değil, 'Yaklaşıyor' etiketi).

## F1108 — Mobilde form alanları 14px; iOS odaklanınca sayfayı yakınlaştırıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/compliance/NoticeForm.tsx:17` |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · Responsiveness (mobil uyum)      |
| Sezgisel madde      | H7 — Esneklik/verim                           |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:compliance                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** p13, mobile 390x844: INPUT, SELECT ve TEXTAREA computed font-size değeri 14px (text-sm). iOS Safari, 16px altındaki alanlara odaklanıldığında otomatik yakınlaştırma yapar ve sayfa yatayda kayar.

**Etki:** Mobil misafir her alana dokunduğunda yakınlaştırılmış bir görünümle uğraşıyor ve yatayda kaydırmak zorunda kalıyor.

**Önerilen aksiyon:** Alan sınıfında text-base sm:text-sm kullanın (mobilde 16px).

## F1109 — Ad ve e-posta toplanırken kullanım amacı ve gizlilik bildirimi bağlantısı yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Gözlemlendi                                    |
| Konum               | `src/components/compliance/NoticeForm.tsx:109` |
| Kullanıcılar        | misafir, ev sahibi                             |
| Prensip             | learnability · Predictability                  |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                     |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | runtime:compliance                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** Sweep 028 tabOrder: 'Bildirimi gönder' butonundan sonraki durak footer'daki 'Yardım Merkezi'; main içinde /privacy bağlantısı ya da veri kullanım notu yok (p3'te main içi bağlantı sayısı 0). Form 'Adınız (isteğe bağlı)' ve 'E-posta adresiniz' alanlarını topluyor.

**Etki:** Bildirimde bulunan kişi kimliğinin ev sahibiyle paylaşılıp paylaşılmayacağını bilmediği için çekiniyor ve formu yarıda bırakabiliyor. KVKK açısından veri toplanan noktada bilgilendirme beklentisi karşılanmıyor.

**Önerilen aksiyon:** E-posta alanının altına bir hint ekleyin: 'E-postanız yalnız bu bildirimle ilgili iletişim için kullanılır' ve 'Gizlilik bildirimi' (/privacy) bağlantısı. Adın kimlerle paylaşılacağını bir cümleyle açıklayın.

## F1110 — İyi niyet beyanı onay kutusu 13x13 px

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                  |
| Durum               | Gözlemlendi                                                                          |
| Konum               | `src/components/compliance/NoticeForm.tsx:129`                                       |
| Kullanıcılar        | misafir                                                                              |
| Prensip             | accessibility · Hedef boyutu                                                         |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                |
| WCAG                | 2.5.8 Target Size (Minimum) (AA) — etiket eşdeğer hedef sağladığı için hafifletilmiş |
| Renk/tema           | Hayır                                                                                |
| Efor                | S                                                                                    |
| Kaynak denetçiler   | runtime:compliance                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                         |

**Kanıt:** Sweep 028/029 targetsLt24: 'input.mt-1 13x13' (masaüstü ve mobil). p1: kutuyu saran label 950x20 px olduğu için metne tıklayınca işaretleniyor; ancak mobilde 2 satırlık label'ın görsel hedefi küçük kutu.

**Etki:** Zorunlu yasal beyan kutusu mobilde ıskalanıyor, kullanıcı gönderimde 'kutuyu işaretleyin' balonuyla karşılaşıyor.

**Önerilen aksiyon:** Kutuyu h-5 w-5 (20px) ya da 24px yapın. Label'a py-2 vererek 44px yüksekliğinde bir satır elde edin.

## F1239 — İtirazın son tarihi yalnızca tarih olarak ve UTC'ye göre gösteriliyor

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Low                                 |
| Durum               | Aday                                |
| Konum               | `src/app/report/appeal/page.tsx:60` |
| Diğer konumlar      | `src/lib/i18n/format.ts:63`         |
| Kullanıcılar        | misafir, ev sahibi                  |
| Prensip             | learnability · predictability       |
| Sezgisel madde      | H13 — Feedforward                   |
| Renk/tema           | Hayır                               |
| Efor                | S                                   |
| Kaynak denetçiler   | area:compliance                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** appeal/page.tsx:56 ve :60 `f.date(ctx.windowEndsAt, "long")`. format.ts:63'te `date(value, style = "short", timeZone = "UTC")` olduğu için saat ve yerel saat dilimi kaybolıyor. Pencere, decidedAt + 180 gün olarak dakikası belli bir anda kapanıyor (dsa-appeal.ts:115-116).

**Etki:** Son gün itiraz etmeye çalışan TR kullanıcısı, gösterilen tarihin tamamını kullanabileceğini düşünür; oysa pencere o gün sabah saatlerinde (UTC+3 farkıyla) kapanmış olabilir.

**Önerilen aksiyon:** `f.dateTime(ctx.windowEndsAt, "Europe/Istanbul")` kullanın ve saat dilimini yazın ('10 Nisan 2027 01:30 (TSİ)'). Kalan gün sayısını ekleyin ('({n} gün kaldı)').

## F1240 — Sonuçlanmış itirazda yöneticinin gerekçesi gösterilmiyor; DSA md. 21 için yönlendirme bağlantısı yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/app/report/appeal/page.tsx:72`    |
| Diğer konumlar      | `src/lib/compliance/dsa-appeal.ts:112` |
| Kullanıcılar        | misafir, ev sahibi                     |
| Prensip             | learnability · observability / help    |
| Sezgisel madde      | H10 — Yardım/dokümantasyon             |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:compliance                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** appeal/page.tsx:72-77 yalnızca `t(`existing.${ctx.appeal.status}`, { reference })` gösteriyor. AppealContext.appeal yalnızca `{ id, status, createdAt }` taşıyor (dsa-appeal.ts:112). REJECTED metni (tr compliance.json:156) "DSA md. 21 kapsamında mahkeme dışı uyuşmazlık çözümüne başvurabilirsiniz." diyor ama bağlantı vermiyor.

**Etki:** Reddedilen bir itirazın gerekçesini görmek için kullanıcı e-postasını aramak zorunda kalır. Sonraki hukuki adımın nasıl atılacağı belirsiz kalır.

**Önerilen aksiyon:** Bağlama `response` ve `decidedAt` alanlarını ekleyip karar sonrası bir <dl> içinde gösterin ('Karar tarihi', 'Gerekçe'). md. 21 cümlesine onaylı uyuşmazlık çözüm kuruluşlarını açıklayan bir yardım sayfası bağlantısı ekleyin.

## F1241 — Açıklama notları bağlantılara programatik olarak bağlı değil; harici ve yeni sekme bağlantıları belirtilmiyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Low                                                         |
| Durum               | Aday                                                        |
| Konum               | `src/app/trust/page.tsx:71`                                 |
| Diğer konumlar      | `src/components/compliance/AccessibilityReviewQueue.tsx:94` |
| Kullanıcılar        | misafir, admin                                              |
| Prensip             | accessibility · Link Purpose (WCAG 2.4.4)                   |
| Sezgisel madde      | H13 — Feedforward                                           |
| WCAG                | 2.4.4                                                       |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:compliance                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** trust/page.tsx:71-73 `<a href={item.href} className={linkClass} rel="noopener noreferrer">` ve :84-86 `<p className="mt-1 text-sm text-gray-700">{note}</p>` arasında aria-describedby yok; GitHub'a giden harici bağlantılarda bir gösterge yok. AccessibilityReviewQueue.tsx:94-97 `target="_blank"` ama yeni sekmede açılacağı söylenmiyor.

**Etki:** Ekran okuyucu kullanıcısı Tab ile bağlantılarda gezerken 'depo erişimi gerekir' ya da 'yönetici yetkisi gerekir' notlarını duymaz. Siteden ayrılacağını ya da yeni sekme açılacağını önceden bilmez.

**Önerilen aksiyon:** Not <p>'sine `id={`trust-${item.key}-note`}`, bağlantıya `aria-describedby` verin. Harici bağlantılara sr-only ' (GitHub, harici site)' metni ve aria-hidden bir ikon ekleyin. target=_blank olan bağlantılara '(yeni sekmede açılır)' metni ekleyin.

## F1242 — Erişilebilirlik doğrulamasında geri alma yok, işlenen satır listeden kayboluyor, önizleme küçük ve tıklanamaz, gönderim tarihi gösterilmiyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Low                                                         |
| Durum               | Aday                                                        |
| Konum               | `src/components/compliance/AccessibilityReviewQueue.tsx:43` |
| Kullanıcılar        | admin                                                       |
| Prensip             | robustness · recoverability                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                           |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:compliance                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** AccessibilityReviewQueue.tsx:43-46 `setStatus({ message: verified ? t("admin.verifiedOk") : t("admin.unverifiedOk") }); rows.reload();` mesajında geri alma düğmesi yok. :72-76 `<img ... className="h-16 w-24 rounded object-cover" />` 96×64 boyutunda ve tıklanamaz; büyük görüntü yalnızca ayrı bağlantıda (:93-101). ReviewRow (:9-19) gönderim tarihini ya da ev sahibini içermiyor.

**Etki:** Yanlış 'Doğrula'ya basan yönetici, satırı geri almak için 'Doğrulanmış' sekmesine geçip aramak zorunda kalır. Kanıtı küçük önizlemeden değerlendirmek zor; en eski beyanı önceliklendirmek mümkün değil.

**Önerilen aksiyon:** Başarı mesajının yanına 'Geri al' düğmesi ekleyin; düğme `verify(row, !verified)` çağırsın. Önizlemeyi bir `<button aria-label="Kanıtı büyüt">` içine alın ve büyük görüntüyü bir <dialog> içinde gösterin. Satıra 'Gönderildi: {f.date(createdAt)}' bilgisini ekleyin.

## F1243 — Yönetici kuyruklarında filtre ve geri bildirim desenleri değişiyor (select, düğme sekmesi, filtresiz; Status üstte veya altta)

| Alan                | Değer                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                                               |
| Durum               | Aday                                                                                                                                                                                                                                              |
| Konum               | `src/components/compliance/AccessibilityReviewQueue.tsx:64`                                                                                                                                                                                       |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:36-50`, `src/components/admin/SupportAdmin.tsx:63-77`, `src/components/admin/SupportAdmin.tsx:125`, `src/components/compliance/ComplianceDashboard.tsx:25-26`, `src/components/admin/AdminDashboard.tsx:147` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                             |
| Prensip             | learnability · consistency / generalizability                                                                                                                                                                                                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                             |
| Efor                | M                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                      |

**Kanıt:** AccessibilityReviewQueue.tsx:64-74 durum filtresi `aria-pressed` toggle Button grubu. ClaimAdmin.tsx:36-50 Field ve select. SupportAdmin.tsx:63-77 Field olmadan ham label ve select. AppealQueue ile Fraud kuyruğunda filtre yok. Status konumu: AdminDashboard kartlarında üstte (:147, :330), SupportAdmin.tsx:125, PayoutAdmin ve SupportChat'te kartın en altında, HostDashboard.tsx:304'te düğmenin yanında. ComplianceDashboard.tsx:25-26 inputClass yerine kendi `input` sınıfını tanımlıyor.

**Etki:** Yönetici her kuyrukta filtreyi ve işlem sonucunu farklı yerde arar. Uzun listelerde alttaki onay mesajı görünmez kalır ve işlemin yapılıp yapılmadığı belirsizleşir.

**Önerilen aksiyon:** `QueueCard` adlı ortak bir kalıp tanımlayın: üstte Field+select filtre, hemen altında Status (aria-live), sonra liste. Satır içi eylem sonucunu satırın yanında da kısa bir rozetle gösterin. ComplianceDashboard'daki yerel input sınıfını inputClass ile değiştirin.

## F1244 — İtiraz kuyruğunda itiraz edilen karar emir kipiyle ('Kaldır') gösteriliyor; tarih etiketsiz; TR 'İşlem yapma' iki anlama gelebiliyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/compliance/AppealQueue.tsx:81` |
| Diğer konumlar      | `messages/tr/compliance.json:57`               |
| Kullanıcılar        | admin                                          |
| Prensip             | learnability · consistency / familiarity       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:compliance                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** AppealQueue.tsx:80-82 `{t(`roles.${row.appellantRole}`)} · {row.notice?.decision ? ta(`decisions.${row.notice.decision}`) : "-"} · {f.date(row.createdAt, "medium")}` çıktısı "Bildiren · Kaldır · 11 Eki 2026". admin.decisions (tr compliance.json:57-60) seçenek etiketleri için yazılmış: "Kaldır", "İşlem yapma". Uygun geçmiş zaman metni appeal.decisions'ta mevcut (:147 "İçerik yayından kaldırıldı"). Tarihin itiraz tarihi mi karar tarihi mi olduğu belirtilmiyor; karar yoksa ekran okuyucu "-" okuyor.

**Etki:** Yönetici 'Kaldır' sözcüğünü önerilen bir eylem ya da düğme sanabilir. 'İşlem yapma' hem 'işlem yapılması' (ad) hem 'işlem yapmayın' (emir) olarak okunabiliyor. Tarih bağlamı belirsiz.

**Önerilen aksiyon:** AppealQueue'da `useTranslations("compliance.appeal")` ile `decisions.*` (geçmiş zaman) kullanın. Tarihi etiketleyin: 'İtiraz tarihi: {tarih}'. "-" yerine 'Karar bilgisi yok' yazın. Select seçeneklerini 'Kaldır (ilan yayından kalkar)' ve 'İşlem yapılmasın' olarak yeniden adlandırın.

## F1245 — Uzun metin alanlarında karakter sayacı yok; istemci sınırları sunucu şemasıyla uyuşmuyor; hukuki gerekçe alanları 2 satır

| Alan                | Değer                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                            |
| Durum               | Aday                                                                                                                                           |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:186`                                                                                        |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx:145`, `src/components/compliance/NoticeForm.tsx:104`, `src/components/compliance/AppealForm.tsx:74` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                      |
| Prensip             | robustness · error prevention                                                                                                                  |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                          |
| Efor                | S                                                                                                                                              |
| Kaynak denetçiler   | area:compliance                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                   |

**Kanıt:** ComplianceDashboard.tsx:186-193 facts: `minLength={10} rows={2}`, maxLength yok (sunucuda max 5000, dsa.ts:124). :196 legalReference'ta maxLength yok (sunucuda 300, dsa.ts:126). :125 reason tek satırlı `<input minLength={3}>` (sunucuda max 2000, takedown.ts:44). AppealQueue.tsx:145 `rows={2}`. NoticeForm.tsx:104 ve AppealForm.tsx:74 `maxLength={5000}` sayaç olmadan; yapıştırılan metin sessizce kırpılıyor.

**Etki:** Yönetici 300 karakterden uzun bir hukuki referans girerse genel bir 'Doğrulama hatası' alır. İki satırlık alanda uzun gerekçeyi gözden geçirmek zorlaşır. Misafir 5000 karakteri aşan metni yapıştırdığında sonunun kesildiğini fark etmez.

**Önerilen aksiyon:** Tüm alanlara şemayla aynı maxLength değerini verin (facts/response 5000, legalReference 300, reason 2000, referenceNo 120). Hint olarak '{n}/5000' sayacı ekleyin (aria-describedby; aria-live yalnızca %90 eşiğinde). facts ve response için rows={4} kullanın, takedown reason'ı textarea yapın. Min uzunluk ipucu verin: '(en az 10 karakter)'.

## F1246 — Bağlantılarda ve summary öğelerinde ortak odak halkası (focusRing) tutarsız kullanılıyor

| Alan                | Değer                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                       |
| Durum               | Aday                                                                                                                      |
| Konum               | `src/components/compliance/ComplianceDashboard.tsx:209`                                                                   |
| Diğer konumlar      | `src/app/trust/page.tsx:13`, `src/app/report/appeal/page.tsx:64`, `src/components/compliance/ComplianceDashboard.tsx:157` |
| Kullanıcılar        | misafir, admin                                                                                                            |
| Prensip             | learnability · consistency                                                                                                |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                               |
| WCAG                | 2.4.7                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                     |
| Efor                | S                                                                                                                         |
| Kaynak denetçiler   | area:compliance                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                              |

**Kanıt:** ComplianceDashboard.tsx:157, :209 ve :213 bağlantılarında focusRing yok; AppealQueue.tsx:87'de var. trust/page.tsx:13 `linkClass = "font-semibold text-brand underline underline-offset-2 hover:no-underline"` focus stili tanımlamıyor. appeal/page.tsx:64 `<summary className="cursor-pointer text-sm font-medium text-gray-900">` focusRing kullanmıyor; AppealQueue.tsx:97'deki summary kullanıyor.

**Etki:** Klavye kullanıcısı aynı alanda bazı öğelerde kalın mavi halka, bazılarında tarayıcının ince varsayılan çerçevesini görür; odak takibi tutarsızlaşır.

**Önerilen aksiyon:** Bu bağlantıların ve summary'nin className'ine ui.tsx'teki mevcut `${focusRing}` değerini ekleyin (yeni renk tanımlanmıyor).

## F1247 — Bileşen içindeki yerel input sınıfı ortak inputClass'tan farklı (köşe yuvarlaklığı, odak halkası)

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Low                                                    |
| Durum               | Aday                                                   |
| Konum               | `src/components/compliance/NoticeForm.tsx:17`          |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:24` |
| Kullanıcılar        | misafir, admin                                         |
| Prensip             | learnability · consistency                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                            |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:compliance                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** NoticeForm.tsx:17 `rounded-lg ... focus:outline-none focus:ring-1 focus:ring-[#003580]` ve ComplianceDashboard.tsx:24 `rounded-md ... focus:ring-1`. Ortak ui.tsx:21 `inputClass` = `rounded-md ... ${focusRing}` (focus-visible:ring-2 ring-offset-2). AppealForm.tsx:76 ve AppealQueue.tsx:129 ise ortak inputClass'ı kullanıyor.

**Etki:** Aynı alandaki (bildirim ile itiraz) formlar farklı köşe ve odak görünümüne sahip. Klavye kullanıcısı odak göstergesinin kalınlığını sayfadan sayfaya farklı görür.

**Önerilen aksiyon:** NoticeForm ve ComplianceDashboard'daki yerel `input` sabitini silip `import { inputClass } from "@/components/ui/ui"` kullanın.

## F1248 — Kamu formlarında istek zaman aşımı ya da iptal yolu yok; yavaş ağda form 'Gönderiliyor…' durumunda kalabiliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/compliance/NoticeForm.tsx:37` |
| Diğer konumlar      | `src/components/compliance/AppealForm.tsx:34` |
| Kullanıcılar        | misafir, ev sahibi                            |
| Prensip             | robustness · responsiveness                   |
| Sezgisel madde      | H15 — Performans                              |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:compliance                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** NoticeForm.tsx:37-50 `await fetch("/api/notices", {...}).catch(() => null)` AbortController ya da timeout kullanmıyor; :132 `disabled={state === "sending"}`. AppealForm.tsx:34-38'de de aynı durum var.

**Etki:** Mobil ağı takılan misafirin düğmesi süresiz devre dışı kalır. İptal edip yeniden deneyemez; sayfayı yenilerse yazdığı açıklama kaybolur.

**Önerilen aksiyon:** `AbortSignal.timeout(20000)` kullanın. Zaman aşımında state'i 'idle' yapın ve 'Bağlantı zaman aşımına uğradı; metniniz korunuyor, tekrar gönderebilirsiniz' mesajını gösterin.

## F1249 — DSA bildirim formu 400 yanıtında hangi alanın hatalı olduğunu söylemiyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/compliance/NoticeForm.tsx:57` |
| Diğer konumlar      | `src/lib/compliance/dsa.ts:42-49`             |
| Kullanıcılar        | misafir, tümü                                 |
| Prensip             | robustness · recoverability                   |
| Sezgisel madde      | H9 — Hata mesajları                           |
| WCAG                | 3.3.1                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | lens:forms                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** src/components/compliance/NoticeForm.tsx:56-59 `res?.status === 400 ? t("invalid")` → 'Lütfen tüm zorunlu alanları doğru doldurun.'; sunucu şeması src/lib/compliance/dsa.ts:44-48 (URL ≤2000, açıklama 20–5000, e-posta) `details.fieldErrors` döndürüyor ama okunmuyor.

**Etki:** Bildirim yapan kişi hangi alanı düzelteceğini bilemez; özellikle 'URL' alanında sitede olmayan bir adres girildiğinde.

**Önerilen aksiyon:** `details.fieldErrors`'ı Field `error`'larına dağıt ve ilk hatalı alana odaklan; genel mesajı yalnız alan eşleşmesi yoksa göster.

## F1250 — Başarı ekranında sonraki adım yok, e-posta adresi tekrar gösterilmiyor, başvuru numarası kopyalanamıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/compliance/NoticeForm.tsx:62` |
| Diğer konumlar      | `src/components/compliance/AppealForm.tsx:57` |
| Kullanıcılar        | misafir, ev sahibi                            |
| Prensip             | learnability · feedforward                    |
| Sezgisel madde      | H13 — Feedforward                             |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:compliance                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** NoticeForm.tsx:62-68 yalnızca `<Status message={t("sent", { reference: reference ?? "" })} />` gösteriyor ("Bildiriminiz alındı. Başvuru numaranız: {reference}. Onay e-postası gönderildi."). Bağlantı ya da düğme yok. AppealForm.tsx:57-63'te de aynısı var.

**Etki:** Misafir uzun bir cuid'i elle not etmek zorunda kalır. E-postayı yanlış yazdıysa bunu fark edemez. Sayfada geri dönülecek bir yer önerilmiyor.

**Önerilen aksiyon:** Mesaja '{email} adresine onay gönderildi' satırını ekleyin. 'Başvuru numarasını kopyala' düğmesi ekleyin (navigator.clipboard, sonuç role=status ile duyurulsun). propertyId varsa 'İlana dön', yoksa 'Ana sayfaya dön' bağlantısı koyun.

## F1251 — Bildirim formunda oturumu açık kullanıcının adı ve e-postası önceden doldurulmuyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/compliance/NoticeForm.tsx:118` |
| Diğer konumlar      | `src/components/ui/ui.tsx:183`                 |
| Kullanıcılar        | misafir, ev sahibi                             |
| Prensip             | flexibility · substitutivity / efficiency      |
| Sezgisel madde      | H7 — Esneklik/verim                            |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:compliance                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** NoticeForm.tsx:109-126'da reporterName ve reporterEmail alanlarında defaultValue yok. ui.tsx:183 `useSession()` hazır ve SessionUser email, firstName ve lastName içeriyor (api-client.ts:73-79).

**Etki:** Mobil ağırlıklı misafir, giriş yapmış olsa bile e-postasını yeniden yazmak zorunda kalır; yazım hatası yaparsa karar e-postasını alamaz.

**Önerilen aksiyon:** `const session = useSession();` ile alanlara `defaultValue={session.status === "ready" ? session.user?.email : undefined}` (ad için `${firstName} ${lastName}`) verin. Alanların düzenlenebilir kalmasına dikkat edin. Değerin hydration sonrası gelmesi nedeniyle `key` ile yeniden mount gerekebilir.
