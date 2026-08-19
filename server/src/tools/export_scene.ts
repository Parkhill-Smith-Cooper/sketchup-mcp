import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

export function registerExportSceneTool(server: McpServer) {
  server.tool(
    "export_scene",
    "Export the active model to a file in the user's temp directory and return its path. " +
      "The file lands on the user's own workstation, not on the server, so tell them the " +
      "path rather than offering to attach it.",
    {
      format: z
        .enum(["skp", "obj", "dae", "stl", "png", "jpg"])
        .default("skp")
        .describe("Export format. Image formats render the current view."),
      width: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Image width in pixels. Only used for png/jpg. Defaults to 1920."),
      height: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Image height in pixels. Only used for png/jpg. Defaults to 1080."),
    },
    // The Ruby dispatches this under the name "export" (main.rb:229).
    async ({ format, width, height }) =>
      runSketchupTool("export", {
        format,
        width: width ?? 1920,
        height: height ?? 1080,
      }),
  );
}
