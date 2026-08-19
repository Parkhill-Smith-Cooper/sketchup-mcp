import * as net from "net";

/**
 * Wire client for the SketchUp Ruby extension (su_mcp/su_mcp/main.rb).
 *
 * Three constraints are imposed by the Ruby side and drive this design:
 *
 *  1. It closes the client socket after every single response (main.rb:112), so
 *     there is no persistent connection to keep — we connect per request.
 *  2. It reads exactly one line with `client.gets` and replies with
 *     `response.to_json + "\n"`, so framing is newline-delimited. We must not
 *     accumulate-and-JSON.parse the whole buffer.
 *  3. It binds `TCPServer.new('127.0.0.1', ...)`, so we dial the literal IPv4
 *     loopback. "localhost" resolves to ::1 first on Windows and would fail.
 */

export const SKETCHUP_HOST = process.env.SKETCHUP_MCP_HOST || "127.0.0.1";
export const SKETCHUP_PORT = Number(process.env.SKETCHUP_MCP_PORT || 9876);

/** How long to wait for the TCP handshake. Short: refusal should be fast. */
export const CONNECT_TIMEOUT_MS = Number(
  process.env.SKETCHUP_MCP_CONNECT_TIMEOUT_MS || 3000,
);

/**
 * How long to wait for a response once connected. Must stay below the broker's
 * CONNECTOR_CALL_TIMEOUT_MS_SKETCHUP (90s) so we produce a useful error rather
 * than being cut off mid-flight.
 */
export const REQUEST_TIMEOUT_MS = Number(
  process.env.SKETCHUP_MCP_TIMEOUT_MS || 60000,
);

/** SketchUp is not reachable at all — closed, or the extension server is off. */
export class SketchupUnavailableError extends Error {}

/** Connected, but no reply in time — SketchUp is modal, busy, or wedged. */
export class SketchupBusyError extends Error {}

/** SketchUp answered with a JSON-RPC error — the Ruby raised. */
export class SketchupToolError extends Error {}

/**
 * Numeric ids only. The Ruby has a fallback that recovers the id by regex
 * (`/"id":\s*(\d+)/`, main.rb:70), which only matches integers.
 */
let nextRequestId = 1;

export interface SketchupSuccess {
  content?: Array<{ type: string; text?: string }>;
  success?: boolean;
  resourceId?: number | string;
  [key: string]: unknown;
}

const CONNECT_FAILURE_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOENT",
  "EADDRNOTAVAIL",
]);

/**
 * Send one `tools/call` request and resolve with the JSON-RPC `result`.
 * Callers must serialize; see ConnectionManager.
 */
export function sendSketchupCommand(
  toolName: string,
  args: Record<string, unknown>,
): Promise<SketchupSuccess> {
  return new Promise<SketchupSuccess>((resolve, reject) => {
    const requestId = nextRequestId++;
    const payload =
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: args },
        id: requestId,
      }) + "\n";

    const socket = new net.Socket();
    let buffer = "";
    let settled = false;
    let requestTimer: NodeJS.Timeout | undefined;

    const connectTimer = setTimeout(() => {
      settle(() =>
        reject(
          new SketchupUnavailableError(
            `timed out connecting to ${SKETCHUP_HOST}:${SKETCHUP_PORT} after ${CONNECT_TIMEOUT_MS}ms`,
          ),
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    /** Tear down exactly once, then deliver the outcome. */
    function settle(deliver: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      if (requestTimer) clearTimeout(requestTimer);
      socket.removeAllListeners();
      socket.destroy();
      deliver();
    }

    function deliverLine(line: string): void {
      const trimmed = line.trim();
      if (!trimmed) {
        settle(() =>
          reject(
            new SketchupToolError("SketchUp returned an empty response line"),
          ),
        );
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        settle(() =>
          reject(
            new SketchupToolError(
              `SketchUp returned malformed JSON: ${trimmed.slice(0, 200)}`,
            ),
          ),
        );
        return;
      }

      if (typeof parsed !== "object" || parsed === null) {
        settle(() => resolve({ success: true, value: parsed } as SketchupSuccess));
        return;
      }

      const response = parsed as Record<string, unknown>;
      const rpcError = response.error as
        | { code?: number; message?: string }
        | undefined;
      if (rpcError) {
        settle(() =>
          reject(
            new SketchupToolError(
              rpcError.message || "Unknown error from SketchUp",
            ),
          ),
        );
        return;
      }

      settle(() => resolve((response.result ?? {}) as SketchupSuccess));
    }

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      requestTimer = setTimeout(() => {
        settle(() =>
          reject(
            new SketchupBusyError(
              `no response from SketchUp within ${REQUEST_TIMEOUT_MS}ms`,
            ),
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      socket.write(payload);
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newlineAt = buffer.indexOf("\n");
      if (newlineAt === -1) return;
      deliverLine(buffer.slice(0, newlineAt));
    });

    // The Ruby closes right after replying. If it closed without a trailing
    // newline, whatever arrived is the whole response.
    socket.on("end", () => {
      if (buffer.length > 0) {
        deliverLine(buffer);
        return;
      }
      settle(() =>
        reject(
          new SketchupUnavailableError(
            "SketchUp closed the connection without responding",
          ),
        ),
      );
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      const unreachable = err.code && CONNECT_FAILURE_CODES.has(err.code);
      settle(() =>
        reject(
          unreachable
            ? new SketchupUnavailableError(
                `cannot reach ${SKETCHUP_HOST}:${SKETCHUP_PORT} (${err.code})`,
              )
            : new SketchupToolError(err.message),
        ),
      );
    });

    socket.connect(SKETCHUP_PORT, SKETCHUP_HOST);
  });
}
