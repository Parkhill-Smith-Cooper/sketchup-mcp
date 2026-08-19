import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

/**
 * Side-effect-free reachability probe. Lets an agent gate a multi-step plan on
 * one cheap call instead of discovering SketchUp is closed halfway through.
 *
 * Implemented as `get_selection` because the Ruby has no dedicated ping and
 * that handler reads the model without mutating it.
 */
export function registerSketchupStatusTool(server: McpServer) {
  server.tool(
    "sketchup_status",
    "Check whether SketchUp is open and reachable, before attempting any modeling work. " +
      "Read-only and safe to call at any time. Returns the current selection on success, " +
      "or SKETCHUP_NOT_RUNNING if SketchUp is closed or its MCP extension server is stopped.",
    {},
    async () => runSketchupTool("get_selection", {}),
  );
}
