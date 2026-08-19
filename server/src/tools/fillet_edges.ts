import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compact, runSketchupTool } from "../utils/ConnectionManager.js";

export function registerFilletEdgesTool(server: McpServer) {
  server.tool(
    "fillet_edges",
    "Round the edges of a solid. Applies to every edge unless edge_indices is given. " +
      "Higher segment counts look smoother but add geometry.",
    {
      entity_id: z.string().describe("Entity id of the group or component to fillet."),
      radius: z
        .number()
        .positive()
        .default(0.5)
        .describe("Fillet radius, in inches."),
      segments: z
        .number()
        .int()
        .min(2)
        .max(48)
        .default(8)
        .describe("Number of facets across each rounded edge."),
      edge_indices: z
        .array(z.number().int().nonnegative())
        .optional()
        .describe("Zero-based indices of specific edges to fillet. Omit to fillet all edges."),
      delete_original: z
        .boolean()
        .default(false)
        .describe("Erase the source entity after the filleted copy is created."),
    },
    async ({ entity_id, radius, segments, edge_indices, delete_original }) =>
      runSketchupTool(
        "fillet_edges",
        compact({ entity_id, radius, segments, edge_indices, delete_original }),
      ),
  );
}
