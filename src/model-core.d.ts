import type * as THREE from "three";

export type BadgeConfig = {
  diameter: number;
  baseThickness: number;
  reliefHeight: number;
  rimWidth: number;
  logoScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  includeRing: boolean;
};

export type HeightField = {
  data: Float32Array;
  width: number;
  height: number;
};

export const DEFAULT_BADGE_CONFIG: Readonly<BadgeConfig>;

export function sanitizeBadgeConfig(input?: Partial<BadgeConfig>): BadgeConfig;

export function createBadgeModel(
  input?: Partial<BadgeConfig>,
  materialOverrides?: {
    base?: THREE.Material;
    relief?: THREE.Material;
  },
  heightField?: HeightField | null,
): THREE.Group;

export function getBadgeStats(
  input?: Partial<BadgeConfig>,
  heightFieldWidth?: number,
): BadgeConfig & {
  totalHeight: number;
  imageSize: number;
  cellSize: number;
  filamentSwapHeight: number;
};

export function disposeBadgeModel(model: THREE.Object3D): void;
