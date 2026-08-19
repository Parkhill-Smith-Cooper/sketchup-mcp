import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerCreateMortiseTenonTool(server: McpServer) {
  server.tool(
    "create_mortise_tenon",
    "Cut a mortise-and-tenon joint between two existing boards: a socket in the mortise " +
      "board and a matching projection on the tenon board.",
    {
      mortise_id: z.string().describe("Entity id of the board receiving the mortise (the socket)."),
      tenon_id: z.string().describe("Entity id of the board receiving the tenon (the projection)."),
      width: z.number().positive().default(1.0).describe("Joint width in inches."),
      height: z.number().positive().default(1.0).describe("Joint height in inches."),
      depth: z.number().positive().default(1.0).describe("Tenon depth in inches."),
      offset_x: z.number().default(0.0).describe("Joint offset along X in inches."),
      offset_y: z.number().default(0.0).describe("Joint offset along Y in inches."),
      offset_z: z.number().default(0.0).describe("Joint offset along Z in inches."),
    },
    async (args) => runSketchupTool("create_mortise_tenon", args),
  );
}
