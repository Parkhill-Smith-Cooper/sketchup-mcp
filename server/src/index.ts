#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/register.js";
import { SKETCHUP_HOST, SKETCHUP_PORT } from "./utils/SocketClient.js";

export const SERVER_NAME = "mcp-server-for-sketchup";
export const SERVER_VERSION = "1.0.0";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

async function main() {
  // Tools register statically, before any socket use, so tools/list succeeds
  // even when SketchUp is closed. Reachability is only checked per tool call.
  await registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is the protocol channel; all logging must go to stderr.
  console.error(
    `SketchUp MCP server ${SERVER_VERSION} ready (SketchUp extension expected at ${SKETCHUP_HOST}:${SKETCHUP_PORT})`,
  );
}

main().catch((error) => {
  console.error("Error starting SketchUp MCP server:", error);
  process.exit(1);
});
