/**
 * MCP sunucu süreci (stdio): `npm run mcp:server`
 *
 * stdout JSON-RPC'ye ayrılmıştır; loglar `LOG_TO_STDERR=true` ile stderr'e gider
 * (npm script'i bunu ayarlar). İnceleme: `npx @modelcontextprotocol/inspector npm run mcp:server`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnv } from "@/lib/config/load-env";
import { logger, errorFields } from "@/lib/observability/logger";
import { createMcpServer } from "@/lib/mcp/server";

loadEnv();

const server = createMcpServer();

server
  .connect(new StdioServerTransport())
  .then(() => logger.info("mcp server ready (stdio)"))
  .catch((error) => {
    logger.fatal(errorFields(error), "mcp server failed");
    process.exit(1);
  });

function shutdown(): void {
  void server.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
