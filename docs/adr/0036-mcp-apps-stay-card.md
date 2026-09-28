# ADR 0036 — MCP Apps arayüz kaynağı: `ui://booking/stay-card`

- Durum: Kabul edildi (v5 P1-9)
- Tarih: 2026-09-28
- İlgili: ADR 0015 (ajan kanalı), ADR 0005 (LLM sözleşmesi)

## Bağlam

MCP Apps eklentisi (26 Ocak 2026) araçların `_meta.ui.resourceUri` ile bir arayüz kaynağına
(`ui://…`, `text/html;profile=mcp-app`) bağlanmasını ve ana makinenin bu HTML'i sandbox'lı
iframe'de çizmesini tanımlar. v3'teki `ui://stay-card` şablonu yalnızca istemci tarafı betikle
çiziyordu; ne CSP'si ne AI etiketi vardı, sunucuda çizilmiş bir sürümü de yoktu.

`@modelcontextprotocol/sdk` 1.30.1 MCP Apps yardımcıları içermiyor (ayrı `ext-apps` paketi);
`registerResource` ile `mimeType` ve `_meta` serbestçe verilebildiği için yeni bağımlılık
eklenmedi, kaynak elle kaydedildi.

## Karar

- Kaynak URI'si ad alanlı: `ui://booking/stay-card`; `search_stays` `_meta.ui.resourceUri` (ve
  Apps SDK `openai/outputTemplate`) ile ona bağlıdır. Kaynak meta verisi
  `_meta.ui.csp = { connectDomains: [], resourceDomains: [] }` — kart hiçbir dış alana erişmez.
- HTML `src/lib/mcp/stay-card.ts`'te üretilir: CSP meta etiketi (`default-src 'none'`,
  `connect-src 'none'`, yalnız satır içi stil + köprü betiği), "AI" etiketi, deterministik teklif
  motorundan gelen vergi dahil toplam fiyat (`formatMoney`, minor-unit). İlan adı ev sahibi
  girdisidir: sunucuda `escapeHtml` ile kaçışlanır; ana makine köprüsü veriyi yalnız
  `textContent` ile yazar (`innerHTML` yok).
- `resources/read` boş durum kabuğunu döner; `search_stays` sonucu `structuredContent`'e ek
  olarak sunucuda çizilmiş kartı gömülü kaynak (`type: "resource"`) olarak taşır — MCP Apps
  köprüsü olmayan istemciler de kartı gösterebilir.

## Sonuçlar

- `npm run mcp:smoke` kaynağı stdio'da listeler/okur ve HTTP'de gömülü kartın kaçışlı olduğunu
  denetler; `tests/unit/mcp/stay-card.test.ts` XSS, CSP, AI etiketi ve toplam fiyatı sınar.
- Eski `ui://stay-card` URI'si kaldırıldı (kırıcı olmayan: istemciler URI'yi araç
  `_meta`'sından okur).
- SDK MCP Apps yardımcılarını içerdiğinde (`ext-apps`) elle kayıt onlarla değiştirilebilir.
