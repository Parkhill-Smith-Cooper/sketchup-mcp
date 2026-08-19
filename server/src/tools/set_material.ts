import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerSetMaterialTool(server: McpServer) {
  server.tool(
    "set_material",
    "Apply a material or colour to an entity. Accepts a material name from the model " +
      'or a colour name/hex value (for example "red" or "#8B4513").',
    {
      id: z.string().describe("Entity id to apply the material to."),
      material: z
        .string()
        .describe('Material name, colour name, or hex colour, e.g. "Wood_Cherry" or "#8B4513".'),
    },
    async ({ id, material }) => runSketchupTool("set_material", { id, material }),
  );
}
