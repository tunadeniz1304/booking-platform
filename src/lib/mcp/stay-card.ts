import { formatMoney, money } from "@/lib/money/money";

/**
 * MCP Apps arayüz kaynağı `ui://booking/stay-card` (v5 P1-9, ADR 0036).
 *
 * `search_stays` sonuçlarını konaklama kartı olarak gösterir. MCP Apps eklentisinde
 * (2026-01-26) arayüz kaynağı `text/html;profile=mcp-app` tipinde HTML'dir; ana makine onu
 * sandbox'lı iframe'de çizer. Kullanılan SDK (`@modelcontextprotocol/sdk` 1.30) MCP Apps
 * yardımcıları içermediğinden kaynak elle kaydedilir (`registerResource` + `_meta.ui`).
 *
 * Güvenlik:
 *  - HTML sunucuda üretilir; ilan adı/şehir gibi kullanıcı kaynaklı her metin `escapeHtml` ile
 *    kaçışlanır (ilan adı ev sahibi girdisidir → XSS vektörü).
 *  - CSP meta etiketi ağa çıkışı ve dış kaynağı kapatır (`default-src 'none'`); yalnız satır içi
 *    stil ve ana makine köprüsü için küçük satır içi betik çalışır. Köprü, ana makinenin
 *    ilettiği araç sonucunu yalnız `textContent` ile yazar (HTML ayrıştırmaz).
 *  - Fiyat deterministik teklif motorundandır (vergi dahil toplam, minor-unit); kart yalnız
 *    biçimlendirir. "AI" etiketi, sonucun bir yapay zekâ asistanı aracılığıyla gösterildiğini
 *    bildirir (fiyat/uygunluk kararı modelde değildir).
 */

export const STAY_CARD_URI = "ui://booking/stay-card";
export const STAY_CARD_MIME = "text/html;profile=mcp-app";

/** Ağ ve dış kaynak kapalı; yalnız satır içi stil ve köprü betiği. */
export const STAY_CARD_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; " +
  "connect-src 'none'; base-uri 'none'; form-action 'none'";

/** MCP Apps kaynak meta verisi: ana makineye izinli alan yok (tamamen yerel). */
export const STAY_CARD_UI_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
} as const;

export const AI_LABEL = "Yapay zekâ asistanı aracılığıyla gösterilir · fiyatlar platformdan";

export interface StayCardItem {
  title: string;
  city: string | null;
  rating: number | null;
  basePriceMinor: number;
  currency: string;
  quote: { total: number; currency: string } | null;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML metin/öznitelik bağlamı için kaçış. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function priceLine(item: StayCardItem): string {
  if (item.quote) {
    const total = formatMoney(money(item.quote.total, item.quote.currency));
    return `<div class="p" data-total-minor="${item.quote.total}">${escapeHtml(total)} toplam (vergi dahil)</div>`;
  }
  const base = formatMoney(money(item.basePriceMinor, item.currency));
  return `<div class="p m">Gecelik ${escapeHtml(base)}'den · toplam için tarih seçin</div>`;
}

function card(item: StayCardItem): string {
  const rating = item.rating != null && item.rating > 0 ? `${item.rating.toFixed(1)}★` : "yeni";
  const meta = [item.city ?? "", rating].filter(Boolean).join(" · ");
  return (
    `<article class="card"><div class="t">${escapeHtml(item.title)}</div>` +
    `<div class="m">${escapeHtml(meta)}</div>${priceLine(item)}</article>`
  );
}

/**
 * Ana makine köprüsü: MCP Apps `ui/notifications/tool-result` (ya da Apps SDK
 * `window.openai.toolOutput`) ile gelen sonucu yalnız `textContent` ile çizer.
 */
const BRIDGE = `(function(){
function fmt(minor,cur){try{return new Intl.NumberFormat("tr-TR",{style:"currency",currency:cur}).format(minor/100)}catch(e){return (minor/100)+" "+cur}}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;e.textContent=text;return e}
function render(data){var list=(data&&data.results)||[];if(!list.length)return;var root=document.getElementById("root");root.textContent="";
list.forEach(function(r){var c=el("article","card","");c.appendChild(el("div","t",String(r.title||"")));
c.appendChild(el("div","m",[r.city||"",r.rating?Number(r.rating).toFixed(1)+"\\u2605":"yeni"].filter(Boolean).join(" \\u00b7 ")));
c.appendChild(el("div","p",r.quote?fmt(r.quote.total,r.quote.currency)+" toplam (vergi dahil)":"Toplam için tarih seçin"));root.appendChild(c)})}
if(window.openai&&window.openai.toolOutput)render(window.openai.toolOutput);
window.addEventListener("message",function(ev){var d=ev.data;if(d&&d.method==="ui/notifications/tool-result"&&d.params)render(d.params.structuredContent)});
})();`;

/**
 * Kart HTML'i. `items` yoksa boş durum kabuğu (kaynak okuması); varsa sunucuda çizilmiş kartlar
 * (araç sonucuna gömülen kaynak). Her iki hâlde de CSP + AI etiketi vardır.
 */
export function renderStayCardHtml(items: StayCardItem[] | null = null): string {
  const body = items && items.length ? items.map(card).join("") : `<p class="m">Sonuç yok</p>`;
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${STAY_CARD_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Konaklama kartı</title>
<style>
body{font:14px system-ui,sans-serif;margin:0;padding:8px;color:#111;background:#fff}
.card{border:1px solid #ddd;border-radius:12px;padding:12px;margin-bottom:8px}
.t{font-weight:600}.m{color:#555}.p{font-weight:600;margin-top:4px}
.ai{display:inline-block;font-size:12px;border:1px solid #bbb;border-radius:999px;padding:2px 8px;margin-bottom:8px;color:#444}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.card{border-color:#333}.m,.ai{color:#aaa}}
</style></head><body>
<div class="ai" data-ai-label="true">AI · ${escapeHtml(AI_LABEL)}</div>
<div id="root">${body}</div>
<script>${BRIDGE}</script>
</body></html>`;
}
