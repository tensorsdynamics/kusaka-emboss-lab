import * as THREE from "three";
import { strToU8, zipSync } from "fflate";

const CORE_NAMESPACE =
  "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MODEL_RELATIONSHIP =
  "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const IDENTITY_MATRIX_4X4 =
  "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";
const ZIP_EPOCH = new Date("1980-01-01T00:00:00.000Z");

const DEFAULT_OPTIONS = Object.freeze({
  title: "KUSAKA two-filament badge",
  baseName: "Base / Filament 1",
  reliefName: "Relief / Filament 2",
  baseColor: "#E8E0D2",
  reliefColor: "#161514",
});

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeColor(value, fallback) {
  const color = String(value ?? fallback).trim().toUpperCase();
  const match = color.match(/^#?([0-9A-F]{6})([0-9A-F]{2})?$/);
  if (!match) return `${fallback.toUpperCase()}FF`;
  return `#${match[1]}${match[2] ?? "FF"}`;
}

function formatCoordinate(value) {
  if (!Number.isFinite(value)) {
    throw new Error("3MF export received a non-finite coordinate.");
  }

  const rounded = Math.abs(value) < 0.0000005 ? 0 : value;
  return Number(rounded.toFixed(6)).toString();
}

function appendMesh(target, mesh, reusableVertex, adjustVertex) {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!position || position.count < 3) return;

  const vertexOffset = target.vertices.length;
  for (let index = 0; index < position.count; index += 1) {
    reusableVertex
      .fromBufferAttribute(position, index)
      .applyMatrix4(mesh.matrixWorld);
    adjustVertex?.(reusableVertex);
    target.vertices.push([
      reusableVertex.x,
      reusableVertex.y,
      reusableVertex.z,
    ]);
  }

  const geometryIndex = geometry.getIndex();
  const indexCount = geometryIndex?.count ?? position.count;
  const flipsOrientation = mesh.matrixWorld.determinant() < 0;

  for (let offset = 0; offset + 2 < indexCount; offset += 3) {
    const first =
      vertexOffset + (geometryIndex ? geometryIndex.getX(offset) : offset);
    const second =
      vertexOffset +
      (geometryIndex ? geometryIndex.getX(offset + 1) : offset + 1);
    const third =
      vertexOffset +
      (geometryIndex ? geometryIndex.getX(offset + 2) : offset + 2);

    if (first === second || second === third || first === third) continue;
    target.triangles.push(
      flipsOrientation
        ? [first, third, second]
        : [first, second, third],
    );
  }
}

function collectPrintableParts(model) {
  model.updateMatrixWorld(true);
  const base = { vertices: [], triangles: [] };
  const relief = { vertices: [], triangles: [] };
  const reusableVertex = new THREE.Vector3();
  const baseThickness = Number(model.userData?.config?.baseThickness);
  const reliefHeight = Number(model.userData?.config?.reliefHeight);
  const hasSeparationPlane =
    Number.isFinite(baseThickness) && Number.isFinite(reliefHeight);
  const minimumReliefHeight = hasSeparationPlane
    ? Math.min(0.04, Math.max(0.01, reliefHeight * 0.05))
    : 0;
  const separateReliefFromBase = (vertex) => {
    if (!hasSeparationPlane) return;

    if (vertex.z < baseThickness - 0.00001) {
      vertex.z = baseThickness;
    } else if (vertex.z < baseThickness + minimumReliefHeight) {
      vertex.z = baseThickness + minimumReliefHeight;
    }
  };

  model.traverse((object) => {
    if (!object.isMesh || object.visible === false) return;
    const isBase = object.name === "badge-base";
    appendMesh(
      isBase ? base : relief,
      object,
      reusableVertex,
      isBase ? undefined : separateReliefFromBase,
    );
  });

  if (base.triangles.length === 0) {
    throw new Error("3MF export could not find the printable base.");
  }

  return { base, relief };
}

function serializeMeshObject(part, materialResourceId) {
  const vertices = part.mesh.vertices
    .map(
      ([x, y, z]) =>
        `     <vertex x="${formatCoordinate(x)}" y="${formatCoordinate(y)}" z="${formatCoordinate(z)}"/>`,
    )
    .join("\n");
  const triangles = part.mesh.triangles
    .map(
      ([first, second, third]) =>
        `     <triangle v1="${first}" v2="${second}" v3="${third}"/>`,
    )
    .join("\n");

  return `  <object id="${part.id}" type="model" name="${escapeXml(part.name)}" pid="${materialResourceId}" pindex="${part.materialIndex}">
   <mesh>
    <vertices>
${vertices}
    </vertices>
    <triangles>
${triangles}
    </triangles>
   </mesh>
  </object>`;
}

function createModelXml(parts, options) {
  const materialResourceId = 10;
  const parentObjectId = 20;
  const meshObjects = parts
    .map((part) => serializeMeshObject(part, materialResourceId))
    .join("\n");
  const components = parts
    .map((part) => `    <component objectid="${part.id}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="ru-RU" xmlns="${CORE_NAMESPACE}">
 <metadata name="Application">KUSAKA Raster Emboss Lab</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${escapeXml(options.title)}</metadata>
 <metadata name="Description">Two-part emboss: base uses filament 1, relief uses filament 2.</metadata>
 <metadata name="Origin">https://github.com/tensorsdynamics/kusaka-emboss-lab</metadata>
 <resources>
  <basematerials id="${materialResourceId}">
   <base name="${escapeXml(options.baseName)}" displaycolor="${normalizeColor(options.baseColor, DEFAULT_OPTIONS.baseColor)}"/>
   <base name="${escapeXml(options.reliefName)}" displaycolor="${normalizeColor(options.reliefColor, DEFAULT_OPTIONS.reliefColor)}"/>
  </basematerials>
${meshObjects}
  <object id="${parentObjectId}" type="model" name="${escapeXml(options.title)}">
   <components>
${components}
   </components>
  </object>
 </resources>
 <build>
  <item objectid="${parentObjectId}" printable="1"/>
 </build>
</model>
`;
}

function createModelSettingsXml(parts, options) {
  const parentObjectId = 20;
  const totalFaces = parts.reduce(
    (sum, part) => sum + part.mesh.triangles.length,
    0,
  );
  const partSettings = parts
    .map(
      (part) => `    <part id="${part.id}" subtype="normal_part">
      <metadata key="name" value="${escapeXml(part.name)}"/>
      <metadata key="matrix" value="${IDENTITY_MATRIX_4X4}"/>
      <metadata key="extruder" value="${part.extruder}"/>
      <mesh_stat face_count="${part.mesh.triangles.length}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`,
    )
    .join("\n");
  const filamentMap = parts.map((part) => part.extruder).join(" ");
  const filamentVolumeMap = parts.map(() => "1").join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${parentObjectId}">
    <metadata key="name" value="${escapeXml(options.title)}"/>
    <metadata key="extruder" value="1"/>
    <metadata face_count="${totalFaces}"/>
${partSettings}
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="KUSAKA / 2 filaments"/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Manual"/>
    <metadata key="filament_maps" value="${filamentMap}"/>
    <metadata key="filament_volume_maps" value="${filamentVolumeMap}"/>
    <model_instance>
      <metadata key="object_id" value="${parentObjectId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
</config>
`;
}

function createProjectSettings(parts, options) {
  const colors = [
    normalizeColor(options.baseColor, DEFAULT_OPTIONS.baseColor).slice(0, 7),
    normalizeColor(options.reliefColor, DEFAULT_OPTIONS.reliefColor).slice(
      0,
      7,
    ),
  ].slice(0, parts.length);

  return `${JSON.stringify(
    {
      filament_colour: colors,
      filament_settings_id: colors.map(() => ""),
      filament_type: colors.map(() => "PLA"),
      filament_vendor: colors.map(() => "Generic"),
      from: "project",
      name: "project_settings",
      version: "01.09.00.00",
    },
    null,
    2,
  )}\n`;
}

function createContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="application/octet-stream"/>
</Types>
`;
}

function createRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_RELATIONSHIP}"/>
</Relationships>
`;
}

export function exportBambu3MF(model, inputOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  const { base, relief } = collectPrintableParts(model);
  const parts = [
    {
      id: 1,
      name: options.baseName,
      materialIndex: 0,
      extruder: 1,
      mesh: base,
    },
  ];

  if (relief.triangles.length > 0) {
    parts.push({
      id: 2,
      name: options.reliefName,
      materialIndex: 1,
      extruder: 2,
      mesh: relief,
    });
  }

  const files = {
    "[Content_Types].xml": strToU8(createContentTypesXml()),
    "_rels/.rels": strToU8(createRelationshipsXml()),
    "3D/3dmodel.model": strToU8(createModelXml(parts, options)),
    "Metadata/model_settings.config": strToU8(
      createModelSettingsXml(parts, options),
    ),
    "Metadata/project_settings.config": strToU8(
      createProjectSettings(parts, options),
    ),
  };

  return zipSync(files, {
    level: 6,
    mtime: ZIP_EPOCH,
  });
}
