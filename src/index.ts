#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport: keep stdout clean for JSON-RPC; log to stderr only.
  process.stderr.write("turath-mcp: ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(
    `turath-mcp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
