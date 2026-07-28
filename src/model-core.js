import * as THREE from "three";

export const DEFAULT_BADGE_CONFIG = Object.freeze({
  diameter: 88,
  baseThickness: 2.4,
  reliefHeight: 0.8,
  rimWidth: 2.8,
  logoScale: 0.92,
  imageOffsetX: 0,
  imageOffsetY: 0,
  includeRing: true,
});

const LIMITS = Object.freeze({
  diameter: [60, 120],
  baseThickness: [1.6, 4],
  reliefHeight: [0.4, 2.4],
  rimWidth: [1.6, 5],
  logoScale: [0.58, 0.92],
  imageOffsetX: [-0.05, 0.05],
  imageOffsetY: [-0.05, 0.05],
});

const clamp = (value, [minimum, maximum]) =>
  Math.min(maximum, Math.max(minimum, Number(value)));

export function sanitizeBadgeConfig(input = {}) {
  return {
    diameter: clamp(
      input.diameter ?? DEFAULT_BADGE_CONFIG.diameter,
      LIMITS.diameter,
    ),
    baseThickness: clamp(
      input.baseThickness ?? DEFAULT_BADGE_CONFIG.baseThickness,
      LIMITS.baseThickness,
    ),
    reliefHeight: clamp(
      input.reliefHeight ?? DEFAULT_BADGE_CONFIG.reliefHeight,
      LIMITS.reliefHeight,
    ),
    rimWidth: clamp(
      input.rimWidth ?? DEFAULT_BADGE_CONFIG.rimWidth,
      LIMITS.rimWidth,
    ),
    logoScale: clamp(
      input.logoScale ?? DEFAULT_BADGE_CONFIG.logoScale,
      LIMITS.logoScale,
    ),
    imageOffsetX: clamp(
      input.imageOffsetX ?? DEFAULT_BADGE_CONFIG.imageOffsetX,
      LIMITS.imageOffsetX,
    ),
    imageOffsetY: clamp(
      input.imageOffsetY ?? DEFAULT_BADGE_CONFIG.imageOffsetY,
      LIMITS.imageOffsetY,
    ),
    includeRing: input.includeRing ?? DEFAULT_BADGE_CONFIG.includeRing,
  };
}

function makeRaisedMesh(
  shape,
  depth,
  z,
  material,
  name,
  curveSegments = 12,
) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments,
    depth,
    steps: 1,
  });
  geometry.translate(0, 0, z);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createMaterials(overrides = {}) {
  const base =
    overrides.base ??
    new THREE.MeshStandardMaterial({
      color: 0xe8e0d2,
      roughness: 0.58,
      metalness: 0.02,
    });
  base.name = "warm-white-base";

  const relief =
    overrides.relief ??
    new THREE.MeshStandardMaterial({
      color: 0x161514,
      roughness: 0.5,
      metalness: 0.04,
    });
  relief.name = "black-relief";

  return { base, relief };
}

function createHeightFieldGeometry(heightField, config, overlap) {
  const width = Math.max(2, Math.floor(heightField.width));
  const height = Math.max(2, Math.floor(heightField.height));
  const values = heightField.data;

  if (!values || values.length < width * height) {
    throw new Error("Heightfield data does not match its dimensions.");
  }

  const sourceVertexCount = width * height;
  const sourceStrengths = new Float32Array(sourceVertexCount);
  const safeSquare = (config.diameter / Math.SQRT2) * config.logoScale;
  const offsetX = config.diameter * config.imageOffsetX;
  const offsetY = config.diameter * config.imageOffsetY;
  const bottomZ = config.baseThickness - overlap;
  const contourLevel = 0.025;
  const topVertices = [];
  const vertexLookup = new Map();
  const topTriangles = [];

  for (let index = 0; index < sourceVertexCount; index += 1) {
    sourceStrengths[index] = Math.min(
      1,
      Math.max(0, Number(values[index])),
    );
  }

  const sourcePoint = (sourceIndex) => {
    const x = sourceIndex % width;
    const y = Math.floor(sourceIndex / width);
    const horizontal = x / (width - 1);
    const vertical = y / (height - 1);
    return {
      x: (horizontal - 0.5) * safeSquare + offsetX,
      y: (0.5 - vertical) * safeSquare + offsetY,
      u: horizontal,
      v: 1 - vertical,
    };
  };

  const addTopVertex = (key, point, strength) => {
    const existing = vertexLookup.get(key);
    if (existing !== undefined) return existing;

    const index = topVertices.length;
    topVertices.push({ ...point, strength });
    vertexLookup.set(key, index);
    return index;
  };

  const getSourceVertex = (sourceIndex) => {
    const remappedStrength = Math.min(
      1,
      Math.max(
        0,
        (sourceStrengths[sourceIndex] - contourLevel) /
          (1 - contourLevel),
      ),
    );
    return addTopVertex(
      `v:${sourceIndex}`,
      sourcePoint(sourceIndex),
      remappedStrength,
    );
  };

  const getEdgeVertex = (sourceStart, sourceEnd) => {
    const low = Math.min(sourceStart, sourceEnd);
    const high = Math.max(sourceStart, sourceEnd);
    const key = `e:${low}:${high}`;
    const existing = vertexLookup.get(key);
    if (existing !== undefined) return existing;

    const lowStrength = sourceStrengths[low];
    const highStrength = sourceStrengths[high];
    const denominator = highStrength - lowStrength;
    const interpolation =
      Math.abs(denominator) < 1e-8
        ? 0.5
        : Math.min(
            1,
            Math.max(0, (contourLevel - lowStrength) / denominator),
          );
    const lowPoint = sourcePoint(low);
    const highPoint = sourcePoint(high);

    return addTopVertex(
      key,
      {
        x: lowPoint.x + (highPoint.x - lowPoint.x) * interpolation,
        y: lowPoint.y + (highPoint.y - lowPoint.y) * interpolation,
        u: lowPoint.u + (highPoint.u - lowPoint.u) * interpolation,
        v: lowPoint.v + (highPoint.v - lowPoint.v) * interpolation,
      },
      0,
    );
  };

  const addClippedTriangle = (sourceIndices) => {
    const inside = sourceIndices.map(
      (sourceIndex) => sourceStrengths[sourceIndex] > contourLevel,
    );

    if (!inside.some(Boolean)) {
      return;
    }

    if (inside.every(Boolean)) {
      topTriangles.push(sourceIndices.map(getSourceVertex));
      return;
    }

    const polygon = [];

    for (let index = 0; index < sourceIndices.length; index += 1) {
      const previousIndex =
        sourceIndices[(index + sourceIndices.length - 1) % sourceIndices.length];
      const currentIndex = sourceIndices[index];
      const previousInside =
        sourceStrengths[previousIndex] > contourLevel;
      const currentInside = sourceStrengths[currentIndex] > contourLevel;

      if (currentInside) {
        if (!previousInside) {
          polygon.push(getEdgeVertex(previousIndex, currentIndex));
        }
        polygon.push(getSourceVertex(currentIndex));
      } else if (previousInside) {
        polygon.push(getEdgeVertex(previousIndex, currentIndex));
      }
    }

    const compactPolygon = polygon.filter(
      (vertex, index) =>
        index === 0 || vertex !== polygon[index - 1],
    );
    if (
      compactPolygon.length > 2 &&
      compactPolygon[0] === compactPolygon[compactPolygon.length - 1]
    ) {
      compactPolygon.pop();
    }

    for (let index = 1; index < compactPolygon.length - 1; index += 1) {
      const triangle = [
        compactPolygon[0],
        compactPolygon[index],
        compactPolygon[index + 1],
      ];
      const [first, second, third] = triangle.map(
        (vertexIndex) => topVertices[vertexIndex],
      );
      const signedArea =
        (second.x - first.x) * (third.y - first.y) -
        (second.y - first.y) * (third.x - first.x);

      if (
        Math.abs(signedArea) > 1e-10 &&
        Math.max(first.strength, second.strength, third.strength) > 1e-6
      ) {
        topTriangles.push(triangle);
      }
    }
  };

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const topLeft = y * width + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + width;
      const bottomRight = bottomLeft + 1;

      addClippedTriangle([topLeft, bottomLeft, topRight]);
      addClippedTriangle([topRight, bottomLeft, bottomRight]);
    }
  }

  const layerVertexCount = topVertices.length;
  const positions = new Float32Array(layerVertexCount * 2 * 3);
  const uvs = new Float32Array(layerVertexCount * 2 * 2);

  topVertices.forEach((vertex, index) => {
    const bottomIndex = layerVertexCount + index;
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] =
      config.baseThickness + config.reliefHeight * vertex.strength;
    positions[bottomIndex * 3] = vertex.x;
    positions[bottomIndex * 3 + 1] = vertex.y;
    positions[bottomIndex * 3 + 2] = bottomZ;
    uvs[index * 2] = vertex.u;
    uvs[index * 2 + 1] = vertex.v;
    uvs[bottomIndex * 2] = vertex.u;
    uvs[bottomIndex * 2 + 1] = vertex.v;
  });

  const indices = [];
  const boundaryEdges = new Map();
  const addBoundaryCandidate = (start, end) => {
    const key = start < end ? `${start}:${end}` : `${end}:${start}`;
    const existing = boundaryEdges.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      boundaryEdges.set(key, { start, end, count: 1 });
    }
  };

  topTriangles.forEach(([first, second, third]) => {
    indices.push(first, second, third);
    indices.push(
      layerVertexCount + first,
      layerVertexCount + third,
      layerVertexCount + second,
    );
    addBoundaryCandidate(first, second);
    addBoundaryCandidate(second, third);
    addBoundaryCandidate(third, first);
  });

  boundaryEdges.forEach(({ start: topStart, end: topEnd, count }) => {
    if (count !== 1) return;
    const bottomStart = layerVertexCount + topStart;
    const bottomEnd = layerVertexCount + topEnd;
    indices.push(topStart, bottomStart, topEnd);
    indices.push(topEnd, bottomStart, bottomEnd);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (indices.length > 0) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

function createHeightFieldMesh(
  heightField,
  config,
  overlap,
  material,
) {
  const geometry = createHeightFieldGeometry(heightField, config, overlap);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "image-heightfield";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createBadgeModel(
  input = {},
  materialOverrides = {},
  heightField = null,
) {
  const config = sanitizeBadgeConfig(input);
  const materials = createMaterials(materialOverrides);
  const group = new THREE.Group();
  group.name = "KUSAKA-badge";

  const radius = config.diameter / 2;
  const baseGeometry = new THREE.CylinderGeometry(
    radius,
    radius,
    config.baseThickness,
    192,
    1,
    false,
  );
  baseGeometry.rotateX(Math.PI / 2);
  baseGeometry.translate(0, 0, config.baseThickness / 2);
  baseGeometry.computeVertexNormals();

  const base = new THREE.Mesh(baseGeometry, materials.base);
  base.name = "badge-base";
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const overlap = Math.min(0.06, config.reliefHeight * 0.12);
  const raisedZ = config.baseThickness - overlap;
  const raisedDepth = config.reliefHeight + overlap;

  if (config.includeRing) {
    const ringInset = Math.max(1.35, config.diameter * 0.018);
    const outerRadius = radius - ringInset;
    const innerRadius = Math.max(outerRadius - config.rimWidth, 1);
    const ring = new THREE.Shape();
    ring.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);

    const ringHole = new THREE.Path();
    ringHole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    ring.holes.push(ringHole);

    group.add(
      makeRaisedMesh(
        ring,
        raisedDepth,
        raisedZ,
        materials.relief,
        "raised-border",
        64,
      ),
    );
  }

  if (heightField) {
    group.add(
      createHeightFieldMesh(
        heightField,
        config,
        overlap,
        materials.relief,
      ),
    );
  }

  group.userData.config = config;
  group.userData.heightField = heightField;
  group.userData.materials = materials;
  group.updateMatrixWorld(true);
  return group;
}

export function getBadgeStats(input = {}, heightFieldWidth = 128) {
  const config = sanitizeBadgeConfig(input);
  const totalHeight = config.baseThickness + config.reliefHeight;
  const imageSize = (config.diameter / Math.SQRT2) * config.logoScale;
  const cellSize = imageSize / Math.max(1, heightFieldWidth - 1);

  return {
    ...config,
    totalHeight,
    imageSize,
    cellSize,
    filamentSwapHeight: config.baseThickness,
  };
}

export function disposeBadgeModel(model) {
  const materials = new Set();

  model.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();

    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });

  materials.forEach((material) => material?.dispose());
}
