export const DEFAULT_IMAGE_LEVELS = Object.freeze({
  blackPoint: 8,
  whitePoint: 247,
  gamma: 1,
  threshold: 0.5,
  softness: 0.04,
  blur: 0,
  invert: false,
});

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, Number(value)));

export function sanitizeImageLevels(input = {}) {
  const blackPoint = clamp(
    input.blackPoint ?? DEFAULT_IMAGE_LEVELS.blackPoint,
    0,
    254,
  );
  const whitePoint = clamp(
    input.whitePoint ?? DEFAULT_IMAGE_LEVELS.whitePoint,
    blackPoint + 1,
    255,
  );

  return {
    blackPoint,
    whitePoint,
    gamma: clamp(input.gamma ?? DEFAULT_IMAGE_LEVELS.gamma, 0.25, 3),
    threshold: clamp(
      input.threshold ?? DEFAULT_IMAGE_LEVELS.threshold,
      0.02,
      0.98,
    ),
    softness: clamp(
      input.softness ?? DEFAULT_IMAGE_LEVELS.softness,
      0,
      0.35,
    ),
    blur: Math.round(clamp(input.blur ?? DEFAULT_IMAGE_LEVELS.blur, 0, 4)),
    invert: input.invert ?? DEFAULT_IMAGE_LEVELS.invert,
  };
}

export function pixelsToLuminance(
  pixels,
  width,
  height,
  channels = 4,
) {
  const luminance = new Float32Array(width * height);

  for (let index = 0; index < luminance.length; index += 1) {
    const pixelIndex = index * channels;
    const red = pixels[pixelIndex] ?? 0;
    const green = pixels[pixelIndex + 1] ?? red;
    const blue = pixels[pixelIndex + 2] ?? red;
    const alpha = channels > 3 ? (pixels[pixelIndex + 3] ?? 255) / 255 : 1;
    const value = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    luminance[index] = value * alpha;
  }

  return luminance;
}

function boxBlur(values, width, height, radius) {
  if (radius <= 0) return new Float32Array(values);

  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let samples = 0;

      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + offset));
        sum += values[y * width + sampleX];
        samples += 1;
      }

      horizontal[y * width + x] = sum / samples;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let samples = 0;

      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offset));
        sum += horizontal[sampleY * width + x];
        samples += 1;
      }

      output[y * width + x] = sum / samples;
    }
  }

  return output;
}
function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge0 ? 1 : 0;
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

export function processLuminanceGrid(
  luminance,
  width,
  height,
  input = {},
) {
  const levels = sanitizeImageLevels(input);
  const blurred = boxBlur(luminance, width, height, levels.blur);
  const output = new Float32Array(blurred.length);
  const black = levels.blackPoint / 255;
  const white = levels.whitePoint / 255;
  const range = Math.max(1 / 255, white - black);

  for (let index = 0; index < blurred.length; index += 1) {
    const leveled = clamp((blurred[index] - black) / range, 0, 1);
    const corrected = Math.pow(leveled, 1 / levels.gamma);
    const thresholded =
      levels.softness <= 0.001
        ? corrected >= levels.threshold
          ? 1
          : 0
        : smoothstep(
            levels.threshold - levels.softness,
            levels.threshold + levels.softness,
            corrected,
          );
    output[index] = levels.invert ? 1 - thresholded : thresholded;
  }

  return output;
}
