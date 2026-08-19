import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerCreateFingerJointTool(server: McpServer) {
  server.tool(
    "create_finger_joint",
    "Cut a finger joint (box joint) between two existing boards: interlocking square " +
      "fingers alternating between the two.",
    {
      board1_id: z.string().describe("Entity id of the first board."),
      board2_id: z.string().describe("Entity id of the second board."),
      width: z.number().positive().default(1.0).describe("Joint width in inches."),
      height: z.number().positive().default(2.0).describe("Joint height in inches."),
      depth: z.number().positive().default(1.0).describe("Joint depth in inches."),
      num_fingers: z
        .number()
        .int()
        .positive()
        .default(5)
        .describe("Number of fingers across the joint. Odd numbers interlock evenly."),
      offset_x: z.number().default(0.0).describe("Joint offset along X in inches."),
      offset_y: z.number().default(0.0).describe("Joint offset along Y in inches."),
      offset_z: z.number().default(0.0).describe("Joint offset along Z in inches."),
    },
    async (args) => runSketchupTool("create_finger_joint", args),
  );
}
