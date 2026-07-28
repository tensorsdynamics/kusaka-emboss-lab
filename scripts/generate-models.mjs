import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import {
  DEFAULT_IMAGE_LEVELS,
  pixelsToLuminance,
  processLuminanceGrid,
} from "../src/image-processing.js";
import {
  createBadgeModel,
  DEFAULT_BADGE_CONFIG,
  disposeBadgeModel,
} from "../src/model-core.js";
import { exportBambu3MF } from "../src/three-mf-exporter.js";

const outputDirectory = resolve("public/models");
const sourceImage = resolve("public/models/kusaka-emboss-source.png");
const resolution = 384;
const { data: pixels, info } = await sharp(sourceImage)
  .resize(resolution, resolution, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const luminance = pixelsToLuminance(
  pixels,
  info.width,
  info.height,
  info.channels,
);
const heightField = {
  data: processLuminanceGrid(
    luminance,
    info.width,
    info.height,
    DEFAULT_IMAGE_LEVELS,
  ),
  width: info.width,
  height: info.height,
};
const model = createBadgeModel(DEFAULT_BADGE_CONFIG, {}, heightField);
model.updateMatrixWorld(true);

const stl = new STLExporter().parse(model, { binary: true });
const obj = new OBJExporter().parse(model);
const threeMf = exportBambu3MF(model, {
  title: "KUSAKA emboss 88 mm",
});

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(outputDirectory, "kusaka-badge-88mm.stl"),
    Buffer.from(stl.buffer, stl.byteOffset, stl.byteLength),
  ),
  writeFile(resolve(outputDirectory, "kusaka-badge-88mm.obj"), obj, "utf8"),
  writeFile(resolve(outputDirectory, "kusaka-badge-88mm.3mf"), threeMf),
]);

disposeBadgeModel(model);

console.log(
  "KUSAKA: созданы 3MF/STL/OBJ, шильдик 88 мм, общая высота 3,2 мм.",
);
