import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runSketchupTool } from "../utils/ConnectionManager.js";

/**
 * Privileged escape hatch. This executes arbitrary Ruby in the user's SketchUp
 * process via `eval(code, TOPLEVEL_BINDING.dup)` (main.rb:1826-1848), which can
 * read and write files and shell out. It is always registered here so the
 * connector advertises it, but access is gated on the broker: the /mcp/sketchup
 * mount denies it and only /mcp/sketchup-admin permits it, for users listed in
 * SKETCHUP_ADMIN_ALLOWED_USERS.
 *
 * Note the code runs inside SketchUp's UI timer tick, so a long or infinite
 * eval hangs the user's SketchUp with no cancel path.
 */
export function registerEvalRubyTool(server: McpServer) {
  server.tool(
    "eval_ruby",
    "Execute arbitrary Ruby code inside the user's SketchUp process and return its value. " +
      "Prefer the typed modeling tools whenever one fits. Before running code that mutates " +
      "the model, state plainly what it will do and get the user's confirmation. Keep code " +
      "fast: it blocks SketchUp's UI thread and cannot be cancelled.",
    {
      code: z
        .string()
        .min(1)
        .describe(
          "Ruby source to evaluate. Has access to the full SketchUp API, e.g. Sketchup.active_model. " +
            "The value of the last expression is returned.",
        ),
    },
    async ({ code }) => runSketchupTool("eval_ruby", { code }),
  );
}
