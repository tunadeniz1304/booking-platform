import type { NextRequest } from "next/server";
import { handleMcpHttp } from "@/lib/mcp/http";
import { observed } from "@/lib/http/observed";

/** MCP streamable HTTP (P1-11). Ayrıntı: `src/lib/mcp/http.ts`. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = observed("mcp", async function mcpHandler(req: NextRequest) {
  return handleMcpHttp(req);
});

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
