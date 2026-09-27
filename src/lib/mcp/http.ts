import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, defaultDeps, type McpDeps } from "./server";
import { runWithLlmSubject, userLlmSubject } from "@/lib/llm/budget";

/**
 * MCP streamable HTTP uç noktası (P1-11): `POST /api/mcp`.
 *
 * Durumsuz (stateless) mod: her istek kendi sunucu + transport örneğini alır, oturum
 * kimliği tutulmaz; yanıt tek JSON (SSE akışı yok). Böylece yatay ölçekte yapışkan
 * oturum gerekmez.
 *
 * Kimlik: `Authorization: Bearer <access token>` ZORUNLU. Token yoksa/geçersizse istek
 * JSON-RPC'ye hiç ulaşmadan 401 + `WWW-Authenticate` döner. Doğrulanan token SDK'ya
 * `authInfo` olarak geçer; `MCP_ACCESS_TOKEN` ortam yedeği HTTP'de KAPALIDIR.
 * Rate-limit `src/proxy.ts` içinde `agentic` kategorisiyle (kullanıcı başına) uygulanır.
 * Araçların LLM/embedding çağrıları (ör. `search_stays` sorgu gömmesi) token kullanıcısının
 * bütçesine (`u:<id>`) faturalanır (v2-P0-4).
 */

function unauthorized(message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="booking-mcp"', "Cache-Control": "no-store" },
    }
  );
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function handleMcpHttp(req: Request, deps: McpDeps = defaultDeps): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Yalnızca POST desteklenir" }, id: null },
      { status: 405, headers: { Allow: "POST" } }
    );
  }
  const token = bearerToken(req);
  if (!token) return unauthorized("Bearer token gerekli");
  const claims = await deps.authenticate(token);
  if (!claims) return unauthorized("Geçersiz veya süresi dolmuş token");

  const server = createMcpServer(deps, { envTokenFallback: false });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await runWithLlmSubject(userLlmSubject(claims.userId), () =>
      transport.handleRequest(req, {
        authInfo: { token, clientId: claims.userId, scopes: [] },
      })
    );
  } finally {
    await server.close();
  }
}
