import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerCreateDovetailTool(server: McpServer) {
  server.tool(
    "create_dovetail",
    "Cut a dovetail joint between two existing boards: angled tails on one board and " +
      "matching pins on the other.",
    {
      tail_id: z.string().describe("Entity id of the board receiving the tails."),
      pin_id: z.string().describe("Entity id of the board receiving the pins."),
      width: z.number().positive().default(1.0).describe("Joint width in inches."),
      height: z.number().positive().default(2.0).describe("Joint height in inches."),
      depth: z.number().positive().default(1.0).describe("Joint depth in inches."),
      angle: z
        .number()
        .min(1)
        .max(45)
        .default(15.0)
        .describe("Dovetail angle in degrees. 7-15 is typical for hardwood."),
      num_tails: z
        .number()
        .int()
        .positive()
        .default(3)
        .describe("Number of tails across the joint."),
      offset_x: z.number().default(0.0).describe("Joint offset along X in inches."),
      offset_y: z.number().default(0.0).describe("Joint offset along Y in inches."),
      offset_z: z.number().default(0.0).describe("Joint offset along Z in inches."),
    },
    async (args) => runSketchupTool("create_dovetail", args),
  );
}
