# Yönetici paneli — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 75 bulgu · Severity: Critical 2, High 16, Medium 44, Low 13

## F21 — Geri alınamaz kuyruk kararları (yorum kaldırma, dolandırıcılık kararı, olay reddi/geri alma) onaysız ve geri alma yolu yok

| Alan                | Değer                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                    |
| Durum               | Aday                                                                                                                                        |
| Konum               | `src/components/admin/AdminDashboard.tsx:429`                                                                                               |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:360`, `src/components/admin/AdminDashboard.tsx:268`, `src/components/admin/AdminDashboard.tsx:274` |
| Kullanıcılar        | admin                                                                                                                                       |
| Prensip             | robustness · recoverability                                                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                       |
| Efor                | M                                                                                                                                           |
| Kaynak denetçiler   | area:admin                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                        |

**Kanıt:** AdminDashboard.tsx:429 `<Button variant="danger" onClick={() => decide(r.id, "remove")}>` tek tıkla yorumu REMOVED yapıyor ve puanı yeniden hesaplıyor (lib/reviews/moderation-queue.ts:98-102). Kuyruk yalnızca PENDING_REVIEW/HIDDEN listelediği için (moderation-queue.ts:53) arayüzde geri yükleme yolu yok. Fraud tarafında AdminDashboard.tsx:360 `resolve(f.id, "fraud")` kaydı confirmed_fraud yapıyor; GET yalnız review/deny/block döndürdüğü için (api/admin/fraud/route.ts) kayıt kuyruktan düşüyor. Olaylarda AdminDashboard.tsx:268 'Reddet' ve 274 'Geri al' çağrılıyor; REJECTED veya ROLLED_BACK olaylar için hiçbir düğme render edilmiyor (265-277).

**Etki:** Yan yana duran 'Yayınla/Kaldır' ve 'Meşru/Dolandırıcılık' düğmelerinde tek bir yanlış tık, misafir yorumunu kalıcı olarak siliyor ve tesis puanını değiştiriyor ya da kullanıcıyı dolandırıcı olarak işaretliyor. Yönetici bu hatayı arayüzden düzeltemiyor.

**Önerilen aksiyon:** Kaldır, Dolandırıcılık, Reddet ve Geri al için ertelenmiş işlem uygulayın: satır '‘{propertyTitle}’ yorumu kaldırılacak, Geri al (10 sn)' durumuna geçsin ve API çağrısı süre dolunca yapılsın. Alternatif olarak öğe adını ve sonucunu yazan bir <dialog> onayı kullanın, varsayılan odak 'Vazgeç' olsun. Ayrıca kartlara 'Son kararlar' listesi ve 'Kararı geri al' eylemi ekleyin; API'de REMOVED→PENDING_REVIEW ve confirmed_fraud→review geçişleri gerekir.

**Yapılan düzeltme:** AdminDashboard.tsx: 'Kaldır' (yorum), 'Dolandırıcılık olarak işaretle', 'Reddet' ve 'Onayı geri al' artık önce useConfirm onay diyaloğunu açıyor. Diyalog öğeyi adlandırıyor (mülk adı, rezervasyon no, olay başlığı) ve tone=danger olduğu için ilk odak Vazgeç'te. 'Son kararlar' listesi ve 'kararı geri al' eklenmedi: bunlar için REMOVED→PENDING_REVIEW ve confirmed_fraud→review API geçişleri gerekiyor (needs backend/API change). — dosyalar: `src/components/admin/AdminDashboard.tsx`

## F22 — Talep kararında 'Tam onay' önceden seçili, para hareketi onay adımı olmadan geri alınamaz biçimde yürütülüyor

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                             |
| Durum               | Aday                                                                                 |
| Konum               | `src/components/admin/ClaimAdmin.tsx:118`                                            |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:139`, `src/components/admin/ClaimAdmin.tsx:231` |
| Kullanıcılar        | admin                                                                                |
| Prensip             | robustness · recoverability / hata önleme                                            |
| Sezgisel madde      | H5 — Hata önleme                                                                     |
| WCAG                | 3.3.4                                                                                |
| Renk/tema           | Hayır                                                                                |
| Efor                | M                                                                                    |
| Kaynak denetçiler   | area:admin                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                        |

**Kanıt:** ClaimAdmin.tsx:118 `const [decision, setDecision] = useState<Decision>("APPROVE");`: en ağır sonuçlu seçenek varsayılan olarak seçili geliyor. ClaimAdmin.tsx:139-163 `submit` doğrudan `POST /api/admin/claims/{id}/decision` çağırıyor, arada onay ya da özet adımı yok. Karar sonrası ClaimAdmin.tsx:131-136 'Bu talep sonuçlandı; yeni karar verilemez.' gösteriliyor, yani karar geri alınamıyor. resolution.json `decision.explainRefund` metnine göre onay, PSP üzerinden misafire iade yapıyor ya da depozitodan tahsilat başlatıyor.

**Etki:** Yönetici notu yazıp radyo grubuna dokunmadan 'Kararı kaydet'e basarsa (ya da kısmi tutar alanında Enter'a basarsa) talep edilen tutarın tamamı iade ediliyor veya tahsil ediliyor. Bu hem para kaybı hem geri alınamaz bir sonuç.

**Önerilen aksiyon:** useState<Decision | null>(null) ile varsayılan seçimi kaldırın. Karar seçilmeden submit'i disabled yapın ve radyo grubuna `required` ekleyin. Gönderimden önce satır içi bir onay paneli ya da <dialog> gösterin: 'Misafire {amount} iade edilecek (emanetten/ev sahibi bakiyesinden). Bu işlem geri alınamaz.' Panelde 'Vazgeç' (varsayılan odak) ve 'Onaylıyorum' olsun. Onay düğmesi metni seçilen kararı ve tutarı içersin.

**Yapılan düzeltme:** ClaimAdmin.tsx DecisionForm: varsayılan karar artık null ve radyolar required. Karar seçilmezse 'Önce bir karar seçin' hatası çıkıyor ve odak ilk radyoya gidiyor. Gönderimden önce onay diyaloğu açılıyor: kararın başlığı, tutar ve kaynağı (iade: emanet/ev sahibi bakiyesi, hasar: depozito), 'Bu karar geri alınamaz' uyarısı. Onay düğmesinde tutar yazıyor ('{amount} için kararı onayla'); Reddet seçilince 'Talebi reddet' yazıyor ve tone=danger. Düğme disabled yerine busy kullanıyor. — dosyalar: `src/components/admin/ClaimAdmin.tsx`

## F62 — Talep kararı (para iadesi) özet ya da onay adımı olmadan kaydediliyor; 'Onayla (talep edilen tutarın tamamı)' varsayılan olarak seçili

| Alan                | Değer                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                  |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                                       |
| Konum               | `src/components/admin/ClaimAdmin.tsx:118`                                                                                             |
| Diğer konumlar      | `messages/tr/resolution.json`                                                                                                         |
| Kullanıcılar        | admin                                                                                                                                 |
| Prensip             | robustness · Kurtarılabilirlik ve görev uygunluğu. Para hareketi yaratan geri dönüşsüz kararda en riskli seçenek varsayılan olmamalı. |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                 |
| Efor                | M                                                                                                                                     |
| Kaynak denetçiler   | runtime:admin, lens:forms                                                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                                                                         |

**Kanıt:** RUNTIME probes/admin/p3-claims.mjs (stub'lı /admin/claims, masaüstü): ilk talep seçildiğinde karar formunda 'Onayla (talep edilen tutarın tamamı)' işaretli geliyor (crops/admin/p3c-1.png). Kısmi onay 1000 + not 'Not' girilip 'Kararı kaydet' tıklanınca POST /api/admin/claims/cl1/decision {decision:'PARTIAL',amountMinor:100000} hemen gidiyor; dialogs=[]. Tek hız kesici, 3 karakterlik zorunlu not alanı. Kod: useState<Decision>('APPROVE') (118), submit() (139-173) doğrudan apiFetch çağırıyor.

**Etki:** Onay misafire geri dönüşsüz iade yaptırıyor (ev sahibi bakiyesi ya da platform karşılıyor). Sonuçlanan talepte 'yeni karar verilemez' (decision.closed). Yanlış radyo düğmesi ya da aceleyle verilen karar para kaybına yol açar.

**Önerilen aksiyon:** Varsayılan karar seçmeyin (radyo grubu boş gelsin, seçim zorunlu olsun). Gönderimden önce özet ve onay adımı gösterin: '₺2.500,00 misafire iade edilecek; kaynak: emanet/ev sahibi bakiyesi. Bu karar geri alınamaz.' Son düğmede tutar yazsın ('₺1.000,00 kısmi iadeyi onayla'). Not için asgari uzunluğu artırın (ör. 20).

**Yapılan düzeltme:** F22 ile aynı düzeltme: varsayılan seçim yok, özet ve onay adımı var, onay düğmesinde tutar yazıyor. Kısmi tutar parseAmountToMinor ile, para biriminin kuruş basamağı Intl'den alınarak çözülüyor. '1.250,50' biçimini reddeden kısıtlayıcı pattern kaldırıldı, yardım metnine örnek biçim eklendi. Hatalı tutarda aria-invalid veriliyor ve odak alana taşınıyor. Notun asgari uzunluğu (3) API sözleşmesi olduğu için değiştirilmedi. — dosyalar: `src/components/admin/ClaimAdmin.tsx`

## F63 — Posta kutusunda doğrulama/sıfırlama bağlantıları tıklanamıyor ve 390px'te kartın ve ekranın dışına taşıyor

| Alan                | Değer                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                         |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                              |
| Konum               | `src/components/dev/MailboxClient.tsx:56`                                                                    |
| Kullanıcılar        | misafir, ev sahibi, tümü                                                                                     |
| Prensip             | accessibility · Yeniden akış (reflow) ve esneklik: kullanıcıdan uzun bir token'ı elle kopyalaması bekleniyor |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                        |
| WCAG                | 1.4.10 Yeniden Akış (AA)                                                                                     |
| Renk/tema           | Hayır                                                                                                        |
| Efor                | S                                                                                                            |
| Kaynak denetçiler   | runtime:admin, lens:nav                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                                                |

**Kanıt:** RUNTIME p6-mailbox.mjs (stub'lı /api/dev/mailbox). İçerik auth-notifications.ts biçiminde: 'http://localhost:3000/verify-email?token=' + account.ts newRawToken ile aynı uzunlukta (43 karakter) sahte token. Masaüstü ve mobilde linksInMail=0. Mobil 390px'te <pre> genişliği 324, scrollWidth 389 (65px taşma); overflow-wrap:normal, word-break:normal. Ekran görüntüsü crops/admin/p6-mailbox-mobile.png: token kart kenarını ve viewport'u aşıyor.

**Etki:** DEMO modunda e-posta doğrulama ve parola sıfırlama bağlantılarına ulaşmanın tek yolu bu sayfa. Mobilde bağlantı tıklanamıyor ve kısmen görünmüyor, seçip kopyalamak çok zor. Doğrulanmamış e-posta talep açmayı da engelliyor (EMAIL_NOT_VERIFIED).

**Önerilen aksiyon:** Metindeki URL'leri regex ile <a href> öğesine çevirin ve break-all verin. pre'ye [overflow-wrap:anywhere] ekleyin. Her e-postaya 'Bağlantıyı aç' birincil düğmesi ve 'Kopyala' düğmesi koyun.

**Yapılan düzeltme:** MailboxClient.tsx: metindeki http(s) URL'leri linkify() ile tıklanabilir <a> bağlantısına çevriliyor (underline, break-all, focusRing). pre'ye break-words ve [overflow-wrap:anywhere], meta satırına break-all, li'ye min-w-0 eklendi. Ayrı 'Kopyala' düğmesi eklenmedi; bağlantı artık doğrudan açılabiliyor. — dosyalar: `src/components/dev/MailboxClient.tsx`

## F78 — Satır eylemi sonrası klavye odağı kayboluyor (body'ye düşüyor)

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | High                                                                            |
| Durum               | Gözlemlendi                                                                     |
| Konum               | `src/components/admin/AdminDashboard.tsx:217`                                   |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx`, `src/components/admin/PayoutAdmin.tsx` |
| Kullanıcılar        | admin                                                                           |
| Prensip             | accessibility · Gözlemlenebilirlik ve odak yönetimi                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                           |
| WCAG                | 2.4.3 Odak Sırası (A)                                                           |
| Renk/tema           | Hayır                                                                           |
| Efor                | S                                                                               |
| Kaynak denetçiler   | runtime:admin                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                   |

**Kanıt:** RUNTIME p2b-focus-mobile.mjs A (stub; rollback sonrası durum ROLLED_BACK'e çevrildi): önce odak 'button Geri al' üzerindeydi; Enter sonrası focus='body', satır metni 'Etkinlik 5 · … · Geri alındı'. p4: destek 'Çözüldü olarak işaretle' sonrası focusAfter='body'. Nedeni: busy sırasında disabled olan ya da yeniden yüklemeyle DOM'dan kalkan düğme. Sayfa masaüstünde 3279px uzunlukta (sweep 104 tam sayfa).

**Etki:** Klavye ve ekran okuyucu kullanıcısı her eylemden sonra 3279px'lik sayfanın başına dönüyor. Ardışık kuyruk işleme pratikte imkânsızlaşıyor.

**Önerilen aksiyon:** Eylem bitince odağı aynı satırın başlığına/durum metnine (tabIndex=-1) ya da sonraki satırın eylem düğmesine taşıyın. Busy sırasında disabled yerine aria-disabled kullanın ki odak düğmede kalsın. Satır anahtarı sabit kaldığı için ref ile odak yönetimi kolay.

**Yapılan düzeltme:** AdminDashboard.tsx'e named export useRowFocusRecovery(data, cardId) eklendi. Eylem başarılı olunca satırın sırası işaretleniyor; yeniden yüklemede odaklı düğme DOM'dan kalktıysa odak aynı sıradaki (yoksa son) data-row satırının ilk denetimine, liste boşaldıysa kart başlığına (tabindex=-1) gidiyor. Outbox, olay, fraud ve moderasyon kartlarında ve SupportAdmin'de kullanılıyor. Satır düğmeleri disabled yerine Button busy (aria-disabled/aria-busy) kullanıyor, böylece odak düğmede kalıyor ve çift gönderim engelleniyor. PayoutAdmin'de de busy kullanılıyor; satır anahtarı sabit olduğu için odak aynı düğmede kalıyor. — dosyalar: `src/components/admin/AdminDashboard.tsx`, `src/components/admin/SupportAdmin.tsx`, `src/components/admin/PayoutAdmin.tsx`

## F79 — Riskli satır eylemleri onaysız çalışıyor: olay onayını geri alma, dolandırıcılık işareti, yorum kaldırma, ödeme durdurma, takedown kapatma, destek çözme

| Alan                | Değer                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                           |
| Durum               | Gözlemlendi                                                                                                                                                                                    |
| Konum               | `src/components/admin/AdminDashboard.tsx:273`                                                                                                                                                  |
| Diğer konumlar      | `src/components/admin/PayoutAdmin.tsx`, `src/components/admin/SupportAdmin.tsx`, `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx` |
| Kullanıcılar        | admin                                                                                                                                                                                          |
| Prensip             | robustness · Kurtarılabilirlik (Dix: recoverability). Geri dönüşü olmayan işlemlerden önce bir onay adımı olmalı.                                                                              |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                          |
| Efor                | M                                                                                                                                                                                              |
| Kaynak denetçiler   | runtime:admin                                                                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                                                                           |

**Kanıt:** RUNTIME probes/admin/p2-dashboard.mjs (masaüstü 1280, API yanıtları tarayıcıda stub'landı): 'Geri al' tıklanınca dialog=[] ve POST /api/admin/events/eva13/rollback hemen gidiyor. 'Onayla' tıklanınca POST .../ev1/approve, 'Dolandırıcılık' tıklanınca POST /api/admin/fraud {resolution:'fraud'}, yorum 'Kaldır' tıklanınca POST /api/admin/reviews {action:'remove'} anında gönderiliyor. p4: 'Ödemeleri durdur' gerekçe boşken POST /api/admin/payouts/usr_host_3 {paused:true} gönderiyor; 'Çözüldü olarak işaretle' PATCH gönderiyor. p5: takedown 'Kapat' ve erişilebilirlik 'Doğrula' de onaysız. Hiçbirinde dialog yok. Gerçek veride (sweep 104, crops/admin/104-admin-tr-desktop-_admin-1.png) 16 kırmızı 'Geri al' düğmesi alt alta duruyor. Kod: act() (217-226) ve PayoutAdmin toggle (276-293) apiFetch'i doğrudan çağırıyor.

**Etki:** Yanlış bir tık talep sinyalini fiyatlamadan çıkarıyor, bir misafiri dolandırıcı olarak işaretliyor, yorumu siliyor ya da ev sahibinin parasını durduruyor. Geri alma yolu yok. 'Geri al' etiketi zararsız bir 'undo' gibi okunduğu için hata olasılığı artıyor.

**Önerilen aksiyon:** Tehlikeli varyanttaki tüm eylemlere nesneyi adlandıran satır içi bir onay adımı ekleyin (ör. 'İstanbul Caz Festivali onayı geri alınsın mı? Fiyat sinyali kaldırılacak. [Vazgeç] [Onayı geri al]'). 'Geri al' etiketini 'Onayı geri al' yapın. Ödeme durdurma ve dolandırıcılık kararında gerekçeyi onay adımında zorunlu tutun. Geri alınabilir eylemler (destek çözme, doğrulama) için 5 sn'lik 'Geri al' toast'ı yeterli olur.

**Yapılan düzeltme:** Admin tarafı: olay 'Onayı geri al' (etiket de değişti) ve 'Reddet', 'Dolandırıcılık olarak işaretle', yorum 'Kaldır', ödeme durdurma ve ADMIN'e rol yükseltme nesneyi adlandıran onay diyaloğu açıyor. PayoutAdmin'de durdurma gerekçesi zorunlu: aria-invalid ve aria-describedby hata metniyle, onay diyaloğunda bekleyen ödeme sayısı ve gerekçe gösteriliyor. Destek 'Çözüldü' 'Yeniden aç' ile geri alınabildiği için onay eklenmedi. Geri al bildirimi (undo toast) gecikmeli API gerektirdiği için eklenmedi. ComplianceDashboard ve AccessibilityReviewQueue başka sahiplerde. — dosyalar: `src/components/admin/AdminDashboard.tsx`, `src/components/admin/PayoutAdmin.tsx`

## F80 — Mobilde A/B deney tablosunun kaydırma alanı klavyeyle erişilemiyor (scrollable-region-focusable)

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                       |
| Durum               | Gözlemlendi                                                                                |
| Konum               | `src/components/admin/AdminDashboard.tsx:450`                                              |
| Kullanıcılar        | admin                                                                                      |
| Prensip             | accessibility · Erişilebilirlik: içerik yalnızca fareyle ya da dokunmayla kaydırılabiliyor |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                      |
| WCAG                | 2.1.1 Klavye (A)                                                                           |
| Renk/tema           | Hayır                                                                                      |
| Efor                | S                                                                                          |
| Kaynak denetçiler   | runtime:admin                                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                              |

**Kanıt:** Sweep 105-admin-tr-mobile-_admin axe: scrollable-region-focusable (serious) '.overflow-x-auto'. RUNTIME p2b-focus-mobile.mjs (390x844): sarmalayıcıda clientWidth=316, scrollWidth=442, tabindex=null, role=null, aria-label=null; içeride odaklanabilir öğe 0, caption yok. Ekran görüntüsü crops/admin/105-admin-tr-mobile-_admin-3.png: 'Dönüşüm' sütunu kesik, 'Oran' ve '%95 Wilson' görünmüyor, kaydırma ipucu yok.

**Etki:** Klavye ve anahtar kontrolü kullanan yönetici dönüşüm oranı ile güven aralığı sütunlarına ulaşamıyor. Deney kararı için gereken veri gizli kalıyor.

**Önerilen aksiyon:** Sarmalayıcıya tabIndex={0}, role='region', aria-label={`${exp.flagKey} deney sonuçları`} ve focusRing ekleyin. Tabloya <caption> verin. sm altında tabloyu satır başına dl kartlarına dönüştürün ya da sağ kenara bir gölge/ok ile kaydırma ipucu koyun.

**Yapılan düzeltme:** AdminDashboard ExperimentsCard: kaydırma sarmalayıcısına tabIndex=0, role=region, aria-label ('{flag} deney sonuçları') ve focusRing eklendi. Tabloya sr-only <caption> verildi, başlık hücreleri th scope=col, kol adı hücresi th scope=row oldu. Mobil kart dönüşümü yapılmadı. — dosyalar: `src/components/admin/AdminDashboard.tsx`

## F81 — Admin kararı (Onayla/Kısmi/Reddet) onaysız ve özetsiz tek tıkla kesinleşiyor

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | High                                                                       |
| Durum               | Gözlemlendi                                                                |
| Konum               | `src/components/admin/ClaimAdmin.tsx:139`                                  |
| Kullanıcılar        | admin                                                                      |
| Prensip             | robustness · Geri alınamaz eylemde onay (Dix: robustness – recoverability) |
| Sezgisel madde      | H5 — Hata önleme                                                           |
| WCAG                | 3.3.4 Error Prevention (Legal, Financial, Data) – AA                       |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | runtime:resolution                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                              |

**Kanıt:** RUNTIME p6-admin (/admin/claims, sahte kuyruk, POST da sahte): "Reddet" seçilip "Kararı kaydet"e tıklanınca hiçbir dialog açılmadı ("REJECT -> confirm dialogs: [] posted: 1") ve istek hemen gönderildi. Onayla ve Kısmi'de de onay adımı yok. Karar sonrası UI "Bu talep sonuçlandı; yeni karar verilemez." diyor (resolution.json:162), yani işlem geri alınamaz. Karşılaştırma için: misafirin "Talebi geri çek" eylemi window.confirm ile korunuyor (p11-msg). Ekran görüntüsü: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/resolution/shots/admin-selected.png

**Etki:** Yanlış radyo seçimi ya da yanlış tutar (bkz. binlik ayırıcı bulgusu) yüzünden yanlış kişiye para iadesi veya haksız red kalıcı hale geliyor. Hem iki taraf hem platform zarar görüyor.

**Önerilen aksiyon:** Gönderimden önce bir onay adımı ekleyin: "Misafire ₺800,00 iade edilecek (emanetten ₺X, ev sahibi bakiyesinden ₺Y). Bu karar geri alınamaz. [Vazgeç] [Kararı onayla]". Reddet için ayrı bir uyarı metni olsun. Alternatif olarak birkaç saniyelik 'geri al' süresi verilebilir.

**Yapılan düzeltme:** F22 ile aynı onay ve özet diyaloğu; Reddet için ayrı uyarı metni (decision.confirm.reject) var. — dosyalar: `src/components/admin/ClaimAdmin.tsx`

## F82 — Destek devri döngüsü kapanmıyor: kuyrukta kullanıcı kimliği, iletişim, talep no ve yanıt alanı yok; 'Çözüldü' kullanıcıya bildirilmiyor

| Alan                | Değer                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                       |
| Durum               | Gözlemlendi                                                                                                                                |
| Konum               | `src/components/admin/SupportAdmin.tsx:86`                                                                                                 |
| Diğer konumlar      | `src/lib/support/repo.ts`, `src/components/support/SupportChat.tsx`, `messages/tr/support.json`                                            |
| Kullanıcılar        | admin, misafir                                                                                                                             |
| Prensip             | robustness · Görev uygunluğu (task completeness). Kullanıcıya verilen 'temsilci size dönecek' sözü sistem tarafından yerine getirilemiyor. |
| Sezgisel madde      | H12 — Feedback                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                      |
| Efor                | L                                                                                                                                          |
| Kaynak denetçiler   | runtime:admin                                                                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                       |

**Kanıt:** RUNTIME probes/admin/p4-support-payouts.mjs (stub'lı /admin/support): satırda yalnızca 'Para/iade talebi · Açık · tarih | refund_request · Güven: 0.42 · Rezervasyon: cmg1bk0001 | özet' görünüyor. linksInRows=0, textareas=0. Talep id'si gösterilmiyor; oysa SupportChat.tsx:112 kullanıcıya 'Konu insan destek ekibine devredildi (talep: {id})' diyor. API userId döndürüyor ama arayüz göstermiyor. 'Çözüldü olarak işaretle' tıklanınca yalnızca PATCH {status:'RESOLVED'} gidiyor; repo.ts:201-223 updateSupportTicketStatus bildirim göndermiyor. messages/tr/support.json humanPending: 'bir temsilci size dönecek'. Sweep 112: gerçek kuyruk boş ('Kuyrukta talep yok.').

**Etki:** Temsilci kullanıcıya ulaşamıyor, kullanıcının elindeki talep numarasıyla kaydı eşleştiremiyor ve talebi sessizce kapatıyor. Para/iade sorusuyla devredilen misafir yanıt alamıyor; güven kaybı ve tekrar başvuru oluşuyor.

**Önerilen aksiyon:** Satıra talep no, kullanıcı adı/e-posta (profil bağlantısı), rezervasyon bağlantısı ve AI konuşma dökümünü ekleyin. 'Yanıt yaz' alanı ekleyin; yanıt notifier ile e-posta ya da uygulama içi mesaj olarak gitsin. Çözerken çözüm notunu zorunlu tutup kullanıcıya iletin. Talep no ile arama ekleyin.

**Yapılan düzeltme:** SupportAdmin satırına talep no ('Talep no: {id}'), API döndürüyorsa kullanıcı kimliği ve break-words eklendi. Yanıt alanı, kullanıcıya bildirim, zorunlu çözüm notu ve talep no ile arama için API ve notifier gerekiyor (needs backend/API change). — dosyalar: `src/components/admin/SupportAdmin.tsx`

## F163 — Yıkıcı/geri alınamaz eylemlerde onay tutarsız (admin kararları, rol değişimi, promosyon/özellik silme, payout durdurma)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/admin/AdminDashboard.tsx:357`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:426`, `src/components/admin/AdminDashboard.tsx:492`, `src/components/host/PromotionsPanel.tsx:207`, `src/components/host/AccessibilityPanel.tsx:242`, `src/components/host/HostDashboard.tsx:669`, `src/components/admin/PayoutAdmin.tsx:84`, `src/components/account/AgentMandates.tsx:213`, `src/app/cart/page.tsx:183`, `src/components/admin/AdminDashboard.tsx:264`, `src/components/admin/ClaimAdmin.tsx:231`, `src/components/compliance/ComplianceDashboard.tsx:141`, `src/components/compliance/AppealQueue.tsx:151`, `src/components/compliance/AccessibilityReviewQueue.tsx:103` |
| Kullanıcılar        | admin, ev sahibi, misafir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| WCAG                | 3.3.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Kaynak denetçiler   | lens:a11y, lens:status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Kanıt:** AdminDashboard.tsx:357-362 'Meşru/Dolandırıcılık' ve 426-431 'Yayınla/Kaldır' tek tıkla karar; 274 'Geri al (rollback)'; 492-504 RoleCard kullanıcıyı ADMIN yapmayı onaysız uyguluyor; PromotionsPanel.tsx:207-214 promosyon silme; AccessibilityPanel.tsx:242-248 özellik silme; HostDashboard.tsx:666-672 fotoğraf silme; PayoutAdmin.tsx:84-90 payout durdurma; AgentMandates.tsx:213-221 yetki iptali; cart/page.tsx:183-191 kalem kaldırma — hiçbirinde onay ya da geri al yok. Buna karşın PasskeyManager.tsx:87, SessionManager.tsx:71, ClaimDetail.tsx:103 ve cart/page.tsx:45 `window.confirm` kullanıyor. Karar düğmelerinde busy/disabled da yok (çift tıklama çift istek).

**Etki:** Yönetici (hız + hatasızlık görevi): bağlamsız düğme adlarıyla (bkz. ilgili bulgu) yanlış satırda 'Kaldır'/'Dolandırıcılık' tıklayıp geri alamaz; yanlış kullanıcıya ADMIN rolü verebilir. Ev sahibi aktif promosyonu yanlışlıkla siler. Ekranlar arası tutarsızlık hangi eylemin güvenli olduğunu öğrenmeyi zorlaştırıyor.

**Önerilen aksiyon:** Ortak bir onay deseni belirleyin: geri alınamaz eylemlerde öğe adını içeren `<dialog>` onayı ('{propertyTitle} yorumunu kaldır?'), geri alınabilenlerde 5-10 sn 'Geri al' içeren role=status bildirimi; rol yükseltmede ADMIN için ayrıca yeniden doğrulama (useReauth); işlem sürerken satır düğmelerini aria-disabled yapın.

**Yapılan düzeltme:** Sahip olduğum dosyalarda ortak useConfirm deseni uygulandı: AdminDashboard (fraud, moderasyon, olaylar, rol), PayoutAdmin (durdurma), ClaimAdmin (karar). İşlem sürerken satır düğmeleri busy (aria-disabled). ADMIN'e yükseltmede useReauth eklenmedi; danger tonda onay var. Diğer dosyalar (PromotionsPanel, AccessibilityPanel, HostDashboard, AgentMandates, cart, ComplianceDashboard, AppealQueue, AccessibilityReviewQueue) başka sahiplerde (needs other owner). — dosyalar: `src/components/admin/AdminDashboard.tsx`, `src/components/admin/PayoutAdmin.tsx`, `src/components/admin/ClaimAdmin.tsx`

## F164 — Posta kutusunda uzun bağlantılar 360px'te taşıyor (yatay kaydırma)

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | High                                                                                 |
| Durum               | Aday (2 kaynak birleşti)                                                             |
| Konum               | `src/components/dev/MailboxClient.tsx:56`                                            |
| Diğer konumlar      | `src/components/dev/MailboxClient.tsx:53`, `src/components/dev/MailboxClient.tsx:50` |
| Kullanıcılar        | tümü                                                                                 |
| Prensip             | accessibility · WCAG 1.4.10 Yeniden Akış                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                |
| WCAG                | 1.4.10                                                                               |
| Renk/tema           | Hayır                                                                                |
| Efor                | S                                                                                    |
| Kaynak denetçiler   | area:misc, lens:mobile                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                        |

**Kanıt:** MailboxClient.tsx:56 `<pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-700">`. pre-wrap yalnızca boşluklarda kırıyor; break-words veya overflow-wrap tanımlı değil, li (51) taşmayı kesmiyor. Doğrulama ve sıfırlama e-postaları boşluksuz uzun bağlantılar içeriyor: auth-notifications.ts:43 `link: `${appBaseUrl()}${linkPath(p)}`` (?token=...).

**Etki:** Mobilde (360px) demo kullanıcısı doğrulama e-postasını okurken sayfa yatay kayıyor, satırları okumak için iki yönde kaydırması gerekiyor. 320 CSS px yeniden akış ölçütü ihlal ediliyor.

**Önerilen aksiyon:** pre'ye `break-words [overflow-wrap:anywhere]` sınıflarını ekleyin. 53'teki meta satırına (`m.to`) da `break-all` ekleyin. li'ye `min-w-0` verin.

**Yapılan düzeltme:** F63 ile aynı düzeltme: pre, meta satırı ve li'de taşma giderildi. — dosyalar: `src/components/dev/MailboxClient.tsx`

## F194 — Tüm yönetici sayfalarının <title> değeri aynı ve sayfayı tanımlamıyor

| Alan                | Değer                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                               |
| Durum               | Aday                                                                                                                               |
| Konum               | `src/app/admin/page.tsx:1`                                                                                                         |
| Diğer konumlar      | `src/app/admin/claims/page.tsx:1`, `src/app/admin/payouts/page.tsx:1`, `src/app/admin/support/page.tsx:1`, `src/app/layout.tsx:13` |
| Kullanıcılar        | admin                                                                                                                              |
| Prensip             | accessibility · WCAG 2.4.2 Page Titled                                                                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                              |
| WCAG                | 2.4.2                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                              |
| Efor                | S                                                                                                                                  |
| Kaynak denetçiler   | area:admin                                                                                                                         |
| **Düzeltme durumu** | **Zaten uygun** (paket: admin)                                                                                                     |

**Kanıt:** src/app/admin/page.tsx:1 `"use client";`: istemci sayfası metadata export edemiyor. Bu yüzden yalnızca src/app/layout.tsx:13-17 `title: t("meta.title")` geçerli oluyor ve tüm sayfalar 'booking-platform — konaklama arama ve rezervasyon (demo)' başlığını alıyor. Aynı durum claims/payouts/support page.tsx:1 için de geçerli. Karşılaştırma: src/app/ranking/page.tsx:7 `generateMetadata` ile sayfaya özel başlık veriyor.

**Etki:** Birden çok sekmede kuyruk açan yönetici sekmeleri ayırt edemiyor. Ekran okuyucu sayfa değişiminde hangi ekranda olunduğunu duyurmuyor ve tarayıcı geçmişi ile yer imleri anlamsız kalıyor.

**Önerilen aksiyon:** Her rota için page.tsx dosyasını sunucu bileşenine çevirin. `export async function generateMetadata() { const t = await getTranslations("resolution"); return { title: `${t("admin.pageTitle")} · ${tAdmin("page.title")}` }; }` tanımlayın ve istemci içeriğini (PageShell + RoleGate) ayrı bir istemci bileşenine taşıyın. /admin, /admin/claims, /admin/payouts ve /admin/support için ayrı başlık verin.

**Yapılan düzeltme:** Sayfa başlıkları dalga 1'de global olarak ele alındı: admin, claims, payouts ve support için layout.tsx dosyaları mevcut. Görev gereği sayfa başlığı ya da metadata eklenmedi; app/admin/*/page.tsx değiştirilmedi.

## F195 — Karar sonrası öğe listeden düşünce ya da düğme değişince klavye odağı <body>'ye kaçıyor

| Alan                | Değer                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                               |
| Durum               | Aday                                                                                                                                                                               |
| Konum               | `src/components/admin/AdminDashboard.tsx:322`                                                                                                                                      |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:397`, `src/components/admin/AdminDashboard.tsx:265`, `src/components/admin/SupportAdmin.tsx:52`, `src/components/admin/ClaimAdmin.tsx:78` |
| Kullanıcılar        | admin                                                                                                                                                                              |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order                                                                                                                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                              |
| WCAG                | 2.4.3                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                  |
| Kaynak denetçiler   | area:admin                                                                                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: admin)                                                                                                                                                      |

**Kanıt:** AdminDashboard.tsx:321-322 `setFeedback(...); reload();`: karara bağlanan fraud kaydı GET filtresinden çıkıyor ve odaktaki düğme DOM'dan kaldırılıyor. Moderasyonda 396-397 aynı şekilde çalışıyor. Olaylarda 265-277: onaydan sonra 'Onayla' düğmesi yerini 'Geri al'a bırakıyor ve odaklı öğe yok oluyor. SupportAdmin.tsx:51-52 'OPEN' filtresinde 'İncelemeye al' sonrası satır kayboluyor. ClaimAdmin.tsx:78 'Ayrıntıyı kapat' tıklanınca tüm bölüm unmount oluyor. Hiçbir yerde odak yönetimi (ref/focus) yok.

**Etki:** Kuyruğu yalnız klavye veya ekran okuyucuyla işleyen yönetici her karardan sonra sayfanın başına (Header) dönüyor ve sonraki öğeye ulaşmak için onlarca Tab basmak zorunda kalıyor. Bu, toplu kuyruk işlemeyi fiilen engelliyor.

**Önerilen aksiyon:** Başarılı eylemden sonra odağı programatik olarak taşıyın. Satır düğmeleri için bir ref haritası tutun (Map<id, HTMLButtonElement>). Öğe kalkarsa sonraki öğenin ilk eylem düğmesine, liste boşaldıysa `tabIndex={-1}` verilmiş kart başlığına (h2) odaklanın. Olay onayından sonra aynı satırdaki yeni 'Geri al' düğmesine odaklanın. 'Ayrıntıyı kapat' sonrası odağı ilgili talebin 'Ayrıntıyı göster' düğmesine geri verin.

**Yapılan düzeltme:** F78 ile aynı odak kurtarma; olay onaylanınca odak aynı satırdaki 'Onayı geri al' düğmesine gidiyor. ClaimAdmin: 'Ayrıntıyı kapat' sonrası odak, ayrıntıyı açan tetikleyiciye dönüyor (yoksa kart başlığına). Karar kaydedilip form 'sonuçlandı' görünümüne geçince başarı mesajı gösteriliyor ve odak tabIndex=-1 paragrafa taşınıyor. — dosyalar: `src/components/admin/AdminDashboard.tsx`, `src/components/admin/SupportAdmin.tsx`, `src/components/admin/ClaimAdmin.tsx`

## F196 — Yönetici kuyruk kararları (dolandırıcılık, yorum kaldırma, olay geri alma, talep kapatma) tek tık, onaysız ve geri alınamaz

| Alan                | Değer                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                                                                                                     |
| Konum               | `src/components/admin/AdminDashboard.tsx:360`                                                                                                                                                                                            |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:175,265-277,426-431`, `src/components/compliance/ComplianceDashboard.tsx:70-78,141`, `src/components/compliance/AccessibilityReviewQueue.tsx:103-109`, `src/app/api/admin/fraud/route.ts:24-41` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                    |
| Prensip             | robustness · recoverability                                                                                                                                                                                                              |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                                        |
| WCAG                | 3.3.4                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                                                        |
| Kaynak denetçiler   | lens:forms                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                                                                                                                     |

**Kanıt:** src/components/admin/AdminDashboard.tsx:357-362 `<Button variant="danger" onClick={() => resolve(f.id, "fraud")}>` — onay yok; src/app/api/admin/fraud/route.ts:31-37 karar `confirmed_fraud` yazılır ve kayıt kuyruktan düşer (GET yalnız review/deny/block), arayüzde geri alma yok. Aynı kalıp: :426-431 yorum 'Kaldır', :273-277 olay 'Geri al', :175 outbox 'Yeniden kuyruğa al'; src/components/compliance/ComplianceDashboard.tsx:141 takedown 'Kapat' (sabit gerekçeyle); src/components/compliance/AccessibilityReviewQueue.tsx:104 'Doğrulamayı kaldır'.

**Etki:** Hızlı kuyruk işleyen yönetici yanlış satırda 'Dolandırıcılık' / 'Kaldır'a basarsa karar kalıcı olur ve öğe listeden kaybolur; hatayı fark etse de arayüzden düzeltemez.

**Önerilen aksiyon:** Yıkıcı kararlar için ya satır içi iki adımlı onay ('Dolandırıcılık olarak işaretle?' → 'Onayla'/'Vazgeç') ya da 10 sn'lik 'Geri al' toast'ı (karar sunucuya gecikmeli gönderilir veya PATCH ile geri alınır). Fraud/moderasyon için 'Son kararlar' sekmesi ve kararı değiştirme eylemi ekle.

**Yapılan düzeltme:** Fraud, yorum kaldırma, olay reddi ve olay geri alma için onay diyaloğu eklendi. Outbox 'Yeniden kuyruğa al' yıkıcı olmadığı için yalnız busy aldı. 'Son kararlar' sekmesi ve kararı değiştirme için API gerekiyor (needs backend/API change). Compliance takedown başka sahipte. — dosyalar: `src/components/admin/AdminDashboard.tsx`

## F197 — EN arayüzde sunucu ve LLM kaynaklı Türkçe metinler lang işareti olmadan gösteriliyor

| Alan                | Değer                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                |
| Konum               | `src/components/admin/AdminDashboard.tsx:418`                                                                                                                                       |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:350`, `src/components/admin/AdminDashboard.tsx:502`, `src/components/admin/PayoutAdmin.tsx:47`, `src/components/admin/SupportAdmin.tsx:54` |
| Kullanıcılar        | admin                                                                                                                                                                               |
| Prensip             | accessibility · WCAG 3.1.2 Language of Parts                                                                                                                                        |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                               |
| WCAG                | 3.1.2                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                   |
| Kaynak denetçiler   | area:admin                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                                                                |

**Kanıt:** AdminDashboard.tsx:418 `{t("moderation.whyFlagged")} {r.explanation}`: açıklama, sabit Türkçe istemle üretiliyor (lib/reviews/moderation-queue.ts:39 'tek-iki cümle Türkçe açıkla'). AdminDashboard.tsx:350 `{r.detail && ` — ${r.detail}`}`: fraud kural ayrıntıları Türkçe sabit metin (lib/risk/fraud.ts:112 'Hesap için yeni cihaz'). Sunucu hata metinleri de Türkçe (ör. role/route.ts 'Kendi rolünüzü değiştiremezsiniz') ve errorMessage(e) ile basılıyor. Kökte `<html lang={locale}>` 'en' iken bu parçalarda lang="tr" yok.

**Etki:** EN kullanan yönetici Türkçe açıklama ve gerekçeleri anlayamıyor. Ekran okuyucu bu Türkçe metni İngilizce sesle okuyor ve içerik anlaşılmaz hale geliyor.

**Önerilen aksiyon:** Kısa vadede, locale !== 'tr' olduğunda sunucu ve LLM metinlerini `<span lang="tr">` ile sarın. Kalıcı çözüm: fraud kural kodlarını (velocity_user, new_device...) ve moderasyon gerekçe kodlarını messages/<locale>/admin.json içinde `fraud.rules.<code>` ve `moderation.reasons.<code>` anahtarlarıyla çevirin. LLM açıklamasını istemcinin locale'iyle üretin ya da kod tabanlı deterministik metne geçin.

**Yapılan düzeltme:** AdminDashboard'a TrText bileşeni eklendi: locale tr değilse metni <span lang="tr"> ile sarıyor. LLM moderasyon açıklaması, fraud kural ayrıntısı ve olay gerekçesi buna sarıldı. Kural/gerekçe kodlarının çevirisi ve sunucu hata metinlerinin yerelleştirilmesi sunucu tarafında kod tabanlı metin gerektiriyor (needs backend/API change). — dosyalar: `src/components/admin/AdminDashboard.tsx`

## F198 — Rol değiştirme serbest metin ID ile, hedef kullanıcı önizlemesi ve ADMIN yükseltmesi için onay olmadan yapılıyor

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                         |
| Durum               | Aday                                                                                         |
| Konum               | `src/components/admin/AdminDashboard.tsx:496`                                                |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:510`, `src/components/admin/AdminDashboard.tsx:489` |
| Kullanıcılar        | admin                                                                                        |
| Prensip             | robustness · hata önleme / recoverability                                                    |
| Sezgisel madde      | H5 — Hata önleme                                                                             |
| Renk/tema           | Hayır                                                                                        |
| Efor                | M                                                                                            |
| Kaynak denetçiler   | area:admin                                                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                         |

**Kanıt:** AdminDashboard.tsx:510-516 `<input id="role-user" ... value={userId} required />` serbest metin alanı ve kimlik doğrulaması ya da önizleme yok. 496-499 doğrudan `PATCH /api/admin/users/${encodeURIComponent(userId.trim())}/role` gönderiliyor. 489 varsayılan rol `"HOST"`. Hedefin adı, e-postası ve mevcut rolü gösterilmiyor. api/admin/users/[id]/role/route.ts tokenVersion'ı artırıyor, yani hedef kullanıcı tüm cihazlarda oturumdan atılıyor. Alanda autoCapitalize/spellCheck kapatılmadığı için mobilde cuid'nin ilk harfi büyütülebilir.

**Etki:** Yapıştırılan ya da yanlış yazılan bir ID başka bir kullanıcıya ADMIN yetkisi verebilir veya bir ev sahibini USER'a düşürüp tüm oturumlarını kapatabilir. Güvenlik açısından kritik bir eylem tek adımda ve geri bildirim görülmeden yapılıyor.

**Önerilen aksiyon:** İki adımlı akış kurun. Birinci adımda 'Kullanıcıyı bul' (e-posta ya da ID) aranır ve ad, maskeli e-posta ve mevcut rol gösterilir. İkinci adımda yeni rol seçilir. Yeni rol mevcut rolle aynıysa submit disabled olsun. ADMIN'e yükseltme veya düşürme için '{ad} kullanıcısını Yönetici yapacaksınız; tüm oturumları kapanacak' onay diyaloğu gösterin. Input'a `autoComplete="off" spellCheck={false} autoCapitalize="none"` ekleyin. Boşluktan oluşan girişte istemci tarafında hata verin.

**Yapılan düzeltme:** RoleCard: gönderimden önce onay diyaloğu açılıyor; kullanıcı kimliği ve yeni rol yazıyor, oturumların kapanacağı belirtiliyor. ADMIN için ayrı uyarı ve tone=danger var. Rol seçenekleri çevrildi ('Ev sahibi (HOST)' gibi) ve başarı mesajı çevrilmiş rolü gösteriyor. Alanda autoComplete=off, autoCapitalize=none ve spellCheck=false; düğme busy. Kullanıcıyı arama, ad/e-posta/mevcut rol önizlemesi ve aynı rolse düğmeyi kapatma için kullanıcı arama API'si gerekiyor (needs backend/API change). — dosyalar: `src/components/admin/AdminDashboard.tsx`

## F199 — Ham kimlikle rol değiştirme ve ilan kaldırma: hedef önizlemesi ve onay yok

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | High                                                        |
| Durum               | Aday                                                        |
| Konum               | `src/components/admin/AdminDashboard.tsx:509`               |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:110-130` |
| Kullanıcılar        | admin                                                       |
| Prensip             | robustness · observability, error prevention                |
| Sezgisel madde      | H5 — Hata önleme                                            |
| WCAG                | 3.3.4                                                       |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | lens:forms                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                        |

**Kanıt:** src/components/admin/AdminDashboard.tsx:509-516 'Kullanıcı kimliği' serbest metin, :492-503 doğrudan `PATCH /api/admin/users/${userId}/role`; hangi kişinin (ad/e-posta) etkileneceği gösterilmiyor, ADMIN yetkisi vermek için ek onay yok, seçenekler ham enum (:525-527 `USER/HOST/ADMIN`). src/components/compliance/ComplianceDashboard.tsx:118-119 'İlan kimliği' serbest metin + :128 düğme metni "Talebi kaydet ve ilanı kaldır" — ilan başlığı doğrulanmadan yayından kaldırılıyor.

**Etki:** Yönetici tek karakterlik yanlış kopyala-yapıştırla yanlış kullanıcıya ADMIN verir veya yanlış ilanı yayından kaldırır; hata ancak sonradan şikâyetle fark edilir.

**Önerilen aksiyon:** Kimlik alanına blur'da arama yap ve altında 'Bulunan: {ad soyad} ({e-posta}), mevcut rol: HOST' / '{ilan başlığı}, {şehir}' önizlemesi göster (aria-live); bulunamazsa Field `error`. Gönderimden önce özetli onay ('{ad} kullanıcısını ADMIN yap?'). Rol seçeneklerini çevir (`t("account.role.*")`).

**Yapılan düzeltme:** F198 ile aynı: ADMIN onayı ve çevrilmiş rol seçenekleri eklendi. Hedef önizlemesi API gerektiriyor. ComplianceDashboard ilan kimliği önizlemesi başka sahipte. — dosyalar: `src/components/admin/AdminDashboard.tsx`

## F200 — Yönetici para/yaptırım kararları özet ve onay olmadan veriliyor; düğmeler eylem fiili içermiyor

| Alan                | Değer                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                                                                |
| Konum               | `src/components/admin/ClaimAdmin.tsx:236`                                                                                                                                                                                                                                           |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:110-128`, `src/components/compliance/ComplianceDashboard.tsx:168`, `src/components/compliance/ComplianceDashboard.tsx:179`, `src/components/admin/AdminDashboard.tsx:358-361`, `src/components/admin/AdminDashboard.tsx:521-528` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                               |
| Prensip             | robustness · recoverability (hata önleme)                                                                                                                                                                                                                                           |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                                                                                                                   |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: admin)                                                                                                                                                                                                                                                |

**Kanıt:** ClaimAdmin.tsx:236 düğme 'Kararı kaydet' (resolution.json decision.submit) — onaylanacak/iade edilecek tutar ve kimden karşılanacağı düğmede/onayda tekrar edilmez. ComplianceDashboard.tsx:110-128 ilan, serbest metin 'İlan kimliği' ile kaldırılır (hangi ilan olduğu önizlenmez). 168 ve 179 DSA kararında 'İşlem yapma' ve 'Kullanım koşulları' önceden seçili. AdminDashboard.tsx:358-361 dolandırıcılık düğmeleri isim ('Meşru' / 'Dolandırıcılık'), onaysız; 521-528 rol değişimi (ADMIN dahil) onaysız ve seçenekler ham 'USER/HOST/ADMIN'.

**Etki:** Hızlı çalışan yönetici yanlış ID ile başka ilanı kaldırabilir, kısmi iade yerine tam onay verebilir veya varsayılan seçimle DSA kararı kaydedebilir; geri alma zor ve taraflara e-posta gider.

**Önerilen aksiyon:** Kalıcı kararlar için özet onayı ekleyin: 'Misafire ₺X iade edilecek (emanetten). Onaylıyor musunuz?'; takedown formunda ID girilince ilan başlığını göstermeden göndermeyi engelleyin; DSA kararında varsayılan seçimi kaldırıp zorunlu seçim yapın; düğmeleri 'Meşru olarak işaretle' / 'Dolandırıcılık olarak işaretle' yapın; rol seçeneklerini account.role çevirileriyle gösterip ADMIN atamasında onay isteyin.

**Yapılan düzeltme:** ClaimAdmin'de tutar ve kaynak özetli onay eklendi; onay düğmesinde fiil ve tutar var. Fraud düğmeleri 'Meşru olarak işaretle' / 'Dolandırıcılık olarak işaretle' oldu, rol seçenekleri çevrildi ve ADMIN onayı eklendi. ComplianceDashboard'daki takedown önizlemesi ve DSA varsayılan seçimi başka sahipte. — dosyalar: `src/components/admin/ClaimAdmin.tsx`, `src/components/admin/AdminDashboard.tsx`

## F440 — Talep seçilince ayrıntı ekranın altında açılıyor ve odak taşınmıyor; karar formu yazışma ve kanıtların üstünde duruyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                     |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                            |
| Konum               | `src/components/admin/ClaimAdmin.tsx:72`                                                   |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx`, `src/components/resolution/ClaimList.tsx:57`  |
| Kullanıcılar        | admin                                                                                      |
| Prensip             | robustness · Gözlemlenebilirlik ve görev akışı (karar dayanakları karardan önce görülmeli) |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                             |
| Renk/tema           | Hayır                                                                                      |
| Efor                | M                                                                                          |
| Kaynak denetçiler   | runtime:admin, area:admin                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                               |

**Kanıt:** RUNTIME p3-claims.mjs (stub, 3 talep): 'Ayrıntıyı göster' + Enter sonrası odak aynı düğmede kalıyor; 'Seçili talep' başlığı top=821 (viewport 800), yani yalnızca 3 talepte bile ekran dışında. crops/admin/p3c-1.png: 'Karar ver' kartı 'Yazışmalar' ve kanıtların ÜSTÜNDE (ClaimDetail.tsx:60 renderAdmin, 67 ClaimMessages, 75 ClaimEvidence).

**Etki:** Admin tıklamanın sonucunu göremiyor. Karar formu, dayanakları (yazışma/kanıt) incelemeden önce doldurulmaya davet ediyor; kanıtı görmeden karar riski doğuyor.

**Önerilen aksiyon:** Seçimde ayrıntı başlığına scrollIntoView yapıp odaklayın (tabIndex=-1). Masaüstünde liste+ayrıntı yan panel düzeni kullanın. Karar formunu yazışma ve kanıtlardan sonra render edin ya da formun üstüne 'Kanıtlar (n) · Yazışmalar (n)' çapa bağlantıları koyun.

## F460 — Yönetim gezinmesi zayıf: alt sayfalarda alt menü yok, bekleyen iş sayıları yok, aksiyon gerektiren kuyruklar sayfanın derinlerinde

| Alan                | Değer                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                              |
| Durum               | Gözlemlendi                                                                                                                                                                         |
| Konum               | `src/app/admin/page.tsx:17`                                                                                                                                                         |
| Diğer konumlar      | `src/app/admin/claims/page.tsx`, `src/app/admin/payouts/page.tsx`, `src/app/admin/support/page.tsx`, `src/app/admin/compliance/page.tsx`, `src/components/admin/AdminDashboard.tsx` |
| Kullanıcılar        | admin                                                                                                                                                                               |
| Prensip             | flexibility · Çoklu iş parçacığı ve gezinme verimliliği (Dix: multithreading, dialogue initiative)                                                                                  |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                   |
| Kaynak denetçiler   | runtime:admin                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                        |

**Kanıt:** Alt menü yalnızca /admin'de var ve <nav> değil <p> içinde (p2 subnav: inNav=false, aria-current yok). /admin/claims, /payouts, /support, /compliance ekran görüntülerinde kardeş sayfalara ya da /admin'e dönüş bağlantısı yok (crops/admin/106-…-0.png, 110-…-0.png, 112-…-0.png). /admin sayfası masaüstünde 3279px, mobilde 4866px. İlk kart bilgi amaçlı 'LLM durumu'; 'Fraud inceleme kuyruğu' 16 'Onaylı' olayın ardından ≈2118px'te başlıyor (crops/admin/104-admin-tr-desktop-_admin-2.png). Sayfa içi atlama bağlantısı yok.

**Etki:** Uzman admin kuyruklar arasında her seferinde /admin'e dönmek ve uzun sayfayı kaydırmak zorunda. Bekleyen dolandırıcılık ve moderasyon işleri gözden kaçabiliyor.

**Önerilen aksiyon:** src/app/admin/layout.tsx içinde paylaşılan bir <nav aria-label='Yönetim'> kurun: aria-current ve bekleyen sayı rozetleri olsun ('Destek kuyruğu (2)'). /admin'de aksiyon kuyruklarını (dolandırıcılık, moderasyon, önerilen olaylar) en üste alın, bilgi kartlarını (LLM, outbox) alta taşıyın, kartlara sayfa içi çapa listesi ekleyin.

## F461 — Ham kodlar, İngilizce terimler ve bağlantısız kimlikler (PENDING/DEAD, REVIEW, velocity, refund_request, 0.42, SCAM, dev/SENT)

| Alan                | Değer                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                            |
| Durum               | Gözlemlendi                                                                                                                                                                       |
| Konum               | `src/components/admin/AdminDashboard.tsx:151`                                                                                                                                     |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx`, `src/components/compliance/ComplianceDashboard.tsx`, `src/components/compliance/AppealQueue.tsx`, `src/components/dev/MailboxClient.tsx` |
| Kullanıcılar        | admin                                                                                                                                                                             |
| Prensip             | learnability · Aşinalık (familiarity) ve gerçek dünya eşleşmesi                                                                                                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                             |
| Efor                | M                                                                                                                                                                                 |
| Kaynak denetçiler   | runtime:admin                                                                                                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                      |

**Kanıt:** Sweep 104: 'PENDING: 9', 'DEAD mesajlar', 'DEAD mesaj yok.' p2 (stub): 'Rezervasyon cmg1x2y3z0000bk · kullanıcı cmg1x2y3z0000us · skor 72 · REVIEW', 'velocity (+30)'. p4: 'refund_request · Güven: 0.42'. p5 ekran görüntüsü: 'SCAM — http://…'. İtiraz başlığı 'Ev sahibi · Kaldır · 9 Eki 2026' (fiilin emir kipi, 'Kaldırıldı' değil; AppealQueue.tsx:81). Mailbox meta: 'dev/SENT' (MailboxClient.tsx:53). Destekte linksInRows=0, kimlikler tıklanamıyor.

**Etki:** Admin enum değerlerini zihinde çevirmek zorunda. 'Kaldır' bir eylem düğmesi gibi okunuyor. Rezervasyon ve kullanıcıya gitmek için kimliği kopyalayıp aramak gerekiyor.

**Önerilen aksiyon:** Enum'ları i18n'e bağlayın: outbox.status.PENDING='Bekliyor', DEAD='Başarısız'; dolandırıcılık kararı ve kural adları; intent etiketleri; güveni '%42 (düşük)' biçiminde gösterin. İtirazda geçmiş zaman kullanın ('Kaldırıldı', 'İşlem yapılmadı'). Kimlikleri ilgili admin/ilan sayfalarına bağlayın.

## F462 — Çift tıklamada çift istek: olay sinyali, itiraz ve erişilebilirlik eylemlerinde meşgul (busy) kilidi yok, diğer kuyruklarla tutarsız

| Alan                | Değer                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                |
| Durum               | Gözlemlendi                                                                                           |
| Konum               | `src/components/admin/AdminDashboard.tsx:217`                                                         |
| Diğer konumlar      | `src/components/compliance/AppealQueue.tsx`, `src/components/compliance/AccessibilityReviewQueue.tsx` |
| Kullanıcılar        | admin                                                                                                 |
| Prensip             | robustness · Tepkisellik (responsiveness) ve tutarlılık                                               |
| Sezgisel madde      | H5 — Hata önleme                                                                                      |
| Renk/tema           | Hayır                                                                                                 |
| Efor                | S                                                                                                     |
| Kaynak denetçiler   | runtime:admin                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                          |

**Kanıt:** RUNTIME p2-dashboard.mjs: üçüncü 'Geri al' düğmesine dblclick 2 POST gönderdi (rollback.dblclick.requests=2). act(), fraud resolve(), moderation decide(), AppealQueue decide ve AccessibilityReviewQueue verify fonksiyonlarında busy state yok. PayoutAdmin, SupportAdmin ve ClaimAdmin DecisionForm ise busy kullanıyor.

**Etki:** Yavaş ağda ikinci tıklama aynı kararı iki kez işler ya da hata mesajı üretir ('zaten geri alındı'). Admin işlemin ne durumda olduğunu bilemez.

**Önerilen aksiyon:** Paylaşılan bir useAction(id) kancası yazın: busy iken düğmeyi aria-disabled yapın, etiketi 'İşleniyor…' olarak değiştirin ve satır kimliğiyle kilitleyin. Tüm admin bileşenlerinde aynı kalıbı kullanın.

## F463 — Geri bildirim mesajı tıklanan satırdan uzakta ve görünüm dışında; mesaj hangi kaydın etkilendiğini söylemiyor

| Alan                | Değer                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                               |
| Durum               | Gözlemlendi                                                                                                                          |
| Konum               | `src/components/admin/AdminDashboard.tsx:251`                                                                                        |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx`, `src/components/admin/PayoutAdmin.tsx`, `src/components/admin/SupportAdmin.tsx` |
| Kullanıcılar        | admin                                                                                                                                |
| Prensip             | robustness · Gözlemlenebilirlik: sistem durumu eylemin yapıldığı yerde görünmeli                                                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                |
| Efor                | S                                                                                                                                    |
| Kaynak denetçiler   | runtime:admin                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                         |

**Kanıt:** RUNTIME p2-dashboard.mjs: son 'Geri al' viewport y=422'de tıklandı; 'İşlem uygulandı.' mesajı top=-621'de (inView=false). p5: DSA bildirimi kararı sonrası 'Karar kaydedildi…' top=-205'te (ComplianceDashboard.tsx:235 sayfanın en üstünde). p4 hata akışı (500 stub): 'Sunucu hatası (stub)' 4 hesaplık listenin en altında; hangi ev sahibinde başarısız olduğu belirtilmiyor.

**Etki:** Gören kullanıcı işlemin başarılı olup olmadığını göremiyor ve tekrar tıklıyor (çift istek riski). Hata hangi satıra ait bilinmiyor.

**Önerilen aksiyon:** Durum mesajını satır içinde, düğmenin yanında gösterin (satır başına Status). Mesajda kayıt adı geçsin: 'İstanbul Caz Festivali: onay geri alındı.' Global aria-live bölgesini ekran okuyucu için koruyun.

## F464 — Olay sinyali kuyruğunda durum filtresi ve sıralama yok; aksiyon bekleyen 'Önerildi' kayıtları onaylı ve geri alınmış olanlarla karışık

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/components/admin/AdminDashboard.tsx:254`     |
| Diğer konumlar      | `src/app/api/admin/events/route.ts`               |
| Kullanıcılar        | admin                                             |
| Prensip             | flexibility · Özelleştirilebilirlik ve verimlilik |
| Sezgisel madde      | H7 — Esneklik/verim                               |
| Renk/tema           | Hayır                                             |
| Efor                | M                                                 |
| Kaynak denetçiler   | runtime:admin                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** Sweep 104 (gerçek veri): 16 olayın hepsi 'Onaylı' ve tarihler kronolojik değil (28.10, 24.11, 07.11, 29.12 …). Filtre ya da sıralama kontrolü yok. API createdAt desc, take:100 (events/route.ts:15-19), sayfalama yok. p2b: mobilde olay kartı 2052px yüksekliğinde.

**Etki:** Admin onay bekleyen öneriyi bulmak için tüm listeyi taramak zorunda. Geçmiş kayıtlar arttıkça kuyruk kullanılamaz hâle geliyor.

**Önerilen aksiyon:** Sayılı sekmeler ekleyin: Önerilen / Onaylı / Reddedilen / Geri alınan; varsayılan 'Önerilen' olsun. Başlangıç tarihine göre sıralayın, şehir filtresi ve sayfalama ekleyin.

## F465 — Satır düğmelerinin erişilebilir adları özdeş (14 'Geri al', 4 'Ödemeleri durdur', 3 'Ayrıntıyı göster')

| Alan                | Değer                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                     |
| Durum               | Gözlemlendi                                                                                                                |
| Konum               | `src/components/admin/AdminDashboard.tsx:274`                                                                              |
| Diğer konumlar      | `src/components/admin/PayoutAdmin.tsx`, `src/components/resolution/ClaimList.tsx`, `src/components/admin/SupportAdmin.tsx` |
| Kullanıcılar        | admin                                                                                                                      |
| Prensip             | accessibility · Etiketlerin amacı tanımlaması                                                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                      |
| WCAG                | 2.4.6 Başlıklar ve Etiketler (AA) ile ilişkili                                                                             |
| Renk/tema           | Hayır                                                                                                                      |
| Efor                | S                                                                                                                          |
| Kaynak denetçiler   | runtime:admin                                                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                               |

**Kanıt:** Sweep 104 tabOrder[19..29]: art arda 11 kez 'button "Geri al"'. p2: rollbackButtons=14. p4: payout.buttonNames 4× 'Ödemeleri durdur'; gerekçe alanlarının 4'ü de 'Durdurma gerekçesi (isteğe bağlı)'. p3: 3× 'Ayrıntıyı göster'.

**Etki:** Ekran okuyucunun düğme listesinde ya da sesli komutla hangi etkinliğin, ev sahibinin veya talebin etkileneceği anlaşılmıyor. Yanlış kayıtta eylem riski doğuyor.

**Önerilen aksiyon:** Görsel olarak gizli bir ek ya da aria-label ile kayıt adını ekleyin ('Geri al: İstanbul Caz Festivali', 'Ödemeleri durdur: Ahmet Y.'). Alternatif olarak aria-describedby ile satır başlığına bağlayın.

## F466 — Rol değiştirme formu: ham kullanıcı kimliği istiyor, mevcut rolü göstermiyor, ADMIN yetkisini onaysız veriyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/components/admin/AdminDashboard.tsx:508`         |
| Kullanıcılar        | admin                                                 |
| Prensip             | learnability · Tanıma > hatırlama ve öngörülebilirlik |
| Sezgisel madde      | H6 — Tanıma > hatırlama                               |
| Renk/tema           | Hayır                                                 |
| Efor                | M                                                     |
| Kaynak denetçiler   | runtime:admin                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** Sweep 104 (crops/admin/104-admin-tr-desktop-_admin-3.png): 'Kullanıcı kimliği' boş metin alanı, 'Yeni rol' HOST ön seçili. p2: 'cmg1someuserid' + ADMIN ile 'Rolü güncelle' tıklanınca PATCH /api/admin/users/cmg1someuserid/role {role:'ADMIN'} hemen gidiyor, dialogs=0. Seçenekler ham ['USER','HOST','ADMIN']. Geri bildirim 'Rol güncellendi: ADMIN (en geç 15 dk içinde yansır).' Kimlik alanı temizlenmiyor.

**Etki:** Admin kullanıcının kimliğini başka yerden bulup kopyalamak zorunda. Kimin, hangi rolden hangi role geçtiği görünmüyor. Yanlış kişiye yönetici yetkisi verilmesi (yetki yükseltme) tek tıkla olabiliyor.

**Önerilen aksiyon:** E-posta veya ada göre arama ve otomatik tamamlama ekleyin; sonuçta ad, e-posta ve mevcut rol görünsün. Rolleri Türkçe adlandırın (Misafir/Ev sahibi/Yönetici) ve varsayılan seçim bırakmayın. ADMIN'e yükseltmede 'x@y kullanıcısına yönetici yetkisi verilecek' onayı isteyin.

## F467 — Talep kuyruğu: varsayılan filtre 'Tümü', boş durum metni misafir dilinde ve filtreden habersiz, filtre URL'ye yazılmıyor

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | Medium                                                                  |
| Durum               | Gözlemlendi                                                             |
| Konum               | `src/components/admin/ClaimAdmin.tsx:61`                                |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx`, `src/lib/resolution/claims.ts` |
| Kullanıcılar        | admin                                                                   |
| Prensip             | learnability · Tutarlılık ve gerçek dünya eşleşmesi (yönetici bağlamı)  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                             |
| Renk/tema           | Hayır                                                                   |
| Efor                | S                                                                       |
| Kaynak denetçiler   | runtime:admin                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                            |

**Kanıt:** Sweep 106/107 (gerçek veri): admin /admin/claims 'Henüz bir talebiniz yok.' gösteriyor (crops/admin/106-admin-tr-desktop-_admin_claims-0.png). p3: filtre 'Kapandı' seçilince aynı metin çıkıyor ve URL değişmiyor (http://localhost:3000/admin/claims). EN: 'You have no claims yet.' Varsayılan filtre '' yani Tümü (ClaimAdmin.tsx:23). Destek kuyruğunun varsayılanı ise 'Açık' (SupportAdmin.tsx:30). Liste createdAt desc sıralı (claims.ts:513), SLA ya da aktarılma önceliği yok.

**Etki:** Admin kuyruğun gerçekten boş mu yoksa filtre yüzünden mi boş göründüğünü ayırt edemiyor. Aksiyon bekleyen 'Yöneticiye aktarıldı' talepler kapanmış kayıtlar arasında kayboluyor. Filtreli görünüm paylaşılamıyor.

**Önerilen aksiyon:** Admin'e özel boş durum metni kullanın: 'Bu filtreyle eşleşen talep yok. [Filtreyi temizle]'. Varsayılanı 'Yöneticiye aktarıldı' yapın ve seçeneklerde sayıları gösterin. Filtreyi ?status= parametresinde tutun. SLA'ya göre sıralama seçeneği ekleyin.

## F468 — Admin bir talebi seçince ayrıntı ekranın altında açılıyor; odak taşınmıyor, kaydırma yok

| Alan                | Değer                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Severity            | Medium                                                                             |
| Durum               | Gözlemlendi                                                                        |
| Konum               | `src/components/admin/ClaimAdmin.tsx:72`                                           |
| Kullanıcılar        | admin                                                                              |
| Prensip             | learnability · Durum görünürlüğü / geri bildirim (Dix: robustness – observability) |
| Sezgisel madde      | H12 — Feedback                                                                     |
| Renk/tema           | Hayır                                                                              |
| Efor                | S                                                                                  |
| Kaynak denetçiler   | runtime:resolution                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                       |

**Kanıt:** RUNTIME p6-admin (desktop 1280x800, sahte 3 talepli kuyruk): ilk "Ayrıntıyı göster" butonu Enter ile etkinleştirildi. "Seçili talep" bölümünün üst kenarı y=796'da, yani 800px görünümün tam altında. scrollY=0 kaldı, odak butonda kaldı ("focus after select: button 'Ayrıntıyı göster'"), canlı bölge duyurusu yok. Liste uzadıkça ayrıntı daha da aşağı itilecek. Karar formu da bu bölümün içinde.

**Etki:** Admin tıklamanın işe yarayıp yaramadığını göremiyor, her seçimde aşağı kaydırıp geri dönmek zorunda kalıyor. Ekran okuyucu kullanıcısı ayrıntının yüklendiğini öğrenmiyor. Kuyruk işleme hızı düşüyor.

**Önerilen aksiyon:** Seçimden sonra 'Seçili talep' başlığına tabIndex=-1 verin, scrollIntoView({block:'start'}) ve focus() uygulayın. 'Ayrıntıyı kapat' odağı tekrar seçilen satıra döndürsün. Masaüstünde liste ve ayrıntıyı yan yana (master-detail, sticky panel) yerleştirmeyi düşünün.

## F469 — Kısmi tutar hatası alana bağlı değil (aria-invalid yok) ve odak düğmede kalıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Gözlemlendi                                      |
| Konum               | `src/components/admin/ClaimAdmin.tsx:146`        |
| Kullanıcılar        | admin                                            |
| Prensip             | accessibility · Hata tanımlama ve ilişkilendirme |
| Sezgisel madde      | H9 — Hata mesajları                              |
| WCAG                | 3.3.1 Hata Tanımlama (A) / 1.3.1                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:admin                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** RUNTIME p3-claims.mjs: Kısmi tutar 5000 (talep ₺2.500) girilince istek gitmiyor (posts=0). Mesaj 'Kısmi tutar sıfırdan büyük ve talep edilen tutardan küçük olmalı.' düğmenin altındaki Status'ta çıkıyor. Input'ta aria-invalid=null, aria-describedby yalnızca 'decision-cl1-amount-hint', odak BUTTON üzerinde. Field bileşeni error prop'unu destekliyor (ui.tsx:43-46) ama kullanılmıyor. Aynı metin iki canlı bölgede (aria-live=polite sarmalayıcı + role=alert) bulunuyor.

**Etki:** Ekran okuyucu kullanıcısı hangi alanın hatalı olduğunu öğrenemiyor. Mesaj iki kez okunabilir.

**Önerilen aksiyon:** Hatayı Field error prop'una verin (aria-invalid + describedby) ve input'a odaklanın. Mesajda üst sınırı somut yazın: '₺2.500,00'den küçük olmalı'.

## F470 — Anonim kullanıcı posta kutusunda çıkmaza giriyor: giriş bağlantısı yok, ama menüde bağlantı herkese gösteriliyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Gözlemlendi                                        |
| Konum               | `src/components/dev/MailboxClient.tsx:43`          |
| Diğer konumlar      | `src/components/layout/Header.tsx`                 |
| Kullanıcılar        | misafir, tümü                                      |
| Prensip             | robustness · Kurtarılabilirlik ve diyalog girişimi |
| Sezgisel madde      | H9 — Hata mesajları                                |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | runtime:admin                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** RUNTIME p1-authz.mjs anon /dev/mailbox: role=alert 'Oturum açmanız gerekiyor', mainLinks=[] (crops/admin/p1-anon-mailbox.png). Başlıkta 'Posta kutusu (demo)' anonim kullanıcıya da gösteriliyor ve aria-current ile vurgulu (sweep 050 tabOrder[4]; Header.tsx:29 mailbox öğesinde roles yok).

**Etki:** Kayıt sonrası doğrulama e-postasını arayan yeni kullanıcı (oturum açmamış) ne yapacağını bilemiyor. Hata metni sunucu mesajı olarak ham gösteriliyor.

**Önerilen aksiyon:** MailboxClient'ı RoleGate ile sarın (redirect'li giriş bağlantısı) ya da 'Oturum açın, e-postalarınız burada görünür. [Giriş yap]' CTA'sı gösterin. İsterseniz menü öğesini oturumlu kullanıcılara sınırlayın.

## F584 — Satırlarda tekrar eden düğme adları bağlamsız (ekran okuyucu düğme listesinde ayırt edilemiyor)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Konum               | `src/components/admin/AdminDashboard.tsx:267`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:357`, `src/components/admin/AdminDashboard.tsx:426`, `src/components/admin/AdminDashboard.tsx:175`, `src/components/admin/PayoutAdmin.tsx:84`, `src/components/admin/SupportAdmin.tsx:98`, `src/components/resolution/ClaimList.tsx:57`, `src/components/admin/AdminDashboard.tsx:357-362`, `src/components/admin/AdminDashboard.tsx:426-431`, `src/components/host/RevenueDashboard.tsx:203-210`, `src/components/admin/SupportAdmin.tsx:101-122`, `src/components/compliance/AccessibilityReviewQueue.tsx:104-110`, `src/components/resolution/ClaimList.tsx:56-63`, `src/components/host/PromotionsPanel.tsx:200-206`, `src/components/admin/SupportAdmin.tsx:98-118`, `src/components/compliance/AccessibilityReviewQueue.tsx:103-109` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Prensip             | accessibility · WCAG 2.4.6 Headings and Labels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WCAG                | 2.4.6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Kaynak denetçiler   | area:admin, lens:consistency, lens:forms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Kanıt:** AdminDashboard.tsx:267 `<Button onClick={() => act(ev.id, "approve")}>{t("events.approve")}</Button>`: her olay satırında aynı 'Onayla/Reddet' adı kullanılıyor. 357-362 'Meşru/Dolandırıcılık', 426-431 'Yayınla/Kaldır', 175-177 'Yeniden kuyruğa al', PayoutAdmin.tsx:84-90 'Ödemeleri durdur', SupportAdmin.tsx:98-119 ve ClaimList.tsx:57-64 'Ayrıntıyı göster' için de aynı durum var. aria-describedby ya da sr-only bağlam yok.

**Etki:** Ekran okuyucunun düğme listesinde (NVDA Insert+F7) 20 adet 'Kaldır' görünüyor ve hangi yorumun kaldırılacağı anlaşılmıyor. Bu, yanlış öğe üzerinde işlem riskini artırıyor.

**Önerilen aksiyon:** Her satırın başlık öğesine id verin (`id={`ev-${ev.id}-title`}`) ve düğmelere `aria-describedby` ile bağlayın. Ya da görünmez bir ek kullanın: `<span className="sr-only"> — {ev.title}</span>`. Bu yaklaşımı Payout'ta displayName, Support'ta reason ve tarih, ClaimList'te type ve propertyTitle için de uygulayın.

## F586 — Admin talep kuyruğunda 'Seç' sonrası detay alttaki bölümde açılıyor, odak taşınmıyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                     |
| Durum               | Aday (2 kaynak birleşti)                                                                   |
| Konum               | `src/components/admin/ClaimAdmin.tsx:66`                                                   |
| Diğer konumlar      | `src/components/resolution/ClaimList.tsx:59`, `src/components/resolution/ClaimList.tsx:57` |
| Kullanıcılar        | admin                                                                                      |
| Prensip             | flexibility · multithreading / verimlilik                                                  |
| Sezgisel madde      | H7 — Esneklik/verim                                                                        |
| WCAG                | 2.4.3                                                                                      |
| Renk/tema           | Hayır                                                                                      |
| Efor                | S                                                                                          |
| Kaynak denetçiler   | lens:a11y, lens:status                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                               |

**Kanıt:** 63-68 `onSelect={setSelectedId}` yalnız state değiştiriyor; 72-97 detay `<section aria-labelledby="claim-admin-selected">` listedeki tüm öğelerden SONRA render ediliyor, odak ya da kaydırma yok; 78 'Kapat' düğmesi bölümü kaldırınca odak kayboluyor; ClaimList.tsx:59-61 'Seç' düğmesi yalnız aria-pressed.

**Etki:** Yönetici (klavye/ekran okuyucu) her talep için kalan tüm liste öğelerini Tab'layarak detaya ulaşıyor; kuyruk işleme hızı düşüyor, yanlış talebi incelediğini fark etmeyebilir.

**Önerilen aksiyon:** Seçimde `h2#claim-admin-selected`'a (tabIndex=-1) odak + scrollIntoView; 'Kapat'ta odağı seçili satırın 'Seç' düğmesine geri verin; geniş ekranda liste/detayı yan yana (master-detail) yerleştirin.

## F641 — Pano 7 bölümü tek sütunda sıralıyor; bölüm navigasyonu ve kuyruk sayaçları yok, eylem gerektirenler sonda

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/admin/AdminDashboard.tsx:80`     |
| Kullanıcılar        | admin                                            |
| Prensip             | flexibility · dialog initiative / multithreading |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:admin                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** AdminDashboard.tsx:80-88 `<LlmStatusCard /><OutboxCard /><EventsCard /><FraudCard /><ReviewModerationCard /><ExperimentsCard /><RoleCard />`: tanılama kartları önce, karar bekleyen kuyruklar (fraud, moderasyon) sonra geliyor. Kartların id'leri var (llm-status, fraud, review-moderation...) ama sayfa içi bağlantı yok. Başlıklarda bekleyen öğe sayısı gösterilmiyor (ör. 'Fraud inceleme kuyruğu').

**Etki:** Yönetici bekleyen fraud ve moderasyon işlerini görmek için LLM, outbox ve olay formunu geçerek uzun bir sayfayı kaydırıyor. Hangi kuyrukta iş olduğunu ancak tüm sayfayı tarayarak öğrenebiliyor.

**Önerilen aksiyon:** Sayfanın üstüne `<nav aria-label="Pano bölümleri">` ve sayaçlı anchor listesi ekleyin ('Fraud (3)', 'Moderasyon (5)', 'Olay önerileri (2)'). Kart sırasını eylem gerektirenler önce olacak şekilde değiştirin (fraud, moderasyon, olaylar, rol), tanılama kartlarını (LLM, outbox, deneyler) sona alın. Kart başlıklarına sayı ekleyin.

## F642 — Yönetim ana sayfası bekleyen iş sayılarını göstermiyor; sistem kartları kuyrukların önünde

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/admin/AdminDashboard.tsx:81` |
| Diğer konumlar      | `src/app/admin/page.tsx:17-33`               |
| Kullanıcılar        | admin                                        |
| Prensip             | robustness · observability                   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü               |
| Renk/tema           | Hayır                                        |
| Efor                | M                                            |
| Kaynak denetçiler   | lens:copy                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** AdminDashboard.tsx:79-87 sıra: LlmStatusCard, OutboxCard, EventsCard, FraudCard, ReviewModerationCard, ExperimentsCard, RoleCard. admin/page.tsx:17-33 uyum/ödeme/talep/destek kuyruklarına yalnız sayısız metin bağlantıları ('Destek kuyruğu').

**Etki:** Yönetici hangi kuyrukta SLA'sı yaklaşan iş olduğunu görmek için her sayfayı tek tek açar; acil dolandırıcılık incelemesi LLM ayarlarının altında kalır.

**Önerilen aksiyon:** Üstte sayaçlı özet şeridi ekleyin ('Dolandırıcılık 3 · Moderasyon 5 · DSA 2 (1 SLA aşıldı) · Destek 4'); kuyruk kartlarını sistem/teşhis kartlarının (LLM, outbox, deney) önüne alın.

## F643 — Yönetim panosu kartlarında yükleniyor durumu yok; diğer ekranlarda aria-live kullanımı tutarsız

| Alan                | Değer                                                                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/admin/AdminDashboard.tsx:97`                                                                                                                                                                                                                                                                                     |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:148`, `src/components/admin/AdminDashboard.tsx:253`, `src/components/admin/AdminDashboard.tsx:331`, `src/components/admin/AdminDashboard.tsx:406`, `src/components/admin/AdminDashboard.tsx:448`, `src/components/admin/PayoutAdmin.tsx:54`, `src/components/admin/SupportAdmin.tsx:81` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                                                                            |
| Prensip             | robustness · observability                                                                                                                                                                                                                                                                                                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                            |
| Efor                | S                                                                                                                                                                                                                                                                                                                                |
| Kaynak denetçiler   | area:admin                                                                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                     |

**Kanıt:** AdminDashboard.tsx:97-98 `<Status error={error} />{data && (...)}`: veri gelene kadar kartta yalnızca başlık ve boş bir div var. 148, 253-254, 331-332, 406-407 ve 448-449'da da aynı durum geçerli. PayoutAdmin.tsx:54 ve SupportAdmin.tsx:81 'Yükleniyor…' metnini aria-live olmadan gösteriyor. ClaimAdmin.tsx:55 ise `aria-live="polite"` kullanıyor.

**Etki:** Yavaş ağda 7 kartın tamamı boş görünüyor ve yönetici 'kuyruk boş' sanabiliyor; gerçek boş durum mesajı ancak veri gelince görünüyor. Ekran okuyucu kullanıcıları yüklemenin bittiğini öğrenemiyor.

**Önerilen aksiyon:** Her kartta `{!data && !error && <p aria-live="polite" className="text-sm text-gray-600">{tc("loading")}</p>}` ekleyin ya da section'a `aria-busy={!data}` ile iskelet satırlar koyun. PayoutAdmin ve SupportAdmin'deki yükleniyor metnine `aria-live="polite"` ekleyin. Bu durumu ortak bir `<LoadState data error />` bileşeninde toplayın.

## F644 — Yönetici işlemlerinde hata mesajları koda göre çevrilmiyor; ham sunucu ve tarayıcı metni gösteriliyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/admin/AdminDashboard.tsx:141`                                                                                                                                                                                                                                                                                                                    |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:211`, `src/components/admin/AdminDashboard.tsx:224`, `src/components/admin/AdminDashboard.tsx:324`, `src/components/admin/AdminDashboard.tsx:399`, `src/components/admin/AdminDashboard.tsx:502`, `src/components/admin/PayoutAdmin.tsx:47`, `src/components/admin/SupportAdmin.tsx:54`, `src/components/ui/ui.tsx:266` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                                                                                                            |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                                                                                                                      |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                            |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                |
| Kaynak denetçiler   | area:admin                                                                                                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                     |

**Kanıt:** AdminDashboard.tsx:141 `setFeedback({ error: errorMessage(e) })`. Aynı kalıp 211, 224, 324, 399 ve 502'de; ayrıca PayoutAdmin.tsx:47 ve SupportAdmin.tsx:54'te var. ui.tsx:266 `errorMessage` yalnız `error.message` döndürüyor. Ağ kesintisinde fetch'in TypeError'ı 'Failed to fetch' olarak TR arayüzde aynen görünüyor. JSON olmayan yanıtta api-client.ts:40 'İstek başarısız (404)' dönüyor. Zod hatası yalnızca 'Doğrulama hatası' diyor. role/route.ts 'LAST_ADMIN' kodunu döndürüyor ama istemcide eşlemesi yok. Karşılaştırma: Talepler için resolution/shared.tsx:122 `useClaimErrorText` kod eşlemesi yapıyor.

**Etki:** Yönetici hatanın nedenini ve nasıl düzeltileceğini öğrenemiyor (ör. kayıt başka bir yönetici tarafından işlendi mi, ağ mı koptu). EN arayüzde Türkçe ya da İngilizce tarayıcı metni karışık görünüyor.

**Önerilen aksiyon:** `useAdminErrorText()` kancası yazın. Bu kanca ApiError.code değerlerini (FORBIDDEN, NOT_FOUND, LAST_ADMIN, VALIDATION_ERROR, TRANSACTION_CONFLICT, SERVICE_UNAVAILABLE, RATE_LIMITED) `admin.errors.<code>` anahtarlarına eşlesin; tr ve en için çeviri ekleyin. TypeError için 'Sunucuya ulaşılamadı; bağlantınızı kontrol edip tekrar deneyin' gösterin. NOT_FOUND için 'Bu kayıt başka bir yönetici tarafından işlenmiş olabilir; liste yenilendi' deyip reload() çağırın.

## F645 — Pano eylemlerinde çift gönderim koruması ve 'işleniyor' durumu yok

| Alan                | Değer                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                                                       |
| Konum               | `src/components/admin/AdminDashboard.tsx:175`                                                                                                                                              |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:267`, `src/components/admin/AdminDashboard.tsx:357`, `src/components/admin/AdminDashboard.tsx:426`, `src/components/admin/AdminDashboard.tsx:531` |
| Kullanıcılar        | admin                                                                                                                                                                                      |
| Prensip             | robustness · responsiveness                                                                                                                                                                |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                      |
| Efor                | S                                                                                                                                                                                          |
| Kaynak denetçiler   | area:admin                                                                                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                               |

**Kanıt:** AdminDashboard.tsx:175 `<Button variant="secondary" onClick={() => requeue(m.id)}>` için disabled ya da busy yok. Olay düğmeleri (267-276), fraud (357-362), moderasyon (426-431) ve rol submit (531) için de aynı durum geçerli. Karşılaştırma: aynı dosyada 244 `disabled={busy}` ve PayoutAdmin.tsx:86 `disabled={busy === row.userId}` var. İkinci requeue isteği `NotFoundError("DEAD mesaj bulunamadı")`, ikinci 'Reddet' isteği ise rejectEvent'in yalnız PROPOSED kabul etmesi nedeniyle hata döndürüyor.

**Etki:** Çift tıklamada önce başarı mesajı geliyor, hemen ardından aynı alana hata mesajı yazılıyor. Yönetici işlemin başarılı olup olmadığını bilemiyor. Yavaş ağda hiçbir 'işleniyor' göstergesi olmadığı için tekrar tıklama olasılığı artıyor.

**Önerilen aksiyon:** Her kartta `const [busyId, setBusyId] = useState<string | null>(null)` tutun. Eylem süresince o satırın tüm düğmelerini `disabled={busyId === item.id}` yapın ve li'ye `aria-busy` ekleyin. Düğme metnini 'İşleniyor…' olarak değiştirin. Rol formunda submit'i busy süresince disabled tutun.

## F646 — Başarı mesajları hangi öğeye hangi işlemin yapıldığını söylemiyor

| Alan                | Değer                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                               |
| Durum               | Aday                                                                                                                                                                 |
| Konum               | `src/components/admin/AdminDashboard.tsx:221`                                                                                                                        |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:321`, `src/components/admin/AdminDashboard.tsx:396`, `src/components/admin/SupportAdmin.tsx:51`, `messages/tr/admin.json:7` |
| Kullanıcılar        | admin                                                                                                                                                                |
| Prensip             | robustness · observability                                                                                                                                           |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                |
| Efor                | S                                                                                                                                                                    |
| Kaynak denetçiler   | area:admin                                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                         |

**Kanıt:** AdminDashboard.tsx:221 `setFeedback({ message: t("events.applied") })` onay, ret ve geri alma için aynı 'İşlem uygulandı.' metnini veriyor. 321 ve 396 `t("decisionSaved")` metni 'Karar kaydedildi.'; karara bağlanan öğe listeden kaybolduğu için hangi kaydın işlendiği görünmüyor. SupportAdmin.tsx:51 'Talep güncellendi.' diyor. API onayda `repriced` sayısını döndürüyor (lib/pricing/event-signals.ts:283) ama bu bilgi kullanılmıyor.

**Etki:** Öğe kaybolduktan sonra yönetici doğru kaydı doğru kararla işleyip işlemediğini doğrulayamıyor. Yanlış tık fark edilmeden geçiyor.

**Önerilen aksiyon:** Mesajları parametreli yapın: '‘{title}’ onaylandı; {repriced} gece yeniden fiyatlandı.', 'Rezervasyon {id} meşru olarak işaretlendi.', '‘{propertyTitle}’ yorumu kaldırıldı.', 'Talep ‘İnceleniyor’ durumuna alındı; ‘İnceleniyor’ filtresinde görebilirsiniz.' Uygun yerlerde mesaja 'Geri al' bağlantısı ekleyin.

## F647 — LLM olay önerisi onaydan önce düzenlenemiyor; kaynak ve kategori gösterilmiyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/admin/AdminDashboard.tsx:265` |
| Kullanıcılar        | admin                                         |
| Prensip             | flexibility · substitutivity / recoverability |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü             |
| Renk/tema           | Hayır                                         |
| Efor                | M                                             |
| Kaynak denetçiler   | area:admin                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** AdminDashboard.tsx:265-271: PROPOSED olay için yalnızca 'Onayla' ve 'Reddet' var. LLM'in çıkardığı title, startsAt, endsAt ve impact (260-262) düzenlenemiyor. `category` ve `source` (37-39) çekiliyor ama gösterilmiyor.

**Etki:** LLM tarihleri yanlış çıkardığında (ör. Ekim yerine Kasım) yönetici öneriyi reddetmek (geri alınamaz) ve metni yeniden yazmak zorunda kalıyor. Yanlış tarihli bir öneriyi onaylamak ise fiyatları yanlış gecelerde değiştiriyor.

**Önerilen aksiyon:** PROPOSED satırına 'Düzenle' ekleyin. Satır içi formda başlık, `<input type="date">` başlangıç ve bitiş, 1–10 arası `<input type="number">` etki ve şehir alanları olsun; API'de PATCH desteği gerekir. Satırda kaynak ve kategoriyi gösterin.

## F648 — Pano verisi tek seferlik; yenileme düğmesi, son güncelleme zamanı ve eşzamanlı yönetici uyarısı yok

| Alan                | Değer                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/admin/AdminDashboard.tsx:311`                                                                                                                                                                                                                                    |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:94`, `src/components/admin/AdminDashboard.tsx:131`, `src/components/admin/AdminDashboard.tsx:191`, `src/components/admin/AdminDashboard.tsx:386`, `src/components/admin/PayoutAdmin.tsx:25`, `src/components/admin/SupportAdmin.tsx:31` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                            |
| Prensip             | robustness · observability / responsiveness                                                                                                                                                                                                                                      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                            |
| Efor                | M                                                                                                                                                                                                                                                                                |
| Kaynak denetçiler   | area:admin                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                     |

**Kanıt:** AdminDashboard.tsx:311 `useLoader(() => apiFetch<FraudCheck[]>("/api/admin/fraud"))` yalnızca montajda bir kez çalışıyor. 94, 131, 191, 386, 444 ile PayoutAdmin ve SupportAdmin'de de durum aynı. Arayüzde 'Yenile' ya da 'Son güncelleme' yok. Başka bir yöneticinin işlediği yorum için `NotFoundError("Kuyrukta böyle bir yorum yok")` (moderation-queue.ts:96) dönüyor.

**Etki:** Saatlerce açık kalan sekmede yönetici bayat kuyrukla çalışıyor ve başka bir yöneticinin işlediği kayıtta anlaşılmaz bir hata alıyor. LLM durumu ve outbox sayaçlarının ne zamana ait olduğu bilinmiyor.

**Önerilen aksiyon:** Her Card başlığına 'Yenile' düğmesi (reload) ve 'Son güncelleme: {time}' metni ekleyin. Kuyruk kartlarında sekme görünürken 60 saniyede bir sessiz yenileme yapın. 404/409 yanıtlarında 'Bu kayıt başka bir yönetici tarafından işlendi' gösterip otomatik reload() çağırın.

## F649 — Kuyruklar sessizce kesiliyor (ilk 50/100/200 kayıt); toplam sayı ve sayfalama yok

| Alan                | Değer                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                             |
| Durum               | Aday                                                                                                                                                                                                                               |
| Konum               | `src/components/admin/AdminDashboard.tsx:333`                                                                                                                                                                                      |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:255`, `src/components/admin/AdminDashboard.tsx:408`, `src/components/admin/AdminDashboard.tsx:162`, `src/components/admin/PayoutAdmin.tsx:60`, `src/components/admin/SupportAdmin.tsx:85` |
| Kullanıcılar        | admin                                                                                                                                                                                                                              |
| Prensip             | robustness · observability                                                                                                                                                                                                         |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                                                                  |
| Kaynak denetçiler   | area:admin                                                                                                                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                       |

**Kanıt:** AdminDashboard.tsx:333 `<ul className="space-y-2">{data.map(...)}` toplam sayıyı göstermiyor. Sunucu tarafında fraud `take: 100` (api/admin/fraud/route.ts), olaylar `take: 100` (api/admin/events/route.ts), moderasyon `QUEUE_LIMIT = 50` (moderation-queue.ts:11), outbox DEAD `take: 50`, payout `take: 200` (overview.ts:143) ve destek `TICKET_LIST_LIMIT = 100` sınırları var.

**Etki:** Kuyruk sınırı aştığında yönetici 'hepsini işledim' sanıyor, oysa görünmeyen kayıtlar bekliyor. Bu, SLA kaçırma riskini artırıyor.

**Önerilen aksiyon:** API'ler `{ items, total }` döndürsün. Kart başlığının altında '{shown}/{total} kayıt gösteriliyor' metni olsun ve imleç tabanlı bir 'Daha fazla yükle' düğmesi ekleyin. Sınır aşıldığında uyarı metni gösterin.

## F650 — Kuyruk öğelerinde karar için gereken bağlam ve bağlantılar eksik (tarih, tutar, kullanıcı, dil)

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                    |
| Durum               | Aday                                                                                      |
| Konum               | `src/components/admin/AdminDashboard.tsx:340`                                             |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx:92`, `src/components/admin/AdminDashboard.tsx:411` |
| Kullanıcılar        | admin                                                                                     |
| Prensip             | robustness · task conformance                                                             |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                                   |
| Renk/tema           | Hayır                                                                                     |
| Efor                | M                                                                                         |
| Kaynak denetçiler   | area:admin                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                              |

**Kanıt:** AdminDashboard.tsx:340 `{t("fraud.booking", { id: f.bookingId })} · {t("fraud.user", { id: f.userId })}`: ham cuid gösteriliyor ve bağlantı yok. `createdAt` (satır 50) çekiliyor ama gösterilmiyor; tutar da yok. SupportAdmin.tsx:92-94: rezervasyon ID'si bağlantısız. Repo `userId`yi döndürüyor (lib/support/repo.ts SupportTicketRow) ama arayüz tipi (SupportAdmin.tsx:11-21) onu atıyor. `locale` (satır 19) çekiliyor ama gösterilmiyor. Moderasyon satırında (411-415) yorum tarihi ve tesise bağlantı yok.

**Etki:** Yönetici fraud kararını rezervasyon tutarını ve zamanını görmeden veriyor. Destek talebinde kullanıcının dilini ve kimliğini bilmeden 'Çözüldü' işaretliyor. Doğrulama için başka ekranlarda ID ile arama yapıp bilgileri akılda tutmak zorunda kalıyor.

**Önerilen aksiyon:** Fraud satırına `f.dateTime(f.createdAt)` ekleyin; API'den rezervasyon tutarını alıp gösterin; rezervasyon ID'sini yönetici rezervasyon görünümüne bağlayın. Destek satırına 'Dil: EN' (row.locale), kullanıcı bağlantısı ve konuşma dökümü bağlantısı ekleyin. Moderasyona yorum tarihi ve `/property/{propertyId}` bağlantısı ekleyin.

## F651 — Yönetici kuyruklarında rezervasyon, ilan ve kullanıcı kimlikleri bağlantısız düz metin

| Alan                | Değer                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                     |
| Konum               | `src/components/admin/AdminDashboard.tsx:340`                                                                                                                                                            |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx:94`, `src/components/resolution/ClaimList.tsx:41`, `src/components/compliance/ComplianceDashboard.tsx:131-133`, `src/components/admin/AdminDashboard.tsx:509-517` |
| Kullanıcılar        | admin                                                                                                                                                                                                    |
| Prensip             | flexibility · multithreading / task migratability                                                                                                                                                        |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                        |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                             |

**Kanıt:** AdminDashboard.tsx:340 `{t("fraud.booking", { id: f.bookingId })} · {t("fraud.user", { id: f.userId })}` düz metin. SupportAdmin.tsx:94 `t("booking", { id: row.bookingId })` düz metin. ClaimList.tsx:41 `t("list.bookingRef", { id: c.bookingId })` düz metin. ComplianceDashboard.tsx:131-133 `{td.propertyId}` düz metin. Aynı panelde ilan adı bağlantı olarak verilebiliyor (AccessibilityReviewQueue.tsx:84). RoleCard da kullanıcı kimliğini elle yazdırıyor (AdminDashboard.tsx:509-517).

**Etki:** Fraud ya da destek kaydını incelemek isteyen yönetici kimliği kopyalayıp başka bir ekranda arar. Bu hem yavaştır hem de yanlış kayıt seçme riski taşır. 'Hızlı ve hatasız kuyruk işleme' görevi doğrudan yavaşlar.

**Önerilen aksiyon:** Kimlikleri ilgili sayfalara bağlayın: bookingId için /booking/{id} (admin yetkisi varsa) ya da bir admin rezervasyon görünümü, propertyId için /property/{id}. Kullanıcı kimliğinin yanına 'Rolü değiştir' kısayolu ekleyin (RoleCard'ı önceden dolduran). Uzun kimlikleri kısaltıp tam değeri `title` ve kopyala düğmesiyle sunun.

## F652 — Ham enum ve kod değerleri çevrilmeden gösteriliyor (review/deny, PENDING/DONE, human_request, USER/HOST/ADMIN)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                  |
| Konum               | `src/components/admin/AdminDashboard.tsx:341`                                                                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:153`, `src/components/admin/AdminDashboard.tsx:101`, `src/components/admin/AdminDashboard.tsx:525`, `src/components/admin/AdminDashboard.tsx:500`, `src/components/admin/AdminDashboard.tsx:348`, `src/components/admin/SupportAdmin.tsx:93`, `src/components/ui/ui.tsx:230` |
| Kullanıcılar        | admin                                                                                                                                                                                                                                                                                                                 |
| Prensip             | learnability · familiarity                                                                                                                                                                                                                                                                                            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                 |
| Efor                | S                                                                                                                                                                                                                                                                                                                     |
| Kaynak denetçiler   | area:admin                                                                                                                                                                                                                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                          |

**Kanıt:** AdminDashboard.tsx:341 `<strong>{f.score}</strong> · {f.decision}` 'review', 'deny' ya da 'block' basıyor. 153 `{status}: <strong>{count}</strong>` docs/img/admin.png'de 'PENDING: 1 DONE: 335' olarak görünüyor. 101 `<dd>{data.mode}</dd>` ('demo'). 525-527 `<option value="USER">USER</option>` sabit kodlu ve çevrilmemiş. 500 `{ role: res.role }` 'Rol güncellendi: HOST'. SupportAdmin.tsx:93 `{row.intent}` docs/img/v5-admin-support.png'de 'human_request' olarak görünüyor. 348 `<code>{r.code}</code>` (velocity_user). ui.tsx:230 `roles.join(" / ")`.

**Etki:** TR arayüzde İngilizce teknik kodlar okunuyor. Yönetici 'deny' ile 'block' arasındaki farkı, 'human_request'in ne olduğunu ve skorun ölçeğini ezbere bilmek zorunda kalıyor.

**Önerilen aksiyon:** Şu anahtarları tr ve en için ekleyin: `admin.fraud.decisions.{review,deny,block}` ('İncelemede', 'Reddedildi', 'Engellendi'), `admin.outbox.status.{PENDING,DONE,DEAD,...}`, `admin.llm.modes.*`, `admin.roles.options.{USER,HOST,ADMIN}` ('Misafir', 'Ev sahibi', 'Yönetici') ve `support.admin.intent.*`. Skoru 'skor 72/100' biçiminde ölçekle gösterin. Ham kodu gerekirse ikincil `<code>` olarak tutun.

## F653 — Eylem düğmeleri sonuçlarını önceden bildirmiyor (fraud kararı, olay onayı, ödeme durdurma)

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                |
| Durum               | Aday                                                                                                                  |
| Konum               | `src/components/admin/AdminDashboard.tsx:358`                                                                         |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:267`, `src/components/admin/PayoutAdmin.tsx:89`, `messages/tr/admin.json:61` |
| Kullanıcılar        | admin                                                                                                                 |
| Prensip             | learnability · predictability                                                                                         |
| Sezgisel madde      | H13 — Feedforward                                                                                                     |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | S                                                                                                                     |
| Kaynak denetçiler   | area:admin                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                          |

**Kanıt:** AdminDashboard.tsx:358 ve 361 düğme etiketleri ad olarak verilmiş: 'Meşru' / 'Dolandırıcılık' (admin.json fraud.legit/fraud); eylemin ne yapacağı ve sonucu yazmıyor. 267 'Onayla' tıklanınca şehirdeki tüm tesislerin olay penceresi yeniden fiyatlanıyor (lib/pricing/event-signals.ts:279-283) ama bu satırda belirtilmiyor. PayoutAdmin.tsx:89 'Ödemeleri durdur' bekleyen ödemelere ne olacağını söylemiyor.

**Etki:** Yönetici bir kararın kullanıcıyı engelleyip engellemeyeceğini, fiyatları ne zaman etkileyeceğini ve bekleyen ödemelere ne olacağını tahmin etmek zorunda kalıyor. Bu da yanlış kararları ve tereddüdü artırıyor.

**Önerilen aksiyon:** Etiketleri fiil olarak yazın: 'Meşru olarak işaretle' ve 'Dolandırıcılığı onayla'. Fraud kartına sonucu açıklayan bir hint ekleyin. Olay onayına aria-describedby ile bağlı bir hint koyun: 'Onay, {city} için {start}–{end} gecelerini hemen yeniden fiyatlar.' Durdurma düğmesine 'Bekleyen {count} ödeme, devam ettirilene kadar gönderilmez.' notu ekleyin.

## F654 — Yapay zekâ üretimi içerik (moderasyon açıklaması, olay önerisi, destek özeti) etiketlenmiyor

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                    |
| Durum               | Aday                                                                                      |
| Konum               | `src/components/admin/AdminDashboard.tsx:418`                                             |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:280`, `src/components/admin/SupportAdmin.tsx:96` |
| Kullanıcılar        | admin                                                                                     |
| Prensip             | learnability · consistency                                                                |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                               |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | area:admin                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                              |

**Kanıt:** AdminDashboard.tsx:418 `{r.explanation}`: API her öğeyi `markAiGenerated` ile işaretliyor (api/admin/reviews/route.ts) ama arayüzde LlmBadge yok. Olay listesinde (260-262, 280) LLM'in çıkardığı başlık, etki ve gerekçe rozetsiz; yalnızca form yanındaki son öneri için 247 `<LlmBadge mode={lastMode} />` var. SupportAdmin.tsx:96 `{row.summary}` LLM aracıyla yazılıyor (lib/support/tools.ts:148) ama etiketsiz. ui.tsx:119-122 yorumuna göre her AI çıktısının yanında rozet gösterilmesi gerekiyor.

**Etki:** Yönetici AI özetini doğrulanmış bir olgu sanıp karar verebiliyor (ör. moderasyonda 'neden işaretlendi'). Uygulamanın başka yerlerindeki AI şeffaflık kuralıyla da tutarsız.

**Önerilen aksiyon:** Açıklama, gerekçe ve özetin yanına `<LlmBadge mode={item.llmMode} />` koyun; API her öğe için llmMode döndürsün. Mod bilinmiyorsa 'AI özeti, doğrulayın' gibi sabit bir etiket kullanın.

## F655 — Rol ve teknik durum kodları çevrilmeden gösteriliyor (USER/HOST/ADMIN, outbox ve fraud durumları)

| Alan                | Değer                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                                                                    |
| Konum               | `src/components/admin/AdminDashboard.tsx:525`                                                                                                                                                                           |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:151-154`, `src/components/admin/AdminDashboard.tsx:341`, `src/components/admin/AdminDashboard.tsx:500`, `src/components/ui/ui.tsx:229-231`, `src/app/account/page.tsx:238-242` |
| Kullanıcılar        | admin, ev sahibi, misafir                                                                                                                                                                                               |
| Prensip             | learnability · consistency / real-world match                                                                                                                                                                           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                            |

**Kanıt:** AdminDashboard.tsx:525-527 `<option value="USER">USER</option><option value="HOST">HOST</option><option value="ADMIN">ADMIN</option>`, :500 `t("roles.updated", { role: res.role })` ham değer, :151-154 `{status}: <strong>{count}</strong>` outbox durumları ham, :341 `{f.decision}` ham. ui.tsx:229-231 RoleGate `t("forbidden", { roles: roles.join(" / ") })` misafir ya da hosta "(HOST / ADMIN rolü gerekir)" gösteriyor. Buna karşılık account/page.tsx:238-242 aynı rolleri `t("role.host")` ile "Ev Sahibi" olarak çeviriyor.

**Etki:** Aynı kavram hesap sayfasında 'Ev Sahibi', yetki hatasında 'HOST' olarak görünür. Yönetici rol değiştirirken EN ve TR arayüzde aynı ham kodu görür. Misafir yetki hatasında anlamadığı bir kodla karşılaşır.

**Önerilen aksiyon:** Rol etiketlerini common.roles.<ROLE> anahtarında toplayın ve account, RoleGate (`roles.map(r => t(`roles.${r}`)).join(" / ")`) ile RoleCard seçeneklerinde kullanın. Outbox ve fraud kararları için admin.outbox.status.<S> ve admin.fraud.decision.<D> anahtarları ekleyin.

## F656 — Filtre ve seçili talep URL'de tutulmuyor; talepler varsayılan olarak 'Tümü' açılıyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Aday                                               |
| Konum               | `src/components/admin/ClaimAdmin.tsx:23`           |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx:30`         |
| Kullanıcılar        | admin                                              |
| Prensip             | flexibility · task migratability / customizability |
| Sezgisel madde      | H7 — Esneklik/verim                                |
| Renk/tema           | Hayır                                              |
| Efor                | M                                                  |
| Kaynak denetçiler   | area:admin                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** ClaimAdmin.tsx:23 `useState<ClaimStatus | "">("")` ve 24 `useState<string | null>(null)` yalnızca bellekte tutuluyor. SupportAdmin.tsx:30 de aynı şekilde. Yöneticinin iş kuyruğu 'Yöneticiye aktarıldı' (ESCALATED) talepler, ama varsayılan liste kapanmış talepleri de içeriyor (resolution.json admin.pageIntro: 'Taraflarca çözülemeyen talepleri inceleyin').

**Etki:** Her ziyarette ve yenilemede filtreyi yeniden seçmek gerekiyor. Tarayıcının geri tuşu seçimi kaybettiriyor. Belirli bir talep iş arkadaşına bağlantıyla iletilemiyor ve iş devri zorlaşıyor.

**Önerilen aksiyon:** useSearchParams ile `?status=ESCALATED&claim=<id>` parametrelerini okuyun ve `router.replace` ile güncelleyin. Talepler için varsayılan filtreyi ESCALATED yapın. Seçeneklerde sayıları gösterin, ör. 'Yöneticiye aktarıldı (4)'. Destek kuyruğu için de `?status=` senkronize edin.

## F657 — Yönetici talep kuyruğunda filtre ve seçili talep URL'de değil; e-posta bağlantısı karar formuna götürmüyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                        |
| Durum               | Aday                                                                                          |
| Konum               | `src/components/admin/ClaimAdmin.tsx:23`                                                      |
| Diğer konumlar      | `src/app/resolution/[id]/page.tsx:60`, `src/lib/notifications/resolution-notifications.ts:40` |
| Kullanıcılar        | admin                                                                                         |
| Prensip             | flexibility · task migratability                                                              |
| Sezgisel madde      | H7 — Esneklik/verim                                                                           |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | lens:nav                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                  |

**Kanıt:** 23-24 `useState` ile status ve selectedId. Ayrıntı listenin altında render ediliyor (72-97); odak taşınmıyor. Bildirim bağlantısı `${base}/resolution/${claimId}` (resolution-notifications.ts:40); resolution/[id]/page.tsx:60 ClaimDetail'i renderAdmin olmadan render ettiği için yönetici bu sayfada karar formunu görmüyor.

**Etki:** Yönetici e-postadaki ya da yer imindeki belirli bir talebi doğrudan karar ekranında açamıyor. Yenilemede seçim kayboluyor. Uzun kuyrukta ayrıntıyı görmek için aşağı kaydırması gerekiyor.

**Önerilen aksiyon:** Filtre ve seçimi `?status=&claim=` olarak URL'ye yazın (router.replace) ve başlangıçta searchParams'tan okuyun. resolution/[id] sayfasında rol ADMIN ise `/admin/claims?claim={id}` adresine "Yönetici olarak karar ver" bağlantısı gösterin. Seçimde ayrıntı başlığına odaklanın (`tabIndex={-1}` + focus()).

## F658 — Kısmi tutar hatası alana bağlanmıyor ve pattern ihlali için açıklama yok

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                               |
| Durum               | Aday                                                                                 |
| Konum               | `src/components/admin/ClaimAdmin.tsx:146`                                            |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:214`, `src/components/admin/ClaimAdmin.tsx:238` |
| Kullanıcılar        | admin                                                                                |
| Prensip             | robustness · recoverability                                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                  |
| WCAG                | 3.3.1                                                                                |
| Renk/tema           | Hayır                                                                                |
| Efor                | S                                                                                    |
| Kaynak denetçiler   | area:admin                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                         |

**Kanıt:** ClaimAdmin.tsx:146 `setFeedback({ error: t("decision.invalidAmount") })` hatayı gönder düğmesinin altındaki Status'ta (238) gösteriyor. Field'ın `error` prop'u (201-207) kullanılmadığı için input'a aria-invalid ve aria-describedby eklenmiyor, odak da alana taşınmıyor. 214 `pattern="\d+([.,]\d{1,3})?"` için `title` yok; tarayıcı yalnızca genel 'İstenen biçimi eşleştirin' uyarısını gösteriyor.

**Etki:** Yönetici hatalı alanı hemen bulamıyor. Ekran okuyucu alanı geçersiz olarak bildirmiyor. Pattern ihlalinde hangi biçimin beklendiği anlaşılmıyor.

**Önerilen aksiyon:** `const [amountError, setAmountError] = useState<string|null>(null)` ekleyin ve `<Field ... error={amountError}>` olarak verin. Hata oluşunca `amountRef.current?.focus()` çağırın. pattern'i kaldırıp doğrulamayı parseMajorInput'a bırakın ya da `title={t("decision.amountFormat")}` ekleyin. Hint'e örnek değer ekleyin, ör. 'Örn. 1250,50'.

## F659 — 'Karar kaydedildi' mesajı form kapanınca kayboluyor (geri bildirim unmount oluyor)

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/admin/ClaimAdmin.tsx:164` |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:131` |
| Kullanıcılar        | admin                                     |
| Prensip             | robustness · observability                |
| Sezgisel madde      | H12 — Feedback                            |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:admin                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** ClaimAdmin.tsx:164-167 `setFeedback({ message: t("decision.done", ...) }); ... onDecided();` ayrıntıyı yeniden yüklüyor. Talep artık aktif olmadığı için 131-136'daki erken dönüş Status içermeyen 'Bu talep sonuçlandı; yeni karar verilemez.' kartını render ediyor. Böylece başarı mesajı ve onun aria-live alanı DOM'dan kalkıyor.

**Etki:** Para hareketi içeren kararın kaydedildiğine dair açık mesaj ancak kısa bir an görünüyor. Ekran okuyucu mesajı duyurmadan alan kaldırılabiliyor ve yönetici kararın hangi sonuçla kaydedildiğinden emin olamıyor.

**Önerilen aksiyon:** Başarı mesajını ClaimAdmin düzeyinde bir state'e taşıyın (`onDecided(status)`) ve kalıcı 'Seçili talep' başlığının altındaki Status'ta gösterin. Ya da closed kartında son karar mesajını koruyun. Odağı ClaimOutcome'daki 'Karar' başlığına taşıyın.

## F660 — Karar formunda feedforward eksik: tam onay tutarı, iade üst sınırı ve kararı belirten gönder etiketi yok

| Alan                | Değer                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                          |
| Durum               | Aday                                                                                                            |
| Konum               | `src/components/admin/ClaimAdmin.tsx:236`                                                                       |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:195`, `messages/tr/resolution.json:150`, `messages/tr/resolution.json:157` |
| Kullanıcılar        | admin                                                                                                           |
| Prensip             | learnability · predictability                                                                                   |
| Sezgisel madde      | H13 — Feedforward                                                                                               |
| Renk/tema           | Hayır                                                                                                           |
| Efor                | S                                                                                                               |
| Kaynak denetçiler   | area:admin                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                    |

**Kanıt:** ClaimAdmin.tsx:195 `{t(`decision.${d}`)}` 'Onayla (talep edilen tutarın tamamı)' yazıyor ama tutarı göstermiyor. 236 `{busy ? ... : t("decision.submit")}` her kararda 'Kararı kaydet' diyor; ret kararı yalnızca renkle ayrılıyor (233 `variant={decision === "REJECT" ? "danger" : "primary"}`). `detail.booking.refundableMinor` (shared.tsx:81) formda kullanılmıyor; 145 yalnızca `parsed >= claim.amountRequestedMinor` kontrol ediyor, sunucu ise CLAIM_AMOUNT_EXCEEDS_REFUNDABLE döndürebiliyor.

**Etki:** Yönetici hangi tutarın hareket edeceğini görmek için yukarı kaydırmak zorunda kalıyor. İade sınırını aşan bir tutar ancak gönderimden sonra reddediliyor. Düğme metni hangi kararın kaydedileceğini söylemiyor.

**Önerilen aksiyon:** APPROVE etiketini 'Onayla: {amount} (talep edilen tutarın tamamı)' yapın. GUEST_REFUND için hint'e 'İade edilebilir en fazla: {refundable}' ekleyin ve istemcide `parsed <= refundableMinor` kontrolü yapın. HOST_DAMAGE için depozito provizyon tutarını gösterin. Gönder metni karara göre değişsin: 'Tam iadeyi onayla ({amount})', 'Kısmi onayı kaydet ({amount})', 'Talebi reddet'.

## F661 — Devam ettirirken eski durdurma gerekçesi tekrar gönderiliyor ve denetim kaydı yanlış yazılıyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/admin/PayoutAdmin.tsx:42` |
| Diğer konumlar      | `src/components/admin/PayoutAdmin.tsx:39` |
| Kullanıcılar        | admin                                     |
| Prensip             | robustness · recoverability               |
| Sezgisel madde      | H5 — Hata önleme                          |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:admin                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** PayoutAdmin.tsx:39 `const reason = reasons[row.userId]?.trim();` ve 42 `JSON.stringify({ paused: !row.payoutsPaused, ...(reason ? { reason } : {}) })`: gerekçe yalnızca durdurmada değil devam ettirmede de gönderiliyor. `reasons` başarıdan sonra temizlenmiyor. lib/payout/host-account.ts:98-101 'payout.resumed' denetim kaydına bu `reason`ı yazıyor.

**Etki:** 'Ödemelere devam et' işlemi denetim kaydında eski durdurma gerekçesiyle görünüyor. Sonraki durdurmada da eski metin hazır dolu geliyor ve fark edilmeden yeniden gönderilebiliyor.

**Önerilen aksiyon:** Gerekçeyi yalnızca durdururken gönderin: `...(!row.payoutsPaused && reason ? { reason } : {})`. Başarıdan sonra `setReasons(({ [row.userId]: _, ...rest }) => rest)` ile o satırın gerekçesini temizleyin.

## F662 — Yükleme hatasında 'Tekrar dene' yok; ödeme ekranında hata durumunda kart başlığı da kayboluyor

| Alan                | Değer                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                             |
| Durum               | Aday                                                                                                                                                               |
| Konum               | `src/components/admin/PayoutAdmin.tsx:53`                                                                                                                          |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:97`, `src/components/admin/SupportAdmin.tsx:78`, `src/components/admin/ClaimAdmin.tsx:53`, `src/components/ui/ui.tsx:262` |
| Kullanıcılar        | admin                                                                                                                                                              |
| Prensip             | robustness · recoverability                                                                                                                                        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                              |
| Efor                | S                                                                                                                                                                  |
| Kaynak denetçiler   | area:admin                                                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                       |

**Kanıt:** PayoutAdmin.tsx:53 `if (error) return <Status error={error} />;`: Card ve h2 render edilmiyor, yeniden deneme de yok. ui.tsx:262 `reload` mevcut ama hata durumunda hiçbir ekran bunu kullanıcıya sunmuyor: AdminDashboard.tsx:97, 147, 251, 330, 405, 447; SupportAdmin.tsx:78-79; ClaimAdmin.tsx:53.

**Etki:** 503 gibi geçici bir hatadan sonra yöneticinin tek seçeneği tüm sayfayı yenilemek. Bu, panodaki diğer kartlarda yazılmış form içeriğinin (olay metni, rol formu) kaybolmasına yol açıyor.

**Önerilen aksiyon:** Status bileşenine isteğe bağlı `onRetry` prop'u ekleyin. Hata varken `<Button variant="secondary" onClick={onRetry}>{tc("retry")}</Button>` göstersin ve her yükleyicide `onRetry={reload}` geçin. PayoutAdmin'de hata durumunu da `<Card title=...>` içinde gösterin.

## F663 — Ev sahibi kimliği belirsiz (ad + soyadın baş harfi), 200 satırda arama yok; yanlış hesabı durdurma riski

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/admin/PayoutAdmin.tsx:64` |
| Kullanıcılar        | admin                                     |
| Prensip             | robustness · hata önleme                  |
| Sezgisel madde      | H5 — Hata önleme                          |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:admin                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** PayoutAdmin.tsx:64 `{row.displayName}` lib/payout/overview.ts:162'de `${u.firstName} ${u.lastName.slice(0, 1)}.` olarak üretiliyor ('Ayşe K.'). userId ya da başka bir ayırt edici bilgi gösterilmiyor. Liste en fazla 200 satır (overview.ts:143) ve arama ya da filtre yok.

**Etki:** Aynı adı ve baş harfi taşıyan iki ev sahibinden yanlış olanın ödemeleri durdurulabiliyor. Belirli bir hesabı bulmak için 200 satır göz taramasıyla aranıyor.

**Önerilen aksiyon:** Her satırda kısaltılmış kimlik gösterin: `<code>…{row.userId.slice(-6)}</code>`. Kartın üstüne 'Ad veya kullanıcı kimliğiyle ara' alanı ekleyin (`<input type="search">`, istemci tarafı filtre). Durdurulmuş, bekleyen ödemesi olan ve tümü için filtre seçenekleri ekleyin.

## F664 — Ödeme hesabı listesi, sağlayıcı ödemeye izin vermediğinde de 'Etkin' gösteriyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/admin/PayoutAdmin.tsx:65` |
| Diğer konumlar      | `src/components/admin/PayoutAdmin.tsx:14` |
| Kullanıcılar        | admin                                     |
| Prensip             | robustness · observability                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi               |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:admin                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** PayoutAdmin.tsx:65 `{row.payoutsPaused ? t("blocked.PAUSED") : t("account.active")}`: `payoutsEnabled` (satır 14) çekiliyor ama hiç kullanılmıyor. payouts.json'da `blocked.PROVIDER_DISABLED` ve `blocked.IDENTITY_UNVERIFIED` metinleri mevcut.

**Etki:** Sağlayıcının ödemeyi kapattığı ya da KYC'si reddedilmiş bir ev sahibi 'Etkin' görünüyor. Yönetici, ödemesi zaten akmayan bir hesabı sorunsuz sanıyor ve şikâyet geldiğinde yanlış teşhis koyuyor.

**Önerilen aksiyon:** Durumu şu öncelikle hesaplayın: paused ise blocked.PAUSED; değilse ve !payoutsEnabled ise blocked.PROVIDER_DISABLED; değilse ve kycStatus !== 'VERIFIED' ise blocked.IDENTITY_UNVERIFIED; aksi halde account.active. Durumun yanına ikon ve metin koyun (renge dayanmayın).

## F665 — Eylem geri bildirimi işlem yapılan satırdan uzakta, liste dışında görünüyor

| Alan                | Değer                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                     |
| Konum               | `src/components/admin/PayoutAdmin.tsx:96`                                                                                                                                                |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx:125`, `src/components/admin/AdminDashboard.tsx:330`, `src/components/admin/AdminDashboard.tsx:405`, `src/components/admin/AdminDashboard.tsx:147` |
| Kullanıcılar        | admin                                                                                                                                                                                    |
| Prensip             | robustness · observability                                                                                                                                                               |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                    |
| Efor                | S                                                                                                                                                                                        |
| Kaynak denetçiler   | area:admin                                                                                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                             |

**Kanıt:** PayoutAdmin.tsx:96 `<Status error={actionError} message={message} />` en fazla 200 hesaplık listenin ALTINDA (lib/payout/overview.ts:143 `take: 200`). SupportAdmin.tsx:125 en fazla 100 talebin altında. AdminDashboard kartlarında ise Status listenin ÜSTÜNDE (147, 330, 405), oysa fraud ve olay listeleri 100 öğeye kadar uzayabiliyor.

**Etki:** İlk satırda 'Ödemeleri durdur'a basan yönetici 'Ödemeler durduruldu.' ya da hata metnini görmüyor; mesaj ekranın çok altında kalıyor. Sonucu doğrulamak için kaydırması gerekiyor ve hata fark edilmeden kalabiliyor.

**Önerilen aksiyon:** Geri bildirimi işlem yapılan satırın içinde gösterin: li içinde `{rowFeedback[row.userId] && <Status ... />}`. Ya da sayfa genelinde ekranın üstüne sabitlenmiş tek bir aria-live bildirim alanı kullanın. Hata durumunda satıra `aria-invalid` benzeri vurgu ve ikonlu metin ekleyin.

## F666 — Toplu işlem, gruplama ve arama yok (aynı rezervasyondan yinelenen destek talepleri tek tek işleniyor)

| Alan                | Değer                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                  |
| Durum               | Aday                                                                                    |
| Konum               | `src/components/admin/SupportAdmin.tsx:86`                                              |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:37`, `src/components/admin/AdminDashboard.tsx:333` |
| Kullanıcılar        | admin                                                                                   |
| Prensip             | flexibility · multithreading / substitutivity                                           |
| Sezgisel madde      | H7 — Esneklik/verim                                                                     |
| Renk/tema           | Hayır                                                                                   |
| Efor                | L                                                                                       |
| Kaynak denetçiler   | area:admin                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                            |

**Kanıt:** SupportAdmin.tsx:86-122 her talep ayrı bir li ve ayrı düğmeler. docs/img/v5-admin-support.png'de aynı rezervasyon (cmumlybmk0o39dgmc0qi3i1fx) için 4 özdeş 'Bir insan temsilciyle görüşmek istiyorum.' talebi görünüyor. Seçim kutusu, toplu eylem ya da rezervasyon/kullanıcıya göre arama yok. Talepler (ClaimAdmin.tsx:37-51) ve fraud kartı da yalnızca durum filtresi ya da hiç filtre sunuyor.

**Etki:** Yinelenen talepler yöneticinin işini katlıyor. Belirli bir rezervasyonla ilgili tüm kayıtları bulmak için listeyi göz taramasıyla aramak gerekiyor.

**Önerilen aksiyon:** Talepleri bookingId + userId'ye göre gruplayın ('4 talep' rozeti) ve grup için tek 'Hepsini çözüldü işaretle' eylemi sunun. Satırlara seçim kutusu ve kart üstüne 'Seçilenleri …' toplu eylem çubuğu ekleyin. Rezervasyon ve kullanıcı kimliğiyle arama yapan bir `<input type="search">` ekleyin.

## F667 — Destek: 'İncelemeye al' talebi varsayılan filtreden düşürüyor ve sahiplenen kişi görünmüyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/admin/SupportAdmin.tsx:102` |
| Diğer konumlar      | `src/components/admin/SupportAdmin.tsx:30`  |
| Kullanıcılar        | admin                                       |
| Prensip             | robustness · task conformance               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü              |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:admin                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** SupportAdmin.tsx:30 varsayılan filtre `"OPEN"`. 102 `update(row.id, "IN_PROGRESS")` ve ardından 52 `reload()` çağrılınca talep listeden kayboluyor. lib/support/repo.ts updateSupportTicketStatus yalnız RESOLVED'da `resolvedById` yazıyor; IN_PROGRESS için atanan kişi tutulmuyor ve UI'da 'inceleyen' alanı yok.

**Etki:** Talebi üstlenen yönetici onu hemen gözden kaybediyor ve filtreyi değiştirmek zorunda kalıyor. Birden fazla yönetici aynı talebi aynı anda inceleyebiliyor çünkü kimin üstlendiği görünmüyor.

**Önerilen aksiyon:** Varsayılan filtreyi 'Aktif (Açık + İnceleniyor)' yapın. İncelemeye alınan satır, filtre yeniden seçilene kadar listede 'Size atandı' etiketiyle kalsın. API'de assignee alanı tutun, satırda 'İnceleyen: {ad}' gösterin ve 'Bana atananlar' filtresi ekleyin.

## F668 — Posta kutusu oturum yokken ham yetki hatası gösteriyor, giriş yolu sunmuyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Aday                                                                         |
| Konum               | `src/components/dev/MailboxClient.tsx:27`                                    |
| Diğer konumlar      | `src/components/layout/Header.tsx:29`, `src/app/api/dev/mailbox/route.ts:16` |
| Kullanıcılar        | tümü                                                                         |
| Prensip             | robustness · recoverability                                                  |
| Sezgisel madde      | H9 — Hata mesajları                                                          |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | area:misc                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** MailboxClient.tsx:27-31 oturum kontrolü yapmadan /api/dev/mailbox'ı çağırıyor. Uç requireAuth istiyor (api/dev/mailbox/route.ts:16). Hata 43-47'de olduğu gibi 'Oturum açmanız gerekiyor' metniyle, bağlantısız basılıyor. Header.tsx:73 demo modunda menü öğesini oturumsuz kullanıcıya da gösteriyor.

**Etki:** Demo ziyaretçisi menüden 'Posta kutusu'na tıklıyor ve çıkışsız bir hata görüyor. Giriş sayfasına kendisi gitmesi gerekiyor.

**Önerilen aksiyon:** MailboxClient içeriğini redirect'li RoleGate ile sarın, ya da 401 kodunu yakalayıp `t.rich('common.loginRequired')` bağlantısını gösterin. Header'da mailbox öğesine `roles: ['USER','HOST','ADMIN']` ekleyin.

## F669 — Posta kutusunda yükleniyor durumu ve yenileme yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/dev/MailboxClient.tsx:48`   |
| Kullanıcılar        | tümü                                        |
| Prensip             | robustness · observability / responsiveness |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü              |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:misc                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** MailboxClient.tsx:24 `mails` başlangıçta null. 48-50 null iken ne boş durum ne yükleniyor metni gösteriliyor; ekranda yalnızca başlık var. useEffect (27-35) yalnızca açılışta bir kez çalışıyor; yenileme düğmesi ve yoklama yok.

**Etki:** Doğrulama e-postasını bekleyen kullanıcı yavaş ağda boş bir sayfa görüyor ve 'e-posta gelmedi' sanıyor. Yeni e-posta için tüm sayfayı elle yenilemesi gerekiyor.

**Önerilen aksiyon:** `mails === null && !error` iken `<p aria-live="polite">{tc('loading')}</p>` gösterin. Başlığın yanına 'Yenile' düğmesi ekleyin; düğme useLoader'daki reload() desenini kullansın ve 'Son güncelleme: {saat}' bilgisini göstersin. İsterseniz 10 saniyede bir otomatik yenileme ekleyin.

## F670 — E-postalardaki bağlantılar tıklanamıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/dev/MailboxClient.tsx:57`        |
| Diğer konumlar      | `src/lib/notifications/auth-notifications.ts:43` |
| Kullanıcılar        | tümü                                             |
| Prensip             | flexibility · substitutivity / affordance        |
| Sezgisel madde      | H11 — Affordance                                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:misc                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** MailboxClient.tsx:56-58 `<pre …>{m.text}</pre>` metni düz basıyor. Doğrulama ve sıfırlama e-postaları tam URL içeriyor (auth-notifications.ts:43).

**Etki:** Demo kullanıcısı e-postasını doğrulamak için uzun token'lı URL'yi elle seçip kopyalamak zorunda. Mobilde pre içinde seçim zor ve hataya açık. Bu, 4. bulgudaki doğrulama şartının çözüm yolunu da zorlaştırıyor.

**Önerilen aksiyon:** Metni `/(https?:\/\/\S+)/` ile bölüp URL parçalarını `<a href className={focusRing + ' underline break-all'}>` olarak render edin; yalnızca aynı origin'e izin verin. Doğrulama ve sıfırlama e-postalarında konu altına bir 'Bağlantıyı aç' düğmesi de ekleyin.

## F1090 — Admin kuyruğu boş veya filtre sonucu boşken 'Henüz bir talebiniz yok.' yazıyor (kişisel dil, filtreden bahsetmiyor)

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Low                                                       |
| Durum               | Gözlemlendi                                               |
| Konum               | `src/components/admin/ClaimAdmin.tsx:61`                  |
| Kullanıcılar        | admin                                                     |
| Prensip             | learnability · Gerçek dünya eşleşmesi / durum görünürlüğü |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                               |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | runtime:resolution                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** RUNTIME p6-admin (gerçek veri): /admin/claims sayfasında "Talepler ¦ Duruma göre filtrele … ¦ Henüz bir talebiniz yok." yazıyor. Filtre 'Yöneticiye aktarıldı' seçilince de aynı metin çıkıyor. Bileşen misafirin list.empty anahtarını kullanıyor (resolution.json:46).

**Etki:** Admin filtre sonucunun boş olmasını kuyruğun tamamen boş olmasıyla karıştırabiliyor. 'talebiniz' ifadesi bağlama uymuyor.

**Önerilen aksiyon:** Ayrı anahtarlar ekleyin: admin.emptyAll "İncelenecek talep yok." ve admin.emptyFiltered "'{status}' durumunda talep yok." + [Filtreyi temizle] butonu.

## F1091 — Kuyruk yükleme hatasında 'Tekrar dene' yok, yükleniyor metinleri canlı bölge değil, kaldırma listesi boşken hiçbir şey yazmıyor

| Alan                | Değer                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                |
| Durum               | Gözlemlendi                                                                                                                        |
| Konum               | `src/components/admin/SupportAdmin.tsx:78`                                                                                         |
| Diğer konumlar      | `src/components/admin/PayoutAdmin.tsx`, `src/components/admin/ClaimAdmin.tsx`, `src/components/compliance/ComplianceDashboard.tsx` |
| Kullanıcılar        | admin                                                                                                                              |
| Prensip             | robustness · Kurtarılabilirlik ve gözlemlenebilirlik                                                                               |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                |
| Renk/tema           | Hayır                                                                                                                              |
| Efor                | S                                                                                                                                  |
| Kaynak denetçiler   | runtime:admin                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                       |

**Kanıt:** RUNTIME p8-errors.mjs B: /api/admin/support ve /api/admin/claims 500 stub'ında yalnızca 'Beklenmeyen hata' gösteriliyor, kartta 0 düğme var. C: yavaş /api/admin/payouts sırasında 'Yükleniyor…' bir <p> içinde, live=null ve role=null (PayoutAdmin.tsx:296, SupportAdmin.tsx:81). Sweep 108: '7565 kaldırma talepleri' listesi boşken metin yok (ComplianceDashboard.tsx:259-275).

**Etki:** Geçici hatadan kurtulmak için sayfanın tamamını yenilemek gerekiyor. Ekran okuyucu yükleme bilgisini duyurmuyor. Boş liste 'yüklenmedi mi' sorusunu doğuruyor.

**Önerilen aksiyon:** Status'a reload() çağıran bir 'Tekrar dene' düğmesi ekleyin. Yükleme metnine role='status' verin. Takedown listesine boş durum metni ekleyin ('Kayıtlı kaldırma talebi yok').

## F1092 — Posta kutusu: yükleme durumu yok, yenileme yok, yalnızca kendi e-postalarını gösterdiği söylenmiyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Gözlemlendi                               |
| Konum               | `src/components/dev/MailboxClient.tsx:48` |
| Diğer konumlar      | `src/app/api/dev/mailbox/route.ts`        |
| Kullanıcılar        | admin, misafir, ev sahibi                 |
| Prensip             | robustness · Gözlemlenebilirlik           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü            |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | runtime:admin                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** RUNTIME p6-mailbox.mjs: 2,5 sn geciktirilen yanıt sırasında main içinde yalnızca başlık ve alt başlık var, yükleniyor göstergesi yok. Sweep 114/115: admin 'Henüz e-posta yok.' görüyor, çünkü API userId ile filtreliyor (route.ts:17-19). Alt başlık ise 'SMTP yapılandırılmadığında e-postalar burada görünür.' diyor. Yenile düğmesi yok, otomatik güncelleme yok.

**Etki:** Başka bir kullanıcının akışını test eden admin e-posta gönderilmedi sanıyor. Parola sıfırlama isteğinden sonra kullanıcı sayfayı elle yenilemeyi bilmiyor.

**Önerilen aksiyon:** Yükleme sırasında 'Yükleniyor…' (role=status) gösterin. Bir 'Yenile' düğmesi ekleyin ya da 10 sn'de bir otomatik güncelleyin. Alt başlığı 'Hesabınıza gönderilen e-postalar (SMTP yokken)' yapın. 'dev/SENT' yerine 'Gönderildi' yazın.

## F1192 — Alt yönetici sayfalarında panoya geri dönüş ya da breadcrumb yok

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Low                                                                      |
| Durum               | Aday                                                                     |
| Konum               | `src/app/admin/claims/page.tsx:11`                                       |
| Diğer konumlar      | `src/app/admin/payouts/page.tsx:11`, `src/app/admin/support/page.tsx:11` |
| Kullanıcılar        | admin                                                                    |
| Prensip             | learnability · synthesizability                                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                        |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | area:admin                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                             |

**Kanıt:** claims/page.tsx:11-12 `<PageShell title={t("admin.pageTitle")} ...><RoleGate ...>`: 'Yönetim paneli'ne geri bağlantı ve kardeş sayfalara (ödeme, destek, uyum) geçiş yok. payouts/page.tsx:11 ve support/page.tsx:11'de de aynı durum var. Header'da yalnızca genel 'Yönetim' öğesi bulunuyor.

**Etki:** Yönetici kuyruklar arasında gezinmek için her seferinde ana panoya dönüp bağlantı aramak zorunda kalıyor. Bulunduğu yerin bilgi mimarisindeki konumu görünmüyor.

**Önerilen aksiyon:** PageShell'e isteğe bağlı `breadcrumb` prop'u ekleyin: `<nav aria-label="Konum"><ol><li><Link href="/admin">Yönetim paneli</Link></li><li aria-current="page">Hasar ve iade talepleri</li></ol></nav>`. Tüm admin sayfalarında aynı yönetici alt menüsünü (nav) gösterin.

## F1193 — Yönetici alt sayfa bağlantıları rol kapısının dışında ve nav olarak işaretlenmemiş

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Aday                          |
| Konum               | `src/app/admin/page.tsx:17`   |
| Diğer konumlar      | `src/app/admin/page.tsx:34`   |
| Kullanıcılar        | admin                         |
| Prensip             | learnability · predictability |
| Sezgisel madde      | H4 — Tutarlılık/standartlar   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:admin                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** page.tsx:17-33 `<p className="text-sm"><Link href="/admin/compliance">...</Link>{" · "}...</p>` 34'teki `<RoleGate roles={["ADMIN"]}>` DIŞINDA kalıyor. Oturumsuz ya da USER rolündeki ziyaretçi de 4 yönetici bağlantısını ve altında 'erişim yetkiniz yok' mesajını görüyor. Bağlantılar `<nav>` ya da liste değil, ' · ' ile ayrılmış düz metin.

**Etki:** Yetkisiz kullanıcı tıklayabileceği ama her biri yine 'yetkiniz yok' ile biten bağlantılar görüyor (çıkmaz yol). Yönetici için de bu bölüm ekran okuyucuda bir navigasyon bölgesi olarak tanınmıyor.

**Önerilen aksiyon:** Bağlantı bloğunu RoleGate içine taşıyın. `<nav aria-label={t("page.sections")}><ul className="flex flex-wrap gap-x-4">…</ul></nav>` yapısını kullanın. Mevcut sayfaya `aria-current="page"` verin.

## F1194 — LLM durum kartında bir yapılandırma değeri 'AI tarafından üretildi' rozetiyle gösteriliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/admin/AdminDashboard.tsx:104` |
| Kullanıcılar        | admin                                         |
| Prensip             | learnability · predictability                 |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                   |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:admin                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** AdminDashboard.tsx:104 `<LlmBadge mode={data.effectiveMode} />` ui.tsx:138'deki `{t("ai.generated")} · ...` ile 'AI tarafından üretildi · Demo (deterministik)' metnini basıyor (docs/img/admin.png 'Etkin mod' satırı). Bu bir AI çıktısı değil, bir sistem ayarı.

**Etki:** Rozetin anlamı bulanıklaşıyor: aynı rozet hem AI içeriğini hem ayar değerini etiketliyor. Bu da AI şeffaflık etiketinin ayırt ediciliğini azaltıyor.

**Önerilen aksiyon:** Burada rozet yerine düz metin kullanın: `t(`common.ai.modes.${mode}`)`. Moda göre ayrı bir durum etiketi (canlı/demo/yedek) gösterilebilir ama 'AI tarafından üretildi' öneki olmasın.

## F1195 — Olay metni sınırları (10–2000 karakter) belirtilmiyor; karar notunda belirtildiği için tutarsız

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/admin/AdminDashboard.tsx:237` |
| Diğer konumlar      | `messages/tr/admin.json:35`                   |
| Kullanıcılar        | admin                                         |
| Prensip             | learnability · consistency                    |
| Sezgisel madde      | H13 — Feedforward                             |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:admin                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** AdminDashboard.tsx:237-238 `minLength={10} maxLength={2000}` tanımlı ama tr/admin.json:35 textHint sınırları söylemiyor. Buna karşılık tr/resolution.json:156 `noteHint`: '3–4000 karakter; taraflara gösterilir.' Karakter sayacı da yok.

**Etki:** Kısa bir metin girildiğinde tarayıcının kendi dilindeki genel doğrulama balonu çıkıyor ve yönetici sınırı ancak hata alınca öğreniyor.

**Önerilen aksiyon:** textHint'e '(10–2000 karakter)' ekleyin. Textarea altına `{text.length}/2000` sayacı koyun; aria-live yalnızca 1900 üstünde 'polite' olsun.

## F1196 — Fraud satırında geçersiz HTML iç içeliği: <span> içinde <ul>

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Low                                               |
| Durum               | Aday                                              |
| Konum               | `src/components/admin/AdminDashboard.tsx:339`     |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:425`     |
| Kullanıcılar        | admin                                             |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 1.3.1                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:admin                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** AdminDashboard.tsx:339-355 `<span>{t("fraud.booking", ...)} ... <ul className="mt-1 list-disc pl-5 ..." aria-label={t("fraud.reasonsLabel")}>...</ul></span>`: <ul> akış içeriği, <span> ise yalnızca phrasing içerik kabul ediyor.

**Etki:** Bazı ekran okuyucu ve tarayıcı birleşimlerinde liste ilişkisi (öğe sayısı, 'liste, 3 öğe') kaybolabiliyor ve satır içeriği tek bir satır olarak okunabiliyor.

**Önerilen aksiyon:** Dıştaki `<span>` öğesini `<div className="min-w-0">` yapın. Moderasyon satırındaki 425 `<span className="mt-2 flex gap-2">` düğme grubunu da `<div>` yapın.

## F1197 — Sayılar ve yüzdeler yerel biçimde değil (TR'de ondalık nokta, binlik ayırıcı yok)

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                       |
| Durum               | Aday                                                                                      |
| Konum               | `src/components/admin/AdminDashboard.tsx:443`                                             |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:469`, `src/components/admin/SupportAdmin.tsx:93` |
| Kullanıcılar        | admin                                                                                     |
| Prensip             | learnability · familiarity                                                                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                               |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | area:admin                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                              |

**Kanıt:** AdminDashboard.tsx:443 `t("percent", { value: (v * 100).toFixed(1) })` TR'de '%12.3' üretiyor ('%12,3' olmalı). 469-471 `{v.exposures}` gibi değerler binlik ayırıcı olmadan basılıyor. SupportAdmin.tsx:93 `row.confidence.toFixed(2)` 'Güven: 0.90' üretiyor (docs/img/v5-admin-support.png).

**Etki:** TR okuyucuda '12.345' bin mi ondalık mı belirsizliği oluşuyor. Deney oranları ve güven değeri yanlış okunabiliyor.

**Önerilen aksiyon:** `f.number(v.rate, { style: "percent", maximumFractionDigits: 1 })` ve sayımlar için `f.number(v.exposures)` kullanın (lib/i18n/format). Güven değerini yüzde olarak gösterin: `f.number(row.confidence, { style: "percent" })` ('%90').

## F1198 — Deney tablolarında caption ve scope yok; tablo adı tablonun dışında bir <p> içinde

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Low                                               |
| Durum               | Aday                                              |
| Konum               | `src/components/admin/AdminDashboard.tsx:454`     |
| Kullanıcılar        | admin                                             |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 1.3.1                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:admin                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** AdminDashboard.tsx:451-454 `<p className="mb-2 text-sm font-medium">{exp.flagKey} · ...</p><table className="w-full ...">`: tabloda `<caption>` yok. 457-462 `<th>` öğelerinde `scope="col"` yok ve 468 ilk sütun (kol adı) `<td>`.

**Etki:** Birden fazla deney olduğunda ekran okuyucunun tablo listesinde adsız ve özdeş tablolar görünüyor. Hücre gezinirken satır başlığı (varyant) okunmuyor.

**Önerilen aksiyon:** `<p>` yerine `<caption className="mb-2 text-left text-sm font-medium">{exp.flagKey} · ...</caption>` kullanın. Başlık hücrelerine `scope="col"` ekleyin ve ilk sütunu `<th scope="row">{v.variant}</th>` yapın.

## F1199 — Seçili talep ayrıntısındaki kart başlıkları h2; 'Seçili talep' h2'sinin altında h3 olmalı

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Low                                               |
| Durum               | Aday                                              |
| Konum               | `src/components/admin/ClaimAdmin.tsx:75`          |
| Diğer konumlar      | `src/components/ui/ui.tsx:107`                    |
| Kullanıcılar        | admin                                             |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 1.3.1                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:admin                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** ClaimAdmin.tsx:75 `<h2 id="claim-admin-selected">{t("admin.selected")}</h2>`: altında render edilen ClaimDetail kartları da ui.tsx:107 `<h2 ...>{title}</h2>` kullanıyor ('Misafir iade talebi', 'Karar ver', 'Hasar depozitosu'). Sonuçta hiyerarşi düzleşiyor.

**Etki:** Başlıklarla gezinen ekran okuyucu kullanıcısı 'Karar ver' bölümünün seçili talebe ait olduğunu yapıdan çıkaramıyor.

**Önerilen aksiyon:** Card bileşenine `headingLevel?: 2 | 3` prop'u ekleyin (`const H = headingLevel === 3 ? "h3" : "h2"`) ve ClaimAdmin içinde ClaimDetail ile DecisionForm kartlarına 3 geçin.

## F1200 — Durdurma tarihi ve gerekçesi etiketsiz ' · ' parçaları olarak gösteriliyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Aday                                      |
| Konum               | `src/components/admin/PayoutAdmin.tsx:69` |
| Kullanıcılar        | admin                                     |
| Prensip             | learnability · synthesizability           |
| Sezgisel madde      | H6 — Tanıma > hatırlama                   |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:admin                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** PayoutAdmin.tsx:69-70 `{row.pausedAt ? ` · ${f.dateTime(row.pausedAt)}`: ""}{row.pausedReason ?` · ${row.pausedReason}` : ""}`: tarih ve serbest metin gerekçe etiket olmadan, bekleyen ödeme sayısıyla aynı satıra ekleniyor.

**Etki:** Yönetici tarihin durdurulma zamanı mı yoksa son ödeme mi olduğunu ve metnin gerekçe mi not mu olduğunu çıkarmak zorunda kalıyor; bilgiyi hatırlamaya dayalı yorumluyor.

**Önerilen aksiyon:** payouts.admin altına `pausedAt: "Durdurulma: {date}"` ve `pausedReason: "Gerekçe: {reason}"` anahtarlarını ekleyin. Değerleri `<dl>` ya da etiketli satırlarla gösterin.

## F1201 — Posta kutusunda ham teknik değerler ve jargon var; 50 kayıt sınırı belirtilmiyor

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Low                                                                 |
| Durum               | Aday                                                                |
| Konum               | `src/components/dev/MailboxClient.tsx:53`                           |
| Diğer konumlar      | `messages/tr/mailbox.json:3`, `src/app/api/dev/mailbox/route.ts:20` |
| Kullanıcılar        | tümü                                                                |
| Prensip             | learnability · familiarity                                          |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                         |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | area:misc                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                        |

**Kanıt:** MailboxClient.tsx:53 `{m.transport}/{m.status}` ekranda 'console/SENT' gibi ham değerler basıyor. tr/mailbox.json alt başlığı 'SMTP yapılandırılmadığında…'. api/dev/mailbox/route.ts:20 `take: 50` sınırı UI'da belirtilmiyor.

**Etki:** Demo kullanıcısı 'SMTP' ve 'console/SENT' ifadelerini anlamıyor. 50'den eski e-postaların neden görünmediğini bilmiyor.

**Önerilen aksiyon:** transport ve status için i18n etiketleri kullanın (ör. 'Demo kutusuna teslim edildi'). Alt başlığı 'Demo ortamında gönderilen e-postalarınız burada görünür' yapın. Liste 50 kayda ulaştıysa 'Son 50 e-posta gösteriliyor' notu ekleyin.
