import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compact, runSketchupTool } from "../utils/ConnectionManager.js";

export function registerTransformComponentTool(server: McpServer) {
  server.tool(
    "transform_component",
    "Move, rotate, or scale an existing entity. Omitted fields are left unchanged, " +
      "so you can move without affecting rotation or scale.",
    {
      id: z.string().describe("Entity id to transform."),
      position: z
        .array(z.number())
        .length(3)
        .optional()
        .describe("New absolute origin as [x, y, z] in inches."),
      rotation: z
        .array(z.number())
        .length(3)
        .optional()
        .describe("Rotation as [x, y, z] in degrees."),
      scale: z
        .array(z.number())
        .length(3)
        .optional()
        .describe("Scale factors as [x, y, z], where 1.0 is unchanged."),
    },
    async ({ id, position, rotation, scale }) =>
      runSketchupTool(
        "transform_component",
        compact({ id, position, rotation, scale }),
      ),
  );
}
