# UBL-TR 1.2 e-Arşiv — doğrulama notu (P1-13c)

Üretici: `src/lib/invoice/ubl-tr.ts` (`buildEArchiveInvoiceXml`), entegratör arayüzü:
`src/lib/invoice/e-invoice-integrator.ts` (`EInvoiceIntegrator`, `MockEInvoiceIntegrator`).

## Neden XSD dosyası repoda yok?

GİB'in yayımladığı UBL-TR paketi (OASIS UBL 2.1 XSD'leri + GİB Schematron kuralları +
kod listeleri) ebelge.gib.gov.tr üzerinden dağıtılır; paketin yeniden dağıtım lisansı açıkça
belirtilmediği için bu depoya **kopyalanmadı**. OASIS UBL 2.1 XSD'leri OASIS IPR politikasıyla
serbestçe kullanılabilir olsa da GİB Schematron'u olmadan "UBL-TR geçerliliği" kanıtlanmış
olmaz; yarım doğrulama yanıltıcı olacağından tercih edilmedi.

## Bunun yerine

`tests/unit/invoice/ubl-tr.test.ts`:

- **Yapısal snapshot** — deterministik XML'in tamamı (`__snapshots__/ubl-tr.test.ts.snap`);
  her değişiklik bilinçli snapshot güncellemesi gerektirir.
- UBL 2.1 eleman **sırası** (UBLExtensions → UBLVersionID → CustomizationID `TR1.2` →
  ProfileID `EARSIVFATURA` → … → TaxTotal → LegalMonetaryTotal → InvoiceLine).
- Etiket dengesi (iyi biçimlilik), XML-escape, VKN/TCKN şeması, 16 karakterli fatura no
  (yıl = düzenleme yılı), tamsayı minor-unit toplamlar (KDV `0015`, konaklama vergisi `0059`).

## Yerelde tam doğrulama (isteğe bağlı)

GİB paketini indirip (repoya eklemeden) örneğin `xmllint --schema UBL-Invoice-2.1.xsd` ve
GİB Schematron'u (`UBL-TR_Main_Schematron.xml`, XSLT 2 işlemcisiyle) snapshot XML'ine karşı
çalıştırın. İmza (`ext:ExtensionContent`, XAdES) ve GİB raporlaması özel entegratörün
sorumluluğundadır; üretici imzasız belge üretir.

## Entegratöre göre değişebilecek alanlar

`AdditionalDocumentReference` içindeki gönderim şekli (`GONDERIM_SEKLI`) ve internet satışı
bilgileri (`INTERNET_SATIS_*`) entegratörlerin kabul ettiği `DocumentType` adlarına göre
eşlenmelidir; gerçek adaptör yazılırken sağlayıcının kılavuzuyla karşılaştırın.
