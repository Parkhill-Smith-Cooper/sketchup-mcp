import assert from "node:assert/strict";
import fs from "node:fs";
import * as net from "net";
import os from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Exercises capture_view against a mock that behaves like the SketchUp Ruby
 * extension: accept, read ONE line, write one JSON line, close. The capture
 * itself runs inside SketchUp, so what is testable here is the contract either
 * side of it — what script goes out, and what the model gets back.
 */

type Handler = (request: Record<string, unknown>, socket: net.Socket) => void;

let handler: Handler = () => {};
let mock: net.Server;
let schema: z.ZodObject<z.ZodRawShape>;
let call: (args: Record<string, unknown>) => Promise<CallToolResult>;

/** The last Ruby script sent to eval_ruby. */
let sentCode = "";

function replyPath(socket: net.Socket, id: unknown, info: unknown): void {
  socket.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(info) }],
        isError: false,
        success: true,
      },
    }) + "\n",
  );
  socket.end();
}

/** A file where SketchUp would have written the render. */
function writeCapture(bytes: Buffer, ext = "png"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "su-capture-test-"));
  const file = path.join(dir, `capture.${ext}`);
  fs.writeFileSync(file, bytes);
  return file;
}

function contentOfType(result: CallToolResult, type: string) {
  return result.content.find((block) => block.type === type);
}

before(async () => {
  mock = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineAt = buffer.indexOf("\n");
      if (newlineAt === -1) return;
      const line = buffer.slice(0, newlineAt);
      buffer = "";
      handler(JSON.parse(line), socket);
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const port = (mock.address() as net.AddressInfo).port;

  // The socket layer reads host/port at module load, so configure before import.
  process.env.SKETCHUP_MCP_HOST = "127.0.0.1";
  process.env.SKETCHUP_MCP_PORT = String(port);
  process.env.SKETCHUP_MCP_CONNECT_TIMEOUT_MS = "1000";
  process.env.SKETCHUP_MCP_TIMEOUT_MS = "2000";

  const { registerCaptureViewTool } = await import("./capture_view.js");

  // Stand in for the MCP server to get at the schema and handler it registers.
  let toolHandler:
    | ((args: Record<string, unknown>) => Promise<CallToolResult>)
    | undefined;
  const fakeServer = {
    tool: (
      _name: string,
      _description: string,
      shape: z.ZodRawShape,
      fn: (args: Record<string, unknown>) => Promise<CallToolResult>,
    ) => {
      schema = z.object(shape);
      toolHandler = fn;
    },
  } as unknown as McpServer;

  registerCaptureViewTool(fakeServer);
  assert.ok(toolHandler, "capture_view did not register a handler");

  // Go through the schema so the tests see the same defaults a client would.
  call = (args) =>
    toolHandler!(schema.parse(args) as Record<string, unknown>);
});

after(() => {
  mock?.close();
});

describe("capture_view", () => {
  test("renders through eval_ruby and returns the image plus a summary", async () => {
    const bytes = Buffer.from("fake png bytes");
    const file = writeCapture(bytes);

    handler = (request, socket) => {
      const params = request.params as {
        name: string;
        arguments: { code: string };
      };
      assert.equal(params.name, "eval_ruby");
      sentCode = params.arguments.code;
      replyPath(socket, request.id, {
        path: file,
        format: "png",
        width: 1200,
        height: 900,
        model: "Cabin",
        top_level_entities: 12,
        selected_entities: 0,
        extent_x: "20'",
      });
    };

    const result = await call({});

    assert.equal(result.isError, false);
    const image = contentOfType(result, "image") as {
      data: string;
      mimeType: string;
    };
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.data, bytes.toString("base64"));

    const summary = JSON.parse(
      (contentOfType(result, "text") as { text: string }).text,
    );
    assert.equal(summary.success, true);
    assert.equal(summary.bytes, bytes.byteLength);
    assert.equal(summary.model, "Cabin");
    assert.equal(summary.extent_x, "20'");
    // The path is an implementation detail of the transfer, not model context.
    assert.equal(summary.path, undefined);

    // The capture is consumed, not left behind in the user's temp directory.
    assert.equal(fs.existsSync(file), false);
  });

  test("defaults to the user's own camera, and never leaves it moved", async () => {
    const defaults = schema.parse({}) as Record<string, unknown>;
    assert.equal(defaults.view, "current");
    assert.equal(defaults.zoom, "none");
    assert.equal(defaults.style, "current");
    assert.equal(defaults.keep_camera, false);

    const file = writeCapture(Buffer.from("x"));
    handler = (request, socket) => {
      sentCode = (request.params as { arguments: { code: string } }).arguments
        .code;
      replyPath(socket, request.id, { path: file, format: "png" });
    };
    await call({});

    // The script carries the args and restores the camera whatever happens.
    assert.match(sentCode, /"view":"current"/);
    assert.match(sentCode, /"keep_camera":false/);
    assert.match(sentCode, /view\.write_image/);
    assert.match(sentCode, /^ensure$/m);
    assert.match(sentCode, /view\.camera = restored/);
  });

  test("asks SketchUp for the requested view, framing and style", async () => {
    const file = writeCapture(Buffer.from("x"));
    handler = (request, socket) => {
      const params = request.params as { arguments: { code: string } };
      sentCode = params.arguments.code;
      replyPath(socket, request.id, { path: file, format: "png" });
    };

    await call({ view: "top", zoom: "selection", style: "xray", keep_camera: true });

    assert.match(sentCode, /"view":"top"/);
    assert.match(sentCode, /"zoom":"selection"/);
    assert.match(sentCode, /"style":"xray"/);
    assert.match(sentCode, /"keep_camera":true/);
  });

  test("labels a jpg render as image/jpeg", async () => {
    const file = writeCapture(Buffer.from("fake jpg"), "jpg");
    handler = (request, socket) =>
      replyPath(socket, request.id, { path: file, format: "jpg" });

    const result = await call({ format: "jpg" });

    assert.equal(
      (contentOfType(result, "image") as { mimeType: string }).mimeType,
      "image/jpeg",
    );
  });

  test("explains itself when the render is not readable from here", async () => {
    handler = (request, socket) =>
      replyPath(socket, request.id, {
        path: path.join(os.tmpdir(), "su-capture-missing", "nope.png"),
      });

    const result = await call({});

    assert.equal(result.isError, true);
    const body = (contentOfType(result, "text") as { text: string }).text;
    assert.match(body, /^SKETCHUP_ERROR: capture_view:/);
    assert.match(body, /could not read it/);
    assert.match(body, /machine running SketchUp/);
  });

  test("refuses a render too large to hand to the model", async () => {
    const file = writeCapture(Buffer.alloc(4 * 1024 * 1024 + 1, 1));
    handler = (request, socket) =>
      replyPath(socket, request.id, { path: file, format: "png" });

    const result = await call({});

    assert.equal(result.isError, true);
    const body = (contentOfType(result, "text") as { text: string }).text;
    assert.match(body, /over the 4 MB limit/);
    assert.match(body, /smaller width/);
    // Still cleaned up, so a rejected render does not accumulate on disk.
    assert.equal(fs.existsSync(file), false);
  });

  test("surfaces a Ruby failure with the SKETCHUP_ERROR prefix", async () => {
    handler = (request, socket) => {
      socket.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message: "Ruby evaluation error: No active SketchUp model",
          },
        }) + "\n",
      );
      socket.end();
    };

    const result = await call({});

    assert.equal(result.isError, true);
    const body = (contentOfType(result, "text") as { text: string }).text;
    assert.match(body, /^SKETCHUP_ERROR: capture_view failed:/);
    assert.match(body, /No active SketchUp model/);
  });

  test("flags a reply that is not the expected JSON", async () => {
    handler = (request, socket) => {
      socket.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: "nil" }],
            isError: false,
            success: true,
          },
        }) + "\n",
      );
      socket.end();
    };

    const result = await call({});

    assert.equal(result.isError, true);
    assert.match(
      (contentOfType(result, "text") as { text: string }).text,
      /unexpected reply from SketchUp/,
    );
  });

  test("maps a closed SketchUp to SKETCHUP_NOT_RUNNING", async () => {
    await new Promise<void>((resolve) => mock.close(() => resolve()));

    const result = await call({});

    assert.equal(result.isError, true);
    assert.match(
      (contentOfType(result, "text") as { text: string }).text,
      /^SKETCHUP_NOT_RUNNING:/,
    );
  });
});
