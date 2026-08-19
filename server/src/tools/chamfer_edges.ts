import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compact, runSketchupTool } from "../utils/ConnectionManager.js";

export function registerChamferEdgesTool(server: McpServer) {
  server.tool(
    "chamfer_edges",
    "Cut a flat bevel on the edges of a solid. Applies to every edge unless " +
      "edge_indices is given.",
    {
      entity_id: z.string().describe("Entity id of the group or component to chamfer."),
      distance: z
        .number()
        .positive()
        .default(0.5)
        .describe("Bevel setback from the edge, in inches."),
      edge_indices: z
        .array(z.number().int().nonnegative())
        .optional()
        .describe(
          "Zero-based indices of specific edges to chamfer. Omit to chamfer all edges.",
        ),
      delete_original: z
        .boolean()
        .default(false)
        .describe("Erase the source entity after the chamfered copy is created."),
    },
    async ({ entity_id, distance, edge_indices, delete_original }) =>
      runSketchupTool(
        "chamfer_edges",
        compact({ entity_id, distance, edge_indices, delete_original }),
      ),
  );
}
