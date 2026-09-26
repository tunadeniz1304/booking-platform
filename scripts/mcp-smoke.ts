/**
 * MCP duman testi: `npm run mcp:smoke` — veritabanı gerektirmez.
 *
 * 1. stdio: sunucuyu ayrı süreçte başlatır, araç listesini doğrular ve `create_hold`'un
 *    token'sız reddedildiğini kontrol eder.
 * 2. streamable HTTP (P1-11): `handleMcpHttp`'yi süreç içi geçici bir HTTP sunucusuna
 *    bağlar; token'sız/geçersiz token ile `create_hold` → 401, geçici imzalı token ile
 *    araç listesi. Kimlik doğrulama yalnızca imza kontrolüdür (Redis'e gidilmez).
 * 3. AP2 mandate (P1-11, §8 madde 6): HTTP üzerinden `checkout_stay` — GERÇEK mandate
 *    imzalama/doğrulaması (`signMandate` + `authorizeMandate`, süreç içi nonce deposu) ile;
 *    teklif/rezervasyon/ödeme sabit bir sahte checkout'tur (DB gerekmez). Mandate'li ödeme
 *    başarılı; mandate'siz / süresi dolmuş / tutarı aşan / tekrar kullanılan mandate ve
 *    doğrulanmamış e-posta reddedilir. Gerçek DB'li akış: tests/integration/p1-11-*.
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpDeps } from "@/lib/mcp/server";
import type { CheckoutSessionView } from "@/lib/agentic/checkout";

const EXPECTED_TOOLS = [
  "cancel_booking",
  "checkout_stay",
  "create_hold",
  "get_price_insight",
  "get_quote",
  "list_my_bookings",
  "search_stays",
];

const HOLD_ARGS = {
  propertyId: "p",
  roomId: "r",
  checkIn: "2026-10-01",
  checkOut: "2026-10-02",
  guests: 1,
};

function sameTools(names: string[]): boolean {
  return JSON.stringify([...names].sort()) === JSON.stringify(EXPECTED_TOOLS);
}

async function smokeStdio(): Promise<boolean> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "--conditions=react-server", "services/mcp/main.ts"],
    env: {
      ...(process.env as Record<string, string>),
      LOG_TO_STDERR: "true",
      MCP_ACCESS_TOKEN: "",
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  process.stdout.write(`[stdio] tools: ${tools.map((t) => t.name).join(", ")}\n`);
  const res = await client.callTool({ name: "create_hold", arguments: HOLD_ARGS });
  const [first] = res.content as { text: string }[];
  process.stdout.write(
    `[stdio] create_hold (token yok): isError=${String(res.isError)} ${first.text}\n`
  );
  await client.close();
  return sameTools(tools.map((t) => t.name)) && res.isError === true;
}

/** Node http isteğini Web `Request`'e çevirip `handleMcpHttp` yanıtını geri yazar. */
function adapt(handler: (req: Request) => Promise<Response>): http.RequestListener {
  return (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      handler(request)
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
    });
  };
}

async function smokeHttp(): Promise<boolean> {
  // Geçici imza anahtarı: yalnızca bu süreçte; gerçek ortam değişkeni varsa ona dokunulmaz.
  process.env.JWT_SECRET ||= randomBytes(32).toString("hex");
  const { handleMcpHttp } = await import("@/lib/mcp/http");
  const { defaultDeps } = await import("@/lib/mcp/server");
  const { signAccessToken, verifyAccessToken } = await import("@/lib/auth/tokens");
  const deps = { ...defaultDeps, authenticate: (t: string) => verifyAccessToken(t) };

  const server = http.createServer(adapt((req) => handleMcpHttp(req, deps)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
  try {
    const call = (authorization?: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "create_hold", arguments: HOLD_ARGS },
        }),
      });
    const anon = await call();
    const bad = await call("Bearer bozuk.token.degeri");
    process.stdout.write(`[http] create_hold (token yok): HTTP ${anon.status}\n`);
    process.stdout.write(`[http] create_hold (geçersiz token): HTTP ${bad.status}\n`);

    const { token } = await signAccessToken("mcp-smoke", "USER", 60);
    const client = new Client({ name: "mcp-smoke-http", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      })
    );
    const { tools } = await client.listTools();
    process.stdout.write(`[http] tools: ${tools.map((t) => t.name).join(", ")}\n`);
    await client.close();
    return anon.status === 401 && bad.status === 401 && sameTools(tools.map((t) => t.name));
  } finally {
    server.close();
  }
}

/** Sahte checkout: sabit teklif; mandate kapısı gerçek (imza, süre, kapsam, tutar, nonce). */
const SMOKE_TOTAL = 150_000;
const SMOKE_PROPERTY = "p-smoke";

async function smokeMandate(): Promise<boolean> {
  process.env.JWT_SECRET ||= randomBytes(32).toString("hex");
  const { handleMcpHttp } = await import("@/lib/mcp/http");
  const { defaultDeps } = await import("@/lib/mcp/server");
  const { signAccessToken, verifyAccessToken } = await import("@/lib/auth/tokens");
  const { authorizeMandate, memoryNonceStore, signMandate } = await import("@/lib/agentic/mandate");
  const { HttpError } = await import("@/lib/http/errors");
  const nonces = memoryNonceStore();
  const deps: McpDeps = {
    ...defaultDeps,
    authenticate: (t: string) => verifyAccessToken(t),
    isEmailVerified: async (userId: string) => userId !== "mcp-smoke-unverified",
    hold: async () => {
      throw new HttpError(503, "SMOKE_NO_DB", "smoke: rezervasyon servisi yok");
    },
    checkout: async (input) => {
      const sessionId = `cs-${input.idempotencyKey}`;
      await authorizeMandate(
        input.mandate,
        {
          userId: input.userId,
          checkoutSessionId: sessionId,
          amountMinor: SMOKE_TOTAL,
          currency: "TRY",
          propertyId: SMOKE_PROPERTY,
        },
        { nonces, record: async () => undefined }
      );
      return {
        id: sessionId,
        status: "completed",
        currency: "TRY",
        order: { id: `b-${input.idempotencyKey}` },
      } as unknown as CheckoutSessionView;
    },
  };

  const server = http.createServer(adapt((req) => handleMcpHttp(req, deps)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`);
  const connect = async (userId: string) => {
    const { token } = await signAccessToken(userId, "USER", 60);
    const client = new Client({ name: "mcp-smoke-mandate", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      })
    );
    return client;
  };
  const code = (res: Awaited<ReturnType<Client["callTool"]>>) => {
    const [first] = res.content as { text: string }[];
    const body = JSON.parse(first.text) as { code?: string; status?: string };
    return res.isError ? (body.code ?? "ERROR") : `OK:${body.status}`;
  };
  const args = (key: string, mandate?: string) => ({
    roomId: "r-smoke",
    checkIn: "2026-10-01",
    checkOut: "2026-10-02",
    guests: 1,
    spt: "spt_mock_ok",
    idempotencyKey: key,
    ...(mandate ? { mandate } : {}),
  });
  try {
    const user = "mcp-smoke";
    const client = await connect(user);
    const call = async (label: string, key: string, mandate?: string) => {
      const res = await client.callTool({ name: "checkout_stay", arguments: args(key, mandate) });
      const out = code(res);
      process.stdout.write(`[mandate] ${label}: ${out}\n`);
      return out;
    };
    const valid = await signMandate(user, {
      maxAmountMinor: SMOKE_TOTAL,
      currency: "TRY",
      propertyIds: [SMOKE_PROPERTY],
      expiresInMinutes: 10,
    });
    const expired = await signMandate(
      user,
      { maxAmountMinor: SMOKE_TOTAL, currency: "TRY", expiresInMinutes: 1 },
      new Date(Date.now() - 5 * 60_000)
    );
    const tooSmall = await signMandate(user, { maxAmountMinor: SMOKE_TOTAL - 1, currency: "TRY" });

    const results = {
      ok: await call("mandate'li rezervasyon", "k-ok", valid.mandate),
      none: await call("mandate'siz", "k-none"),
      expired: await call("süresi dolmuş mandate", "k-expired", expired.mandate),
      exceeded: await call("tutarı aşan", "k-exceeded", tooSmall.mandate),
      replay: await call("aynı mandate başka checkout", "k-replay", valid.mandate),
    };
    await client.close();

    const unverified = await connect("mcp-smoke-unverified");
    const hold = code(await unverified.callTool({ name: "create_hold", arguments: HOLD_ARGS }));
    const pay = code(
      await unverified.callTool({ name: "checkout_stay", arguments: args("k-u", valid.mandate) })
    );
    process.stdout.write(
      `[mandate] doğrulanmamış e-posta: create_hold=${hold} checkout_stay=${pay}\n`
    );
    await unverified.close();

    return (
      results.ok === "OK:completed" &&
      results.none === "MANDATE_REQUIRED" &&
      results.expired === "MANDATE_EXPIRED" &&
      results.exceeded === "MANDATE_AMOUNT_EXCEEDED" &&
      results.replay === "MANDATE_REPLAYED" &&
      hold === "EMAIL_NOT_VERIFIED" &&
      pay === "EMAIL_NOT_VERIFIED"
    );
  } finally {
    server.close();
  }
}

async function main(): Promise<void> {
  const stdioOk = await smokeStdio();
  const httpOk = await smokeHttp();
  const mandateOk = await smokeMandate();
  if (!stdioOk || !httpOk || !mandateOk) {
    process.stderr.write(
      `MCP smoke FAILED (stdio=${stdioOk}, http=${httpOk}, mandate=${mandateOk})\n`
    );
    process.exit(1);
  }
  process.stdout.write("MCP smoke OK\n");
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`MCP smoke FAILED: ${String(error)}\n`);
  process.exit(1);
});
