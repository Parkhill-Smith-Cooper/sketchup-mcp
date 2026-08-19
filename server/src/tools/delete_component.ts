import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerDeleteComponentTool(server: McpServer) {
  server.tool(
    "delete_component",
    "Delete an entity from the active SketchUp model by its id. This cannot be undone " +
      "from the MCP side; confirm with the user before deleting anything they did not name.",
    {
      id: z
        .string()
        .describe("Entity id to delete, as returned by create_component or get_selection."),
    },
    async ({ id }) => runSketchupTool("delete_component", { id }),
  );
}
