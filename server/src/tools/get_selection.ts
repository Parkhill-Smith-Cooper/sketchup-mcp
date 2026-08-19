import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerGetSelectionTool(server: McpServer) {
  server.tool(
    "get_selection",
    "List the entities currently selected in SketchUp, with their ids and types. " +
      "Read-only. Use this to discover ids to act on when the user refers to " +
      '"the selected object" or "this".',
    {},
    async () => runSketchupTool("get_selection", {}),
  );
}
