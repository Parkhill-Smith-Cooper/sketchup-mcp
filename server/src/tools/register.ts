import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Convention-based tool loading: every sibling module that exports a function
 * whose name starts with `register` is a tool. Drop a file in, it registers.
 * One bad module logs and is skipped rather than killing startup.
 */
export async function registerTools(server: McpServer): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const toolFiles = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith(".js"))
    .filter((file) => file !== "register.js")
    .filter((file) => !file.endsWith(".test.js"))
    .sort();

  for (const file of toolFiles) {
    try {
      const module = await import(`./${file}`);
      const registrar = Object.keys(module).find(
        (key) => key.startsWith("register") && typeof module[key] === "function",
      );
      if (!registrar) {
        console.error(`Warning: no register function found in ${file}`);
        continue;
      }
      module[registrar](server);
      console.error(`Registered tool: ${file}`);
    } catch (error) {
      console.error(
        `Failed to register ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
