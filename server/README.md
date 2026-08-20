# @parkhill/mcp-server-for-sketchup

MCP server for driving Trimble SketchUp from an AI assistant.

This is the desktop half of the pipeline. It speaks MCP over stdio to whatever
spawned it, and forwards each tool call over a local TCP socket to the SketchUp
Ruby extension in this repo (`su_mcp/`).

```
MCP client (Claude Desktop, or the Parkhill desktop connector)
  │  stdio, MCP
  ▼
this package
  │  TCP 127.0.0.1:9876, newline-delimited JSON-RPC 2.0
  ▼
SketchUp Ruby extension (su_mcp)
  │
  ▼
SketchUp API
```

## Prerequisites

1. Node.js 20 or newer.
2. SketchUp running, with the `su_mcp` extension installed. Install the `.rbz`
   from this repo's GitHub releases via **Window > Extension Manager > Install
   Extension**.

The extension's server starts automatically. If it has been turned off, start it
from **Extensions > MCP Server > Start Server**, or re-enable **Start
Automatically** in that same menu.

## Use with Claude Desktop

```json
{
  "mcpServers": {
    "sketchup": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@parkhill/mcp-server-for-sketchup@latest"]
    }
  }
}
```

On macOS or Linux drop the `cmd /c` wrapper. Claude Desktop must be fully quit
from the system tray and reopened to pick up tool changes.

## Use from Parkhill LibreChat

You do not configure this package directly. The Parkhill desktop connector
spawns it on your workstation and the chat backend routes your tool calls to it.
See the repository README.

## Tools

| Tool | Purpose |
| --- | --- |
| `sketchup_status` | Read-only reachability probe. Call before a multi-step plan. |
| `get_selection` | List currently selected entities with ids and types. |
| `create_component` | Create a cube, cylinder, sphere, or cone. |
| `delete_component` | Delete an entity by id. |
| `transform_component` | Move, rotate, or scale an entity. |
| `set_material` | Apply a material or colour. |
| `export_scene` | Export to skp/obj/dae/stl/png/jpg and return the path. |
| `boolean_operation` | Union, difference, or intersection of two solids. |
| `chamfer_edges` | Flat bevel on some or all edges. |
| `fillet_edges` | Rounded edges with a configurable segment count. |
| `create_mortise_tenon` | Mortise-and-tenon joint between two boards. |
| `create_dovetail` | Dovetail joint between two boards. |
| `create_finger_joint` | Finger (box) joint between two boards. |
| `eval_ruby` | Execute arbitrary Ruby in the SketchUp process. See the note below. |

Lengths are in inches, angles in degrees.

### About `eval_ruby`

It runs arbitrary Ruby with full SketchUp API access in the user's process, and
it blocks SketchUp's UI thread with no cancel path — a long or infinite loop
hangs SketchUp with no way to cancel.

In the Parkhill deployment it is available to every user, on the single
`/mcp/sketchup` endpoint. Each user reaches only the SketchUp running on their
own workstation, so the reach is the machine they are already sitting at. The
backend can withdraw it without a code change by setting
`CHAT_TOOL_DENYLIST_SKETCHUP=eval_ruby`.

## Error handling

Tool failures come back as results with `isError: true` and a prefix the model
can branch on, rather than as protocol errors:

| Prefix | Meaning |
| --- | --- |
| `SKETCHUP_NOT_RUNNING` | Nothing listening on the port. SketchUp is closed or its server is stopped. |
| `SKETCHUP_BUSY` | Connected, but no reply in time. SketchUp is likely showing a modal dialog. |
| `SKETCHUP_ERROR` | SketchUp received the call and raised. |

`tools/list` always succeeds, even with SketchUp closed, so the assistant can
tell the user what it *could* do and ask them to open SketchUp.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SKETCHUP_MCP_HOST` | `127.0.0.1` | Host the extension listens on. |
| `SKETCHUP_MCP_PORT` | `9876` | Port the extension listens on. |
| `SKETCHUP_MCP_CONNECT_TIMEOUT_MS` | `3000` | TCP handshake timeout. |
| `SKETCHUP_MCP_TIMEOUT_MS` | `60000` | Per-call response timeout. |

Keep `SKETCHUP_MCP_TIMEOUT_MS` below the backend's per-call timeout so a slow
operation produces a useful message instead of being cut off.

## Development

```bash
npm install
npm run build
npm test
```

`npm test` covers the socket layer against a mock that mimics the Ruby
extension's one-request-per-connection behaviour, including responses split
across TCP chunks.

To drive the tools by hand against a live SketchUp:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

## Releasing

Tag `vX.Y.Z` where `X.Y.Z` matches `server/package.json`. CI verifies the match,
runs the tests, publishes to npm, and attaches a freshly built `.rbz` to the
GitHub release.
