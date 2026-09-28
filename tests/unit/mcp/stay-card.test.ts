import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, defaultDeps, type McpDeps } from "@/lib/mcp/server";
import {
  AI_LABEL,
  STAY_CARD_CSP,
  STAY_CARD_MIME,
  STAY_CARD_URI,
  escapeHtml,
  renderStayCardHtml,
} from "@/lib/mcp/stay-card";
import type { SearchResponse } from "@/lib/search";

/** v5 P1-9: MCP Apps `ui://booking/stay-card` kaynağı — CSP, AI etiketi, toplam fiyat, XSS. */

const XSS = `<img src=x onerror="alert(1)">'&"</script><script>alert(2)</script>`;

function searchWith(title: string): McpDeps["search"] {
  return async (): Promise<SearchResponse> => ({
    results: [
      {
        id: "p1",
        title,
        description: "",
        propertyType: "APARTMENT",
        basePriceMinor: 150_000,
        currency: "TRY",
        ratingAvg: 4.7,
        ratingCount: 12,
        location: { city: "<b>İstanbul</b>", country: "TR" },
        amenities: [],
        availableRooms: 2,
        quote: { roomId: "r1", ratePlanId: "rp1", total: 151_500, currency: "TRY", nights: 1 },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    cached: false,
  });
}

async function connect(deps: McpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP Apps stay-card (v5 P1-9)", () => {
  it("escapeHtml beş özel karakteri kaçışlar", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  it("XSS: ilan adı ve şehir kaçışlı; kullanıcı girdisinden etiket/olay özniteliği çıkmaz", () => {
    const html = renderStayCardHtml([
      {
        title: XSS,
        city: "<b>İstanbul</b>",
        rating: 4.5,
        basePriceMinor: 100_000,
        currency: "TRY",
        quote: { total: 123_456, currency: "TRY" },
      },
    ]);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;&quot;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="alert');
    expect(html).not.toContain("<b>İstanbul");
    expect(html).not.toContain("alert(2)</script>");
    // Tek betik ana makine köprüsüdür; kullanıcı verisi betiğe gömülmez.
    expect(html.match(/<script>/g)).toHaveLength(1);
    // Köprü HTML ayrıştırmaz.
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("textContent");
  });

  it("CSP meta (ağ/dış kaynak kapalı), AI etiketi ve vergi dahil toplam fiyat", () => {
    const html = renderStayCardHtml([
      {
        title: "Kadıköy Loft",
        city: "İstanbul",
        rating: 4.7,
        basePriceMinor: 150_000,
        currency: "TRY",
        quote: { total: 151_500, currency: "TRY" },
      },
      {
        title: "Tarihsiz",
        city: null,
        rating: null,
        basePriceMinor: 90_000,
        currency: "TRY",
        quote: null,
      },
    ]);
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="${STAY_CARD_CSP}"`);
    expect(STAY_CARD_CSP).toMatch(/default-src 'none'/);
    expect(STAY_CARD_CSP).toMatch(/connect-src 'none'/);
    expect(html).toContain('data-ai-label="true"');
    expect(html).toContain(escapeHtml(AI_LABEL));
    expect(html).toContain('data-total-minor="151500"');
    expect(html).toMatch(/1\.515,00.*toplam \(vergi dahil\)/);
    expect(html).toContain("toplam için tarih seçin");
    // Harici kaynak yok.
    expect(html).not.toMatch(/(src|href)=["']?https?:/);
  });

  it("kaynak listelenir/okunur; search_stays kaynağa bağlı ve kaçışlı gömülü kart taşır", async () => {
    const client = await connect({ ...defaultDeps, search: searchWith(XSS) });
    const { resources } = await client.listResources();
    const listed = resources.find((r) => r.uri === STAY_CARD_URI);
    expect(listed).toMatchObject({ mimeType: STAY_CARD_MIME });
    expect(STAY_CARD_URI).toBe("ui://booking/stay-card");
    expect(STAY_CARD_MIME).toBe("text/html;profile=mcp-app");

    const read = await client.readResource({ uri: STAY_CARD_URI });
    const [content] = read.contents as Array<{ mimeType: string; text: string; _meta?: unknown }>;
    expect(content.mimeType).toBe(STAY_CARD_MIME);
    expect(content.text).toContain("Content-Security-Policy");
    expect(content._meta).toMatchObject({ ui: { csp: { connectDomains: [] } } });

    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "search_stays")!;
    expect(search._meta).toMatchObject({ ui: { resourceUri: STAY_CARD_URI } });

    const res = await client.callTool({ name: "search_stays", arguments: {} });
    const embedded = (
      res.content as Array<{ type: string; resource?: { uri: string; text: string } }>
    ).find((c) => c.type === "resource");
    expect(embedded?.resource?.uri).toBe(STAY_CARD_URI);
    expect(embedded?.resource?.text).toContain("&lt;img src=x");
    expect(embedded?.resource?.text).not.toContain("<img");
    expect(embedded?.resource?.text).toContain("toplam (vergi dahil)");
    // Yapılandırılmış çıktı ham veriyi taşır (ana makine köprüsü textContent ile çizer).
    expect(res.structuredContent).toMatchObject({ total: 1, results: [{ title: XSS }] });
  });
});
