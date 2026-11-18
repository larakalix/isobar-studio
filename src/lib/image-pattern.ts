import { CANVAS_HEIGHT, CANVAS_WIDTH } from './pattern';
import type { PressureGrid } from './pressure';

export const IMAGE_SMOOTHING = { min: 0, max: 100, initial: 28 };
export const MAX_CROP_TRIM = 90;
export const IMAGE_ACCEPT =
  '.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp';
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_SOURCE_EDGE = 960;
const WIDTH = 161;
const HEIGHT = 100;
const x = Array.from({ length: WIDTH }, (_, index) => index);
const y = Array.from({ length: HEIGHT }, (_, index) => index);

export type ImageCrop = [left: number, top: number, right: number, bottom: number];
export type ImageSource = Awaited<ReturnType<typeof readImage>>;

export function imageCropBounds(
  width: number,
  height: number,
  [left, top, right, bottom]: ImageCrop,
) {
  return {
    x: (width * left) / 100,
    y: (height * top) / 100,
    width: (width * (100 - left - right)) / 100,
    height: (height * (100 - top - bottom)) / 100,
  };
}

function canvas(width: number, height: number, readPixels = true) {
  const node = document.createElement('canvas');
  node.width = width;
  node.height = height;
  return { node, context: node.getContext('2d', { willReadFrequently: readPixels })! };
}

function silhouette(source: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  const border = new Map<number, { count: number; red: number; green: number; blue: number }>();
  let transparent = 0;
  let lowestAlpha = 255;
  let highestAlpha = 0;
  let edgePixels = 0;

  function sampleBorder(offset: number) {
    const [red, green, blue, alpha] = pixels.subarray(offset, offset + 4);
    edgePixels += 1;
    if (alpha < 224) transparent += 1;
    const key = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4);
    const sample = border.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    sample.count += 1;
    sample.red += red;
    sample.green += green;
    sample.blue += blue;
    border.set(key, sample);
  }

  for (let column = 0; column < width; column += 1) {
    sampleBorder(column * 4);
    sampleBorder(((height - 1) * width + column) * 4);
  }
  for (let row = 1; row < height - 1; row += 1) {
    sampleBorder(row * width * 4);
    sampleBorder((row * width + width - 1) * 4);
  }

  for (let offset = 3; offset < pixels.length; offset += 4) {
    lowestAlpha = Math.min(lowestAlpha, pixels[offset]);
    highestAlpha = Math.max(highestAlpha, pixels[offset]);
  }

  const mode = [...border.values()].reduce((best, sample) =>
    sample.count > best.count ? sample : best,
  );
  const red = mode.red / mode.count;
  const green = mode.green / mode.count;
  const blue = mode.blue / mode.count;
  // Use alpha for transparent artwork. For opaque images, use the dominant edge color as the background.
  const useAlpha = transparent > edgePixels * 0.12 && highestAlpha - lowestAlpha > 16;
  const strengths = new Float32Array(width * height);
  let peak = 0;
  for (let index = 0; index < strengths.length; index += 1) {
    const offset = index * 4;
    const alpha = pixels[offset + 3];
    const colorDistance = Math.hypot(
      pixels[offset] - red,
      pixels[offset + 1] - green,
      pixels[offset + 2] - blue,
    );
    const strength = useAlpha
      ? alpha - lowestAlpha
      : Math.max((colorDistance * alpha) / 255, highestAlpha - alpha);
    strengths[index] = strength;
    peak = Math.max(peak, strength);
  }
  if (peak < 14)
    throw new Error(
      'No silhouette found. Choose a logo with transparency or a contrasting background.',
    );

  const mask = canvas(width, height, false);
  const data = mask.context.createImageData(width, height);
  const threshold = Math.max(12, peak * 0.38);
  for (let index = 0; index < strengths.length; index += 1) {
    const opacity = (strengths[index] - threshold) / (peak * 0.36) + 0.5;
    data.data[index * 4 + 3] = Math.round(opacity * 255);
  }
  mask.context.putImageData(data, 0, 0);
  return mask.node;
}

export async function readImage(file: File) {
  if (
    !/\.(?:svg|png|jpe?g|webp)$/i.test(file.name) &&
    !/^image\/(?:svg\+xml|png|jpeg|webp)$/.test(file.type)
  ) {
    throw new Error('Choose a PNG, SVG, JPG, or WebP image.');
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES)
    throw new Error('Choose an image up to 12 MB.');

  // Decode SVGs in the browser's image mode and retain only raster pixels.
  const blob =
    /\.svg$/i.test(file.name) && file.type !== 'image/svg+xml'
      ? new Blob([file], { type: 'image/svg+xml' })
      : file;
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Missing image dimensions');
    const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const { node, context } = canvas(
      Math.max(1, Math.round(image.naturalWidth * scale)),
      Math.max(1, Math.round(image.naturalHeight * scale)),
    );
    context.drawImage(image, 0, 0, node.width, node.height);
    return { preview: node, mask: silhouette(node, context) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No silhouette')) throw error;
    throw new Error('Could not read this image. Try a different file.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function squaredDistance(mask: Uint8Array, target: number) {
  const work = new Float64Array(mask.length);
  const costs = new Float64Array(Math.max(WIDTH, HEIGHT));
  const sites = new Int32Array(costs.length);
  const boundaries = new Float64Array(costs.length + 1);

  // Compute the lower envelope of squared distances along each grid axis.
  // See Felzenszwalb and Huttenlocher, Distance Transforms of Sampled Functions.
  function transform(start: number, length: number, stride: number) {
    for (let index = 0; index < length; index += 1) costs[index] = work[start + index * stride];
    let last = 0;
    sites[0] = 0;
    boundaries[0] = -Infinity;
    boundaries[1] = Infinity;
    for (let site = 1; site < length; site += 1) {
      let boundary: number;
      while (true) {
        const previous = sites[last];
        boundary =
          (costs[site] + site ** 2 - costs[previous] - previous ** 2) / (2 * (site - previous));
        if (boundary > boundaries[last]) break;
        last -= 1;
      }
      last += 1;
      sites[last] = site;
      boundaries[last] = boundary;
      boundaries[last + 1] = Infinity;
    }
    last = 0;
    for (let index = 0; index < length; index += 1) {
      while (boundaries[last + 1] < index) last += 1;
      work[start + index * stride] = (index - sites[last]) ** 2 + costs[sites[last]];
    }
  }

  for (let index = 0; index < mask.length; index += 1)
    work[index] = mask[index] === target ? 0 : 1e8;
  for (let row = 0; row < HEIGHT; row += 1) transform(row * WIDTH, WIDTH, 1);
  for (let column = 0; column < WIDTH; column += 1) transform(column, HEIGHT, WIDTH);
  return work;
}

export function imageDistances(source: ImageSource, crop: ImageCrop) {
  const { mask } = source;
  const bounds = imageCropBounds(mask.width, mask.height, crop);
  // Inset the silhouette to leave room for contours outside its edge.
  const scale = 0.72 * Math.min(CANVAS_WIDTH / bounds.width, CANVAS_HEIGHT / bounds.height);
  const width = (bounds.width * scale * WIDTH) / CANVAS_WIDTH;
  const height = (bounds.height * scale * HEIGHT) / CANVAS_HEIGHT;
  const { context } = canvas(WIDTH, HEIGHT);
  context.drawImage(
    mask,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    (WIDTH - width) / 2,
    (HEIGHT - height) / 2,
    width,
    height,
  );
  const rgba = context.getImageData(0, 0, WIDTH, HEIGHT).data;
  const bins = new Uint8Array(WIDTH * HEIGHT);
  for (let row = 0; row < HEIGHT; row += 1) {
    for (let column = 0; column < WIDTH; column += 1) {
      bins[row * WIDTH + column] =
        rgba[((HEIGHT - row - 1) * WIDTH + column) * 4 + 3] >= 128 ? 1 : 0;
    }
  }
  if (!bins.includes(1)) return new Float64Array(bins.length);

  // Signed distances let contour levels follow both sides of the silhouette boundary.
  const inside = squaredDistance(bins, 0);
  const outside = squaredDistance(bins, 1);
  return inside.map((distance, index) =>
    bins[index] ? Math.sqrt(distance) - 0.5 : 0.5 - Math.sqrt(outside[index]),
  );
}

function smoothDistances(source: Float64Array, span: number) {
  if (span === 0) return source;
  const horizontal = new Float64Array(source.length);
  const vertical = new Float64Array(source.length);
  const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, value));
  const radius = Math.ceil(span);
  // A fractional weight on the outer samples keeps the smoothing slider continuous.
  const edgeWeight = span - radius + 1;
  const weight = 1 / (span * 2 + 1);
  let field = source;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let column = 0; column < WIDTH; column += 1) {
        const start = row * WIDTH;
        let sum =
          edgeWeight *
          (field[start + clamp(column - radius, WIDTH)] +
            field[start + clamp(column + radius, WIDTH)]);
        for (let d = 1 - radius; d < radius; d += 1) sum += field[start + clamp(column + d, WIDTH)];
        horizontal[row * WIDTH + column] = sum * weight;
      }
    }
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let column = 0; column < WIDTH; column += 1) {
        let sum =
          edgeWeight *
          (horizontal[clamp(row - radius, HEIGHT) * WIDTH + column] +
            horizontal[clamp(row + radius, HEIGHT) * WIDTH + column]);
        for (let d = 1 - radius; d < radius; d += 1)
          sum += horizontal[clamp(row + d, HEIGHT) * WIDTH + column];
        vertical[row * WIDTH + column] = sum * weight;
      }
    }
    field = vertical;
  }
  return field;
}

export function imagePressureGrid(distances: Float64Array, smoothing: number): PressureGrid {
  const smoothed = smoothDistances(distances, smoothing / 14);
  const top = Math.max(8, ...smoothed);
  const values = Array.from(smoothed, (distance) =>
    distance > 0 ? distance / top : Math.max(-0.9, distance / 15),
  );
  return { x, y, values };
}
