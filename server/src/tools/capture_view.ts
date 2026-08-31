import { promises as fs } from "fs";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  callSketchup,
  firstText,
  toolErrorResult,
  type ToolResult,
} from "../utils/ConnectionManager.js";

/**
 * Lets the model actually look at the model instead of inferring it from entity
 * ids: renders the SketchUp viewport on the user's workstation and returns it
 * as an MCP image block.
 *
 * Implemented over `eval_ruby` rather than as a dedicated Ruby command on
 * purpose. The extension ships as an .rbz that every user installs by hand, so
 * a Ruby-side handler would only reach the people who reinstalled it; this way
 * the whole capture — camera presets, render style, framing — lives in the npm
 * package and publishing is the entire rollout.
 *
 * The render is handed back as a file path and read from disk. This server
 * always runs on the machine SketchUp runs on (it dials 127.0.0.1), and pushing
 * megabytes of base64 back through the extension's newline-delimited socket
 * would land in its Ruby console log as well.
 */

/** Axis views are rendered orthographic; `iso` keeps perspective. */
const VIEWS = [
  "current",
  "iso",
  "top",
  "bottom",
  "front",
  "back",
  "left",
  "right",
] as const;

const ZOOMS = ["none", "extents", "selection"] as const;

const STYLES = [
  "current",
  "shaded",
  "textured",
  "wireframe",
  "hidden_line",
  "xray",
] as const;

/**
 * Guardrail on what gets handed to the model. A 1200x900 SketchUp render sits
 * comfortably under this; anything above it means the caller asked for a poster,
 * and the base64 would be wasted context either way.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface CaptureArgs {
  view: (typeof VIEWS)[number];
  zoom: (typeof ZOOMS)[number];
  style: (typeof STYLES)[number];
  width: number;
  height: number;
  format: "png" | "jpg";
  keep_camera: boolean;
}

/** Quote a value into Ruby source. Single quotes take only \\ and \' escapes. */
function rubyStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * The capture script. Saves the camera and rendering options up front and puts
 * them back in an `ensure` block, so looking at the model from another angle
 * never leaves the user's viewport somewhere they did not put it.
 *
 * Exported so CI can `ruby -c` it (see scripts/print-capture-ruby.mjs): it only
 * ever runs inside SketchUp, so nothing else here would catch a syntax error.
 */
export function captureScript(args: CaptureArgs): string {
  return `
cfg = JSON.parse(${rubyStringLiteral(JSON.stringify(args))})
model = Sketchup.active_model
raise 'No active SketchUp model' if model.nil?
view = model.active_view
sel = model.selection

want_view = cfg['view']
want_zoom = cfg['zoom']
want_style = cfg['style']
img_w = cfg['width'].to_i
img_h = cfg['height'].to_i
ext = (cfg['format'] == 'jpg') ? 'jpg' : 'png'
keep_camera = cfg['keep_camera'] ? true : false

cam0 = view.camera
saved_cam = {
  'eye' => cam0.eye.to_a,
  'target' => cam0.target.to_a,
  'up' => cam0.up.to_a,
  'perspective' => cam0.perspective?,
  'fov' => (cam0.perspective? ? cam0.fov : nil),
  'height' => (cam0.perspective? ? nil : cam0.height)
}

ro = model.rendering_options
saved_render = nil

if want_zoom == 'selection' && sel.length > 0
  focus = Geom::BoundingBox.new
  sel.each { |e| focus.add(e.bounds) }
else
  focus = model.bounds
end

begin
  if want_style != 'current'
    saved_render = {
      'RenderMode' => ro['RenderMode'],
      'ModelTransparency' => ro['ModelTransparency']
    }
    if want_style == 'xray'
      ro['ModelTransparency'] = true
    else
      modes = { 'wireframe' => 0, 'hidden_line' => 1, 'shaded' => 2, 'textured' => 3 }
      mode = modes[want_style]
      raise "Unknown style: #{want_style}" if mode.nil?
      ro['RenderMode'] = mode
      ro['ModelTransparency'] = false
    end
  end

  if want_view != 'current'
    dirs = {
      'iso' => [-1.0, -1.0, 1.0],
      'top' => [0.0, 0.0, 1.0],
      'bottom' => [0.0, 0.0, -1.0],
      'front' => [0.0, -1.0, 0.0],
      'back' => [0.0, 1.0, 0.0],
      'left' => [-1.0, 0.0, 0.0],
      'right' => [1.0, 0.0, 0.0]
    }
    dir = dirs[want_view]
    raise "Unknown view: #{want_view}" if dir.nil?

    center = focus.valid? ? focus.center : Geom::Point3d.new(0, 0, 0)
    span = focus.valid? ? focus.diagonal.to_f : 0.0
    span = 120.0 if span <= 0.0
    vec = Geom::Vector3d.new(dir[0], dir[1], dir[2])
    vec.normalize!
    eye = center.offset(vec, span * 2.0)
    # Straight down or up, Z cannot be the up vector; face north instead.
    up = Geom::Vector3d.new(0, 0, 1)
    up = Geom::Vector3d.new(0, 1, 0) if want_view == 'top' || want_view == 'bottom'
    cam = Sketchup::Camera.new(eye, center, up)
    cam.perspective = (want_view == 'iso')
    view.camera = cam
  end

  # Zoom-to-fit leaves the subject touching the frame, and write_image can crop
  # when its aspect ratio differs from the viewport's, so pull back a little.
  if want_zoom == 'selection' && sel.length > 0
    view.zoom(sel.to_a)
    view.zoom(0.9)
  elsif want_zoom == 'extents'
    view.zoom_extents
    view.zoom(0.9)
  end

  base = ENV['TEMP'] || ENV['TMP'] || (Dir.respond_to?(:tmpdir) ? Dir.tmpdir : '.')
  dir_path = File.join(base, 'sketchup_mcp_captures')
  FileUtils.mkdir_p(dir_path) unless Dir.exist?(dir_path)
  path = File.join(dir_path, "capture_#{Time.now.strftime('%Y%m%d_%H%M%S')}_#{rand(100000)}.#{ext}")

  opts = {
    :filename => path,
    :width => img_w,
    :height => img_h,
    :antialias => true,
    :transparent => false
  }
  opts[:compression] = 0.9 if ext == 'jpg'
  view.write_image(opts)
  raise 'SketchUp did not write the view image' unless File.exist?(path)

  info = {
    'path' => path,
    'format' => ext,
    'width' => img_w,
    'height' => img_h,
    'model' => (model.title.to_s.empty? ? 'Untitled' : model.title),
    'view' => want_view,
    'zoom' => want_zoom,
    'style' => want_style,
    'projection' => (view.camera.perspective? ? 'perspective' : 'parallel'),
    'top_level_entities' => model.entities.length,
    'selected_entities' => sel.length,
    'camera_kept' => keep_camera
  }
  if focus.valid?
    info['extent_x'] = Sketchup.format_length(focus.width)
    info['extent_y'] = Sketchup.format_length(focus.height)
    info['extent_z'] = Sketchup.format_length(focus.depth)
  end
  info.to_json
ensure
  unless keep_camera
    begin
      restored = Sketchup::Camera.new(
        Geom::Point3d.new(saved_cam['eye']),
        Geom::Point3d.new(saved_cam['target']),
        Geom::Vector3d.new(saved_cam['up'])
      )
      restored.perspective = saved_cam['perspective']
      if saved_cam['perspective']
        restored.fov = saved_cam['fov'] if saved_cam['fov']
      else
        restored.height = saved_cam['height'] if saved_cam['height']
      end
      view.camera = restored
    rescue StandardError
      nil
    end
  end
  if saved_render
    begin
      ro['RenderMode'] = saved_render['RenderMode'] unless saved_render['RenderMode'].nil?
      ro['ModelTransparency'] = saved_render['ModelTransparency']
    rescue StandardError
      nil
    end
  end
  begin
    view.invalidate
  rescue StandardError
    nil
  end
end
`.trim();
}

interface CaptureInfo {
  path?: unknown;
  [key: string]: unknown;
}

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

async function captureView(args: CaptureArgs): Promise<ToolResult> {
  let info: CaptureInfo;
  try {
    const result = await callSketchup("eval_ruby", {
      code: captureScript(args),
    });
    const body = firstText(result);
    if (!body) {
      return text(
        "SKETCHUP_ERROR: capture_view: SketchUp rendered the view but returned nothing.",
        true,
      );
    }
    try {
      info = JSON.parse(body) as CaptureInfo;
    } catch {
      return text(
        `SKETCHUP_ERROR: capture_view: unexpected reply from SketchUp: ${body.slice(0, 300)}`,
        true,
      );
    }
  } catch (error) {
    return toolErrorResult("capture_view", error);
  }

  const { path, ...summary } = info;
  if (typeof path !== "string" || path.length === 0) {
    return text(
      "SKETCHUP_ERROR: capture_view: SketchUp did not report where it wrote the image.",
      true,
    );
  }

  let image: Buffer;
  try {
    image = await fs.readFile(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(
      `SKETCHUP_ERROR: capture_view: rendered ${path} but could not read it (${message}). ` +
        `The image is written on the machine running SketchUp, so this server has to run there too.`,
      true,
    );
  } finally {
    // Best effort: a leftover capture is harmless, and a failed unlink is not
    // worth failing the call over.
    await fs.unlink(path).catch(() => {});
  }

  if (image.byteLength > MAX_IMAGE_BYTES) {
    return text(
      `SKETCHUP_ERROR: capture_view: the render is ${Math.round(image.byteLength / 1024)} KB, ` +
        `over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit. Retry with a smaller width and ` +
        `height, or format "jpg".`,
      true,
    );
  }

  return {
    isError: false,
    content: [
      {
        type: "image",
        data: image.toString("base64"),
        mimeType: args.format === "jpg" ? "image/jpeg" : "image/png",
      },
      {
        type: "text",
        text: JSON.stringify(
          { success: true, bytes: image.byteLength, ...summary },
          null,
          2,
        ),
      },
    ],
  };
}

export function registerCaptureViewTool(server: McpServer) {
  server.tool(
    "capture_view",
    "Look at the SketchUp model: renders the viewport and returns it as an image you can see, " +
      "plus the model name, entity and selection counts, and overall dimensions. Read-only — the " +
      "user's camera and style are restored afterwards. Use it before editing when the user refers " +
      'to what is on their screen ("this", "here", "the one in front"), to work out what a model ' +
      "contains, and after editing to check the result looks right. If the image comes back empty " +
      'or badly framed, retry with zoom "extents".',
    {
      view: z
        .enum(VIEWS)
        .default("current")
        .describe(
          "Camera to render from. 'current' shows exactly what the user sees. The named views are " +
            "rendered orthographic, except 'iso' which stays perspective.",
        ),
      zoom: z
        .enum(ZOOMS)
        .default("none")
        .describe(
          "Framing. 'none' keeps the current framing, 'extents' fits the whole model, 'selection' " +
            "fits the current selection (falls back to the model when nothing is selected).",
        ),
      style: z
        .enum(STYLES)
        .default("current")
        .describe(
          "Render style. 'xray' makes faces transparent, which is how to see interior geometry; " +
            "'wireframe' and 'hidden_line' drop shading.",
        ),
      width: z
        .number()
        .int()
        .min(256)
        .max(2000)
        .default(1200)
        .describe("Image width in pixels."),
      height: z
        .number()
        .int()
        .min(256)
        .max(2000)
        .default(900)
        .describe("Image height in pixels."),
      format: z
        .enum(["png", "jpg"])
        .default("png")
        .describe("png is sharper on edges and text; jpg is smaller."),
      keep_camera: z
        .boolean()
        .default(false)
        .describe(
          "Leave the camera where this call put it instead of restoring it. Use when the user asked " +
            "to be shown something, so their viewport matches the image.",
        ),
    },
    async (args) => captureView(args as CaptureArgs),
  );
}
