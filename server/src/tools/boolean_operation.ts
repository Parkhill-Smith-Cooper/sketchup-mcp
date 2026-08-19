import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerBooleanOperationTool(server: McpServer) {
  server.tool(
    "boolean_operation",
    "Combine or cut two solids. Both entities must be groups or component instances. " +
      "Returns the id of the new result group.",
    {
      operation: z
        .enum(["union", "difference", "intersection"])
        .describe(
          "union joins both solids; difference subtracts the tool from the target; " +
            "intersection keeps only the overlapping volume.",
        ),
      target_id: z
        .string()
        .describe("Entity id of the target solid (the one being cut, for difference)."),
      tool_id: z
        .string()
        .describe("Entity id of the tool solid (the cutter, for difference)."),
      delete_originals: z
        .boolean()
        .default(false)
        .describe("Erase both source entities after the operation succeeds."),
    },
    async ({ operation, target_id, tool_id, delete_originals }) =>
      runSketchupTool("boolean_operation", {
        operation,
        target_id,
        tool_id,
        delete_originals,
      }),
  );
}
