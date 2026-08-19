import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerCreateComponentTool(server: McpServer) {
  server.tool(
    "create_component",
    "Create a primitive solid in the active SketchUp model. Returns the entity id, " +
      "which later tools use to reference this component.",
    {
      type: z
        .enum(["cube", "cylinder", "sphere", "cone"])
        .default("cube")
        .describe("Primitive shape to create."),
      position: z
        .array(z.number())
        .length(3)
        .optional()
        .describe("Origin as [x, y, z] in inches. Defaults to [0, 0, 0]."),
      dimensions: z
        .array(z.number())
        .length(3)
        .optional()
        .describe(
          "Size as [width, depth, height] in inches. Defaults to [1, 1, 1]. " +
            "For cylinder and cone the first value is the radius; for sphere it is the radius.",
        ),
    },
    async ({ type, position, dimensions }) =>
      runSketchupTool("create_component", {
        type,
        position: position ?? [0, 0, 0],
        dimensions: dimensions ?? [1, 1, 1],
      }),
  );
}
