export type ImageLevels = {
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  threshold: number;
  softness: number;
  blur: number;
  invert: boolean;
};

export const DEFAULT_IMAGE_LEVELS: Readonly<ImageLevels>;

export function sanitizeImageLevels(input?: Partial<ImageLevels>): ImageLevels;

export function pixelsToLuminance(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  channels?: number,
): Float32Array;

export function processLuminanceGrid(
  luminance: Float32Array,
  width: number,
  height: number,
  input?: Partial<ImageLevels>,
): Float32Array;
