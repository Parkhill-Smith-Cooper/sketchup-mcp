/**
 * Prints the Ruby that capture_view sends to SketchUp, for `ruby -c` in CI.
 *
 * The script is generated in TypeScript and only ever executed inside
 * SketchUp's Ruby, so this is the one automated check that it parses at all.
 * Run against ./build, so build first.
 *
 *   node scripts/print-capture-ruby.mjs > capture.rb && ruby -c capture.rb
 */
import { captureScript } from "../build/tools/capture_view.js";

// Every branch of the generated script: each preset view, each style, both
// formats, and both camera-restore paths.
const COMBINATIONS = [
  { view: "current", zoom: "none", style: "current" },
  { view: "iso", zoom: "extents", style: "xray", format: "jpg", keep_camera: true },
  { view: "top", zoom: "selection", style: "wireframe" },
  { view: "front", zoom: "extents", style: "hidden_line", width: 2000, height: 2000 },
  { view: "bottom", zoom: "none", style: "shaded", width: 256, height: 256 },
  { view: "right", zoom: "extents", style: "textured", format: "jpg" },
];

for (const combination of COMBINATIONS) {
  const args = {
    view: "current",
    zoom: "none",
    style: "current",
    width: 1200,
    height: 900,
    format: "png",
    keep_camera: false,
    ...combination,
  };
  process.stdout.write(`# ${JSON.stringify(combination)}\n`);
  process.stdout.write(captureScript(args));
  process.stdout.write("\n\n");
}
