import assert from "node:assert/strict";
import * as net from "net";
import test, { after, before, describe } from "node:test";

/**
 * Tests the wire layer against a mock that behaves exactly like the SketchUp
 * Ruby extension: accept, read ONE line, write one JSON line, close.
 * See su_mcp/su_mcp/main.rb:49-113.
 */

type Handler = (request: Record<string, unknown>, socket: net.Socket) => void;

let handler: Handler = () => {};
let mock: net.Server;
let runSketchupTool: typeof import("./ConnectionManager.js").runSketchupTool;

function replyJson(socket: net.Socket, body: unknown): void {
  socket.write(JSON.stringify(body) + "\n");
  socket.end();
}

/** Mirrors the Ruby success wrapper at main.rb:252-262. */
function rubySuccess(id: unknown, text: string, resourceId?: number) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      isError: false,
      success: true,
      resourceId,
    },
  };
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

  ({ runSketchupTool } = await import("./ConnectionManager.js"));
});

after(() => {
  mock?.close();
});

describe("SketchUp socket client", () => {
  test("sends a tools/call envelope with a numeric id", async () => {
    let seen: Record<string, unknown> | undefined;
    handler = (request, socket) => {
      seen = request;
      replyJson(socket, rubySuccess(request.id, "ok"));
    };

    await runSketchupTool("create_component", { type: "cube" });

    assert.equal(seen?.jsonrpc, "2.0");
    assert.equal(seen?.method, "tools/call");
    assert.deepEqual(seen?.params, {
      name: "create_component",
      arguments: { type: "cube" },
    });
    // The Ruby recovers ids by the regex /"id":\s*(\d+)/, which only matches integers.
    assert.equal(typeof seen?.id, "number");
  });

  test("surfaces the text body and entity id on success", async () => {
    handler = (request, socket) =>
      replyJson(socket, rubySuccess(request.id, "Created cube", 4242));

    const result = await runSketchupTool("create_component", {});

    assert.equal(result.isError, false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    assert.deepEqual(payload, { success: true, result: "Created cube", id: 4242 });
  });

  test("reassembles a response split across TCP chunks", async () => {
    // The exact case that breaks a parse-the-whole-buffer implementation.
    handler = (request, socket) => {
      const body = JSON.stringify(rubySuccess(request.id, "chunked", 7)) + "\n";
      socket.write(body.slice(0, 12));
      setTimeout(() => socket.write(body.slice(12)), 25);
      setTimeout(() => socket.end(), 50);
    };

    const result = await runSketchupTool("get_selection", {});

    assert.equal(result.isError, false);
    assert.equal(JSON.parse((result.content[0] as { text: string }).text).result, "chunked");
  });

  test("accepts a response sent without a trailing newline", async () => {
    handler = (request, socket) => {
      socket.write(JSON.stringify(rubySuccess(request.id, "no newline")));
      socket.end();
    };

    const result = await runSketchupTool("get_selection", {});

    assert.equal(result.isError, false);
    assert.equal(
      JSON.parse((result.content[0] as { text: string }).text).result,
      "no newline",
    );
  });

  test("maps a JSON-RPC error to SKETCHUP_ERROR", async () => {
    handler = (request, socket) =>
      replyJson(socket, {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: "Entity not found: target" },
      });

    const result = await runSketchupTool("boolean_operation", {});

    assert.equal(result.isError, true);
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /^SKETCHUP_ERROR:/);
    assert.match(text, /Entity not found: target/);
  });

  test("maps a silent SketchUp to SKETCHUP_BUSY", async () => {
    handler = () => {
      /* connect, then never answer */
    };

    const result = await runSketchupTool("eval_ruby", { code: "sleep 60" });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /^SKETCHUP_BUSY:/);
  });

  test("serializes concurrent calls into one connection at a time", async () => {
    let concurrent = 0;
    let peak = 0;
    handler = (request, socket) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      setTimeout(() => {
        concurrent -= 1;
        replyJson(socket, rubySuccess(request.id, "ok"));
      }, 30);
    };

    await Promise.all([
      runSketchupTool("get_selection", {}),
      runSketchupTool("get_selection", {}),
      runSketchupTool("get_selection", {}),
    ]);

    // The Ruby accept loop handles one client per UI timer tick.
    assert.equal(peak, 1);
  });

  test("one failing call does not wedge the mutex for later calls", async () => {
    handler = (request, socket) => {
      socket.write("this is not json\n");
      socket.end();
    };
    const failed = await runSketchupTool("get_selection", {});
    assert.equal(failed.isError, true);

    handler = (request, socket) => replyJson(socket, rubySuccess(request.id, "recovered"));
    const recovered = await runSketchupTool("get_selection", {});
    assert.equal(recovered.isError, false);
  });

  test("maps a closed SketchUp to SKETCHUP_NOT_RUNNING", async () => {
    await new Promise<void>((resolve) => mock.close(() => resolve()));

    const result = await runSketchupTool("get_selection", {});

    assert.equal(result.isError, true);
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /^SKETCHUP_NOT_RUNNING:/);
    assert.match(text, /No changes were made/);
  });
});
