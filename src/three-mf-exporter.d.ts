import type * as THREE from "three";

export type ThreeMfExportOptions = {
  title?: string;
  baseName?: string;
  reliefName?: string;
  baseColor?: string;
  reliefColor?: string;
};

export function exportBambu3MF(
  model: THREE.Object3D,
  options?: ThreeMfExportOptions,
): Uint8Array;
