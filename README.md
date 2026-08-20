# SketchupMCP - SketchUp Model Context Protocol Integration

Connects SketchUp to AI assistants through the Model Context Protocol, enabling
prompt-assisted 3D modeling, scene creation, and manipulation.

This is the Parkhill fork of [mhyrr/sketchup-mcp](https://github.com/mhyrr/sketchup-mcp),
extended so it can be enabled by any employee from Parkhill LibreChat and driven
against the SketchUp instance on their own workstation. Big shoutout to
[Blender MCP](https://github.com/ahujasid/blender-mcp) for the original inspiration.

## Components

| Path | What it is |
| --- | --- |
| `su_mcp/` | SketchUp Ruby extension. Listens on `127.0.0.1:9876` and executes SketchUp API calls. Packaged as a `.rbz`. |
| `server/` | TypeScript MCP server, published as [`@parkhill/mcp-server-for-sketchup`](https://www.npmjs.com/package/@parkhill/mcp-server-for-sketchup). stdio MCP in, TCP to the extension out. This is the supported path. |
| `src/sketchup_mcp/` | Original Python MCP server, published to PyPI as `sketchup-mcp`. Retained for existing local setups. |

## Two ways to run it

### 1. Local, with Claude Desktop

Install the extension, then point Claude Desktop at the npm package:

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

Drop the `cmd /c` wrapper on macOS and Linux. See [`server/README.md`](server/README.md)
for the full tool list, configuration, and error semantics.

### 2. Company-wide, from Parkhill LibreChat

A cloud MCP server cannot reach a workstation behind corporate NAT, so the
connection direction is inverted: the desktop dials out and a broker routes each
user's tool calls back down their own long-poll. This reuses the same
infrastructure as the Revit integration.

```
LibreChat
  │  streamable-http, x-user-id: {{LIBRECHAT_USER_EMAIL}}
  ▼
chat-ui backend (Azure App Service)   /mcp/sketchup
  │  per-user long-poll  /api/connector/*   (appId=sketchup)
  ▼
Parkhill desktop connector (MSI, Scheduled Task, Entra sign-in)
  │  stdio, MCP
  ▼
@parkhill/mcp-server-for-sketchup
  │  TCP 127.0.0.1:9876
  ▼
SketchUp Ruby extension  →  SketchUp
```

Users install the `.rbz` and the desktop connector; identity comes from their
Entra sign-in, so there is nothing to pair.

## Installing the SketchUp extension

1. Download the latest `.rbz` from this repository's GitHub releases.
2. In SketchUp: **Window > Extension Manager > Install Extension**.
3. Select the `.rbz` and restart SketchUp.

The extension's TCP server starts automatically on load. To control it manually,
use **Extensions > MCP Server**, which offers Start Server, Stop Server, and a
**Start Automatically** toggle.

## Tools

`sketchup_status`, `get_selection`, `create_component`, `delete_component`,
`transform_component`, `set_material`, `export_scene`, `boolean_operation`,
`chamfer_edges`, `fillet_edges`, `create_mortise_tenon`, `create_dovetail`,
`create_finger_joint`, and the privileged `eval_ruby`.

Lengths are in inches, angles in degrees. See [`server/README.md`](server/README.md)
for parameters and details.

> `eval_ruby` executes arbitrary Ruby in the user's SketchUp process and blocks
> its UI thread with no cancel path. It is available to everyone: each user drives
> only the SketchUp on their own workstation, so the reach is the machine they are
> already sitting at. To restrict it again, set `CHAT_TOOL_DENYLIST_SKETCHUP` on
> the backend — no code change or redeploy of this repo required.

## Example prompts

* "Create a simple house model with a roof and windows"
* "Make the selected component red"
* "Move the selected component 10 inches up"
* "Cut a dovetail joint between these two boards"
* "Export the current scene as an OBJ"

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `SKETCHUP_NOT_RUNNING` | SketchUp is closed, or its server was stopped. Check **Extensions > MCP Server**. |
| `SKETCHUP_BUSY` | SketchUp is showing a modal dialog or running a long operation. |
| `SKETCHUP_ERROR` | The call reached SketchUp and raised. Check the Ruby Console for the backtrace. |
| Server won't start | A second SketchUp instance already holds port 9876. Only one instance can serve at a time. |

## Development

```bash
cd server
npm install
npm run build
npm test          # socket-layer tests against a mock of the Ruby extension
```

Build the extension package either way:

```bash
cd su_mcp && ruby package.rb                  # needs the rubyzip gem
```

```powershell
cd su_mcp; ./build-rbz.ps1                    # no Ruby needed (Windows)
cd su_mcp; ./build-rbz.ps1 -InstallToPlugins  # also copy into SketchUp's Plugins folder
```

The PowerShell script verifies that `extension.json` and `su_mcp.rb` agree on the
version and writes ZIP entries with forward slashes (`Compress-Archive` on
PowerShell 5.1 writes backslashes, which some extractors mishandle). CI builds
the `.rbz` on tag.

### Releasing

Tag `vX.Y.Z` matching `server/package.json`. CI verifies the version match, runs
the tests, publishes to npm, and attaches a built `.rbz` to the release. The
extension's own version lives in `su_mcp/extension.json`, `su_mcp/su_mcp.rb`, and
`su_mcp/package.rb`; CI fails the release if those three disagree.

## License

MIT
