import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  SKETCHUP_HOST,
  SKETCHUP_PORT,
  SketchupBusyError,
  SketchupToolError,
  SketchupUnavailableError,
  sendSketchupCommand,
  type SketchupSuccess,
} from "./SocketClient.js";

export type { SketchupSuccess };

/**
 * Serializes every call to SketchUp. The Ruby accept loop runs inside a
 * `UI.start_timer(0.1)` tick and handles one client per tick (main.rb:49-113),
 * so concurrent tool calls must queue rather than race.
 */
let connectionMutex: Promise<void> = Promise.resolve();

async function withSketchupLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = connectionMutex;
  let release!: () => void;
  connectionMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export type ToolResult = CallToolResult;

const NOT_RUNNING_GUIDANCE =
  `SKETCHUP_NOT_RUNNING: cannot reach the SketchUp MCP extension on ${SKETCHUP_HOST}:${SKETCHUP_PORT}. ` +
  `Tell the user to (1) open SketchUp and (2) confirm the Parkhill MCP extension server is running ` +
  `(Extensions > MCP Server > Start Server), then retry. No changes were made. Do not retry in a loop.`;

const BUSY_GUIDANCE =
  `SKETCHUP_BUSY: connected to SketchUp but it did not respond in time. It is likely showing a ` +
  `modal dialog or is busy with a long operation. Tell the user to check SketchUp, then retry.`;

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

/**
 * The text body the Ruby put in `content[0]` (main.rb:252-262). Tools that need
 * structured output have the Ruby return JSON here and parse it themselves.
 */
export function firstText(result: SketchupSuccess): string | undefined {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  return typeof first?.text === "string" ? first.text : undefined;
}

/**
 * Present the Ruby `result` to the model. On success the Ruby wraps output as
 * `{ content: [{type:'text', text}], success, resourceId }` (main.rb:252-262);
 * surface the text plus the entity id, which callers need for follow-up edits.
 */
function formatSuccess(result: SketchupSuccess): ToolResult {
  const body = firstText(result);

  const payload: Record<string, unknown> = { success: true };
  if (body !== undefined) payload.result = body;
  if (result.resourceId !== undefined) payload.id = result.resourceId;

  // Carry through anything else the Ruby returned (e.g. export paths) so new
  // Ruby-side fields don't require a server release to become visible.
  for (const [key, value] of Object.entries(result)) {
    if (key === "content" || key === "success" || key === "resourceId") continue;
    if (key === "isError") continue;
    payload[key] = value;
  }

  return text(JSON.stringify(payload, null, 2));
}

/**
 * Run one SketchUp call under the lock and hand back the raw Ruby `result`.
 * Throws the typed socket errors, so callers must pair it with
 * `toolErrorResult`. Only for tools that need the payload itself rather than
 * its text rendering (e.g. to build an image content block); everything else
 * should use `runSketchupTool`.
 */
export function callSketchup(
  toolName: string,
  args: Record<string, unknown>,
): Promise<SketchupSuccess> {
  return withSketchupLock(() => sendSketchupCommand(toolName, args));
}

/**
 * Render a failed call as the tool result the model sees, with the actionable
 * prefix (SKETCHUP_NOT_RUNNING / SKETCHUP_BUSY / SKETCHUP_ERROR) it can branch
 * on instead of the request just failing.
 */
export function toolErrorResult(toolName: string, error: unknown): ToolResult {
  if (error instanceof SketchupUnavailableError) {
    console.error(`[${toolName}] SketchUp unavailable: ${error.message}`);
    return text(NOT_RUNNING_GUIDANCE, true);
  }
  if (error instanceof SketchupBusyError) {
    console.error(`[${toolName}] SketchUp busy: ${error.message}`);
    return text(BUSY_GUIDANCE, true);
  }
  const message =
    error instanceof SketchupToolError || error instanceof Error
      ? error.message
      : String(error);
  console.error(`[${toolName}] SketchUp error: ${message}`);
  return text(`SKETCHUP_ERROR: ${toolName} failed: ${message}`, true);
}

/**
 * Run one SketchUp tool call and convert every outcome into a tool result.
 *
 * Failures come back as `isError` results rather than thrown exceptions, so the
 * model sees the actionable prefix and can branch on it.
 */
export async function runSketchupTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    return formatSuccess(await callSketchup(toolName, args));
  } catch (error) {
    return toolErrorResult(toolName, error);
  }
}

/**
 * Drop `undefined` values so optional zod args are not forwarded as JSON null,
 * which the Ruby would treat as an explicit value rather than "unset".
 */
export function compact(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
