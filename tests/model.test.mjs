import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import * as THREE from "three";
import {
  processLuminanceGrid,
} from "../src/image-processing.js";
import {
  createBadgeModel,
  DEFAULT_BADGE_CONFIG,
  disposeBadgeModel,
} from "../src/model-core.js";
import { exportBambu3MF } from "../src/three-mf-exporter.js";

function roundedSize(model) {
  const size = new THREE.Box3()
    .setFromObject(model)
    .getSize(new THREE.Vector3());
  return size.toArray().map((value) => Number(value.toFixed(4)));
}

function countUnexpectedEdges(mesh) {
  const geometry = mesh.geometry.index
    ? mesh.geometry.toNonIndexed()
    : mesh.geometry;
  const position = geometry.getAttribute("position");
  const edges = new Map();
  const vertexKey = (index) =>
    [position.getX(index), position.getY(index), position.getZ(index)]
      .map((value) => Math.round(value * 100_000))
      .join(",");

  for (let index = 0; index < position.count; index += 3) {
    const vertices = [
      vertexKey(index),
      vertexKey(index + 1),
      vertexKey(index + 2),
    ];

    for (const [start, end] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const edge =
        vertices[start] < vertices[end]
          ? `${vertices[start]}|${vertices[end]}`
          : `${vertices[end]}|${vertices[start]}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }

  if (geometry !== mesh.geometry) geometry.dispose();
  return [...edges.values()].filter((count) => count !== 2).length;
}

function makeHeightField(width = 24, height = 24) {
  const data = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - (width - 1) / 2;
      const dy = y - (height - 1) / 2;
      data[y * width + x] = Math.hypot(dx, dy) < width * 0.3 ? 1 : 0;
    }
  }

  return { data, width, height };
}

function countCoplanarReliefTriangles(model, baseThickness) {
  const relief = model.getObjectByName("image-heightfield");
  const geometry = relief.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  let count = 0;

  for (let offset = 0; offset < index.count; offset += 3) {
    const heights = [
      position.getZ(index.getX(offset)),
      position.getZ(index.getX(offset + 1)),
      position.getZ(index.getX(offset + 2)),
    ];

    if (
      heights.every(
        (height) => Math.abs(height - baseThickness) < 0.000_001,
      )
    ) {
      count += 1;
    }
  }

  return count;
}

function assertClosedMeshes(config, expectedSize) {
  const model = createBadgeModel(config, {}, makeHeightField());
  model.updateMatrixWorld(true);
  assert.deepEqual(roundedSize(model), expectedSize);
  assert.equal(
    countCoplanarReliefTriangles(model, config.baseThickness),
    0,
    "flat image background must not overlap the badge top",
  );

  const failures = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const unexpectedEdges = countUnexpectedEdges(object);
    if (unexpectedEdges > 0) {
      failures.push(`${object.name}: ${unexpectedEdges}`);
    }
  });

  assert.deepEqual(failures, []);
  disposeBadgeModel(model);
}

test("creates closed printable shells at the default and slider limits", () => {
  assertClosedMeshes(DEFAULT_BADGE_CONFIG, [88, 88, 3.2]);
  assertClosedMeshes(
    {
      ...DEFAULT_BADGE_CONFIG,
      diameter: 60,
      baseThickness: 1.6,
      reliefHeight: 0.4,
      rimWidth: 1.6,
      logoScale: 0.68,
    },
    [60, 60, 2],
  );
  assertClosedMeshes(
    {
      ...DEFAULT_BADGE_CONFIG,
      diameter: 120,
      baseThickness: 4,
      reliefHeight: 2.4,
      rimWidth: 5,
      logoScale: 0.92,
      imageOffsetX: 0.05,
      imageOffsetY: -0.05,
      includeRing: false,
    },
    [120, 120, 6.4],
  );
});

test("applies threshold, softness, and dark-as-relief inversion", () => {
  const luminance = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
  const binary = processLuminanceGrid(luminance, 5, 1, {
    blackPoint: 0,
    whitePoint: 255,
    gamma: 1,
    threshold: 0.5,
    softness: 0,
    blur: 0,
    invert: false,
  });
  assert.deepEqual([...binary], [0, 0, 1, 1, 1]);

  const inverted = processLuminanceGrid(luminance, 5, 1, {
    blackPoint: 0,
    whitePoint: 255,
    gamma: 1,
    threshold: 0.5,
    softness: 0,
    blur: 0,
    invert: true,
  });
  assert.deepEqual([...inverted], [1, 1, 0, 0, 0]);
});

test("interpolates the printable contour between raster samples", () => {
  const data = new Float32Array(9);
  data[4] = 1;
  const config = {
    ...DEFAULT_BADGE_CONFIG,
    includeRing: false,
  };
  const model = createBadgeModel(config, {}, {
    data,
    width: 3,
    height: 3,
  });
  const relief = model.getObjectByName("image-heightfield");
  const position = relief.geometry.getAttribute("position");
  const halfImageSize =
    ((config.diameter / Math.SQRT2) * config.logoScale) / 2;
  const sampledCoordinates = [-halfImageSize, 0, halfImageSize];
  const isSampleCoordinate = (value) =>
    sampledCoordinates.some(
      (coordinate) => Math.abs(value - coordinate) < 0.000_01,
    );
  let hasInterpolatedVertex = false;

  for (let index = 0; index < position.count; index += 1) {
    if (
      !isSampleCoordinate(position.getX(index)) ||
      !isSampleCoordinate(position.getY(index))
    ) {
      hasInterpolatedVertex = true;
      break;
    }
  }

  assert.equal(hasInterpolatedVertex, true);
  assert.equal(countUnexpectedEdges(relief), 0);
  disposeBadgeModel(model);
});

test("exports a deterministic two-filament 3MF for Bambu Studio", () => {
  const model = createBadgeModel(
    {
      ...DEFAULT_BADGE_CONFIG,
      includeRing: true,
    },
    {},
    makeHeightField(16, 16),
  );
  const first = exportBambu3MF(model);
  const second = exportBambu3MF(model);
  assert.deepEqual(first, second);
  assert.equal(String.fromCharCode(...first.subarray(0, 2)), "PK");

  const archive = unzipSync(first);
  assert.deepEqual(Object.keys(archive).sort(), [
    "3D/3dmodel.model",
    "Metadata/model_settings.config",
    "Metadata/project_settings.config",
    "[Content_Types].xml",
    "_rels/.rels",
  ]);

  const coreModel = strFromU8(archive["3D/3dmodel.model"]);
  const modelSettings = strFromU8(
    archive["Metadata/model_settings.config"],
  );
  const projectSettings = JSON.parse(
    strFromU8(archive["Metadata/project_settings.config"]),
  );

  assert.match(coreModel, /<basematerials id="10">/);
  assert.match(coreModel, /object id="1"[^>]+pindex="0"/);
  assert.match(coreModel, /object id="2"[^>]+pindex="1"/);
  assert.match(coreModel, /<component objectid="1"\/>/);
  assert.match(coreModel, /<component objectid="2"\/>/);
  assert.match(coreModel, /<item objectid="20" printable="1"\/>/);
  const baseObject = coreModel.match(
    /<object id="1"[\s\S]*?<\/object>/,
  )?.[0];
  const reliefObject = coreModel.match(
    /<object id="2"[\s\S]*?<\/object>/,
  )?.[0];
  assert.ok(baseObject);
  assert.ok(reliefObject);
  const readHeights = (xml) =>
    [...xml.matchAll(/<vertex [^>]*z="([^"]+)"/g)].map((match) =>
      Number(match[1]),
    );
  const baseHeights = readHeights(baseObject);
  const reliefHeights = readHeights(reliefObject);
  assert.equal(Math.max(...baseHeights), DEFAULT_BADGE_CONFIG.baseThickness);
  assert.equal(Math.min(...reliefHeights), DEFAULT_BADGE_CONFIG.baseThickness);
  assert.match(modelSettings, /<part id="1" subtype="normal_part">/);
  assert.match(modelSettings, /key="extruder" value="1"/);
  assert.match(modelSettings, /<part id="2" subtype="normal_part">/);
  assert.match(modelSettings, /key="extruder" value="2"/);
  assert.match(modelSettings, /key="filament_maps" value="1 2"/);
  assert.match(
    modelSettings,
    /key="filament_volume_maps" value="1 1"/,
  );
  assert.deepEqual(projectSettings.filament_colour, [
    "#E8E0D2",
    "#161514",
  ]);
  assert.deepEqual(projectSettings.filament_type, ["PLA", "PLA"]);

  disposeBadgeModel(model);
});

test("ships non-empty default 3MF, STL, OBJ, and raster assets", async () => {
  const [threeMf, stl, obj, png] = await Promise.all([
    readFile(
      new URL("../public/models/kusaka-badge-88mm.3mf", import.meta.url),
    ),
    readFile(new URL("../public/models/kusaka-badge-88mm.stl", import.meta.url)),
    readFile(
      new URL("../public/models/kusaka-badge-88mm.obj", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../public/models/kusaka-emboss-source.png", import.meta.url),
    ),
  ]);

  const archive = unzipSync(threeMf);
  assert.ok(archive["3D/3dmodel.model"].length > 100_000);
  assert.match(
    strFromU8(archive["Metadata/model_settings.config"]),
    /key="filament_maps" value="1 2"/,
  );
  assert.ok(stl.length > 84);
  assert.ok(stl.readUInt32LE(80) > 100_000);
  assert.match(obj, /^o badge-base$/m);
  assert.match(obj, /^o image-heightfield$/m);
  assert.match(obj, /^f /m);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
});
