/**
 * MCP duman testi: `npm run mcp:smoke` — stdio sunucusunu ayrı süreçte başlatır,
 * araç listesini yazdırır ve `create_hold`'un token'sız reddedildiğini doğrular.
 * Veritabanı gerektirmez.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main(): Promise<void> {
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
  process.stdout.write(`tools: ${tools.map((t) => t.name).join(", ")}\n`);

  const res = await client.callTool({
    name: "create_hold",
    arguments: {
      propertyId: "p",
      roomId: "r",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      guests: 1,
    },
  });
  const [first] = res.content as { text: string }[];
  process.stdout.write(`create_hold (token yok): isError=${String(res.isError)} ${first.text}\n`);
  await client.close();

  const expected = ["create_hold", "get_quote", "search_stays"];
  const names = tools.map((t) => t.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected) || res.isError !== true) {
    process.stderr.write("MCP smoke FAILED\n");
    process.exit(1);
  }
  process.stdout.write("MCP smoke OK\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`MCP smoke FAILED: ${String(error)}\n`);
  process.exit(1);
});
