import { contours } from 'd3-contour';
import type { Point, PressureGrid } from './pressure';

export const PATTERN_VIEWS = { flat: 'Flat', '3d': '3D', kaleidoscope: 'Kaleidoscope' } as const;
export type PatternView = keyof typeof PATTERN_VIEWS;

export function readPatternView(value: string | null): PatternView {
  return value === '3d' || value === 'kaleidoscope' ? value : 'flat';
}

interface ContourSection {
  points: Point[];
  closed: boolean;
}

function clipSegment(
  from: Point,
  to: Point,
  minimum: Point,
  maximum: Point,
): [Point, Point] | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  let start = 0;
  let end = 1;

  for (const [axis, distance] of [dx, dy].entries()) {
    if (distance === 0) {
      if (from[axis] < minimum[axis] || from[axis] > maximum[axis]) return null;
      continue;
    }
    const entry = (minimum[axis] - from[axis]) / distance;
    const exit = (maximum[axis] - from[axis]) / distance;
    start = Math.max(start, Math.min(entry, exit));
    end = Math.min(end, Math.max(entry, exit));
    if (start >= end) return null;
  }

  return [
    start === 0 ? from : [from[0] + dx * start, from[1] + dy * start],
    end === 1 ? to : [from[0] + dx * end, from[1] + dy * end],
  ];
}

export function openGridContours(ring: Point[], columns: number, rows: number): ContourSection[] {
  const points = ring.slice(0, -1);
  const minimum: Point = [0.5, 0.5];
  const maximum: Point = [columns - 0.5, rows - 0.5];

  // The contour extractor closes its polygons outside the pressure grid. In 3D
  // those closing edges would be visible, so cut the curves at the sample frame.
  const outside = points.findIndex(
    ([x, y]) => x < minimum[0] || x > maximum[0] || y < minimum[1] || y > maximum[1],
  );
  if (outside < 0) return [{ points, closed: true }];

  const sections: ContourSection[] = [];
  let piece: Point[] = [];
  function finishSection() {
    if (piece.length >= 2) sections.push({ points: piece, closed: false });
    piece = [];
  }

  for (let offset = 0; offset < points.length; offset += 1) {
    const from = points[(outside + offset) % points.length];
    const to = points[(outside + offset + 1) % points.length];
    const clipped = clipSegment(from, to, minimum, maximum);
    if (!clipped) {
      finishSection();
      continue;
    }
    const [start, end] = clipped;
    if (piece.length === 0) piece.push(start);
    piece.push(end);
    if (end !== to) finishSection();
  }
  finishSection();
  return sections;
}

const yaw = Math.PI / 18;
const cosine = Math.cos(yaw);
const sine = Math.sin(yaw);
const pitch = Math.PI * 0.27;
const pitchSine = Math.sin(pitch);
const pitchCosine = Math.cos(pitch);
const acrossScale = 0.68;
const verticalScale = 0.76;
const elevationScale = 0.255;
export const TERRAIN_SHADE_LEVELS = [0.28, 0.46, 0.64, 0.82];

export function elevationViewBox(width: number, height: number, aspect: number) {
  // Fit the window inside the grid at both elevation extremes. This leaves
  // every corner over the terrain and keeps the framing stable during animation.
  const elevationShift = (height * elevationScale * pitchCosine) / (2 * pitchSine);
  const across = aspect / acrossScale;
  const depth = 1 / (verticalScale * pitchSine);
  const halfHeight =
    0.98 *
    Math.min(
      (width / 2 - elevationShift * sine) / (across * cosine + depth * sine),
      (height / 2 - elevationShift * cosine) / (across * sine + depth * cosine),
    );
  const halfWidth = halfHeight * aspect;
  return [width / 2 - halfWidth, height / 2 - halfHeight, halfWidth * 2, halfHeight * 2];
}

type Vertex = [x: number, y: number, depth: number];

function projectElevation([x, y]: Point, elevation: number, width: number, height: number): Vertex {
  const dx = x - width / 2;
  const dy = y - height / 2;
  const across = dx * cosine - dy * sine;
  const depth = dx * sine + dy * cosine;
  const lift = (elevation - 0.5) * height * elevationScale;
  return [
    width / 2 + across * acrossScale,
    height / 2 + (depth * pitchSine - lift * pitchCosine) * verticalScale,
    depth * pitchCosine + lift * pitchSine,
  ];
}

function writeTriangle(
  a: Vertex,
  b: Vertex,
  c: Vertex,
  buffer: Float32Array,
  width: number,
  height: number,
) {
  const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(determinant) < 1e-8) return;

  const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const right = Math.min(width - 1, Math.floor(Math.max(a[0], b[0], c[0])));
  const bottom = Math.min(height - 1, Math.floor(Math.max(a[1], b[1], c[1])));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x + 0.5 - c[0];
      const dy = y + 0.5 - c[1];
      const first = ((b[1] - c[1]) * dx + (c[0] - b[0]) * dy) / determinant;
      const second = ((c[1] - a[1]) * dx + (a[0] - c[0]) * dy) / determinant;
      const third = 1 - first - second;
      if (first < 0 || second < 0 || third < 0) continue;
      // Interpolate depth within the triangle and keep the surface closest to the viewer.
      const depth = first * a[2] + second * b[2] + third * c[2];
      const index = y * width + x;
      if (depth > buffer[index]) buffer[index] = depth;
    }
  }
}

function visibilityBoundary(
  visibleEnd: Vertex,
  hiddenEnd: Vertex,
  visible: (vertex: Vertex) => boolean,
): Point {
  const [x, y, z] = visibleEnd;
  const [dx, dy, dz] = hiddenEnd.map((coordinate, index) => coordinate - visibleEnd[index]);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 5; step += 1) {
    const t = (low + high) / 2;
    if (visible([x + dx * t, y + dy * t, z + dz * t])) low = t;
    else high = t;
  }
  return [x + dx * low, y + dy * low];
}

function visibleSections(
  vertices: Vertex[],
  closed: boolean,
  visible: (vertex: Vertex) => boolean,
): ContourSection[] {
  const visiblePoints = vertices.map(visible);
  const firstHidden = visiblePoints.indexOf(false);
  const point = ([x, y]: Vertex): Point => [x, y];
  if (firstHidden < 0) return [{ points: vertices.map(point), closed }];

  const sections: ContourSection[] = [];
  let piece: Point[] = [];
  let startsAtOpenEnd = false;
  function finishPiece(endsAtOpenEnd: boolean) {
    if (piece.length >= 2) {
      // Discard subpixel fragments between occluders but keep natural contour ends.
      const length = piece.reduce(
        (sum, [x, y], index) =>
          index === 0 ? 0 : sum + Math.hypot(x - piece[index - 1][0], y - piece[index - 1][1]),
        0,
      );
      if (startsAtOpenEnd || endsAtOpenEnd || length >= 2.6)
        sections.push({ points: piece, closed: false });
    }
    piece = [];
  }
  const start = closed ? firstHidden : 0;
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const from = (start + index) % vertices.length;
    const to = (from + 1) % vertices.length;
    const startsVisible = visiblePoints[from];
    const endsVisible = visiblePoints[to];
    if (!startsVisible && !endsVisible) continue;

    const a = vertices[from];
    const b = vertices[to];
    if (piece.length === 0) {
      startsAtOpenEnd = !closed && index === 0 && startsVisible;
      piece.push(startsVisible ? point(a) : visibilityBoundary(b, a, visible));
    }
    piece.push(endsVisible ? point(b) : visibilityBoundary(a, b, visible));
    if (!endsVisible) finishPiece(false);
  }
  finishPiece(!closed);
  return sections;
}

function terrainShading(
  buffer: Float32Array,
  columns: number,
  rows: number,
  scaleX: number,
  scaleY: number,
  surfaceOnly: boolean,
) {
  // Sample depth gradients at a coarser resolution to draw softly rounded
  // slope shading as a few vector fills using the same visible surface as the lines.
  const step = 5;
  const width = Math.floor(columns / step);
  const height = Math.floor(rows / step);
  const flatSlope = pitchCosine / (verticalScale * pitchSine);
  const flatLight = (0.77 - 0.52 * flatSlope) / Math.hypot(flatSlope, 1);
  const values = Array.from({ length: width * height }, (_, index) => {
    const x = (index % width) * step + 2;
    const y = Math.floor(index / width) * step + 2;
    const offset = y * columns + x;
    const dx = ((buffer[offset + 2] - buffer[offset - 2]) * scaleX) / 4;
    const dy = ((buffer[offset + 2 * columns] - buffer[offset - 2 * columns]) * scaleY) / 4;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
    const light = (0.36 * dx - 0.52 * dy + 0.77) / Math.hypot(dx, dy, 1);
    return surfaceOnly ? 2.2 * Math.abs(light - flatLight) : 1 - light;
  });

  return contours()
    .size([width, height])
    .thresholds(TERRAIN_SHADE_LEVELS)(values)
    .map(({ coordinates }) =>
      coordinates
        .flat()
        .map((ring) =>
          ring.slice(0, -1).map(([x, y]): Point => [(x * step) / scaleX, (y * step) / scaleY]),
        ),
    );
}

export function createElevationView(
  grid: PressureGrid,
  width: number,
  height: number,
  surfaceOnly = false,
) {
  const min = Math.min(...grid.values);
  const range = Math.max(...grid.values) - min;
  const normalize = (value: number) => (range === 0 ? 0.5 : (value - min) / range);
  const project = (point: Point, value: number) =>
    projectElevation(point, normalize(value), width, height);

  // The depth buffer drives visibility and lighting. The rendered artwork is vector.
  const resolution = 720;
  const rows = Math.ceil((resolution * height) / width);
  const buffer = new Float32Array(resolution * rows).fill(-Infinity);
  const scaleX = resolution / width;
  const scaleY = rows / height;
  const columns = grid.x.length;
  const xMin = grid.x[0];
  const yMin = grid.y[0];
  const xSpan = grid.x[columns - 1] - xMin;
  const ySpan = grid.y[grid.y.length - 1] - yMin;
  const vertices = grid.y.flatMap((y, row) =>
    grid.x.map((x, column): Vertex => {
      const position: Point = [
        ((x - xMin) / xSpan) * width,
        height - ((y - yMin) / ySpan) * height,
      ];
      const [px, py, depth] = project(position, grid.values[row * columns + column]);
      return [px * scaleX, py * scaleY, depth];
    }),
  );

  for (let row = 0; row < grid.y.length - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const index = row * columns + column;
      const a = vertices[index];
      const b = vertices[index + 1];
      const c = vertices[index + columns];
      const d = vertices[index + columns + 1];
      writeTriangle(a, b, c, buffer, resolution, rows);
      writeTriangle(b, d, c, buffer, resolution, rows);
    }
  }

  function sampleDepth(column: number, row: number) {
    return column >= 0 && row >= 0 && column < resolution && row < rows
      ? buffer[row * resolution + column]
      : -Infinity;
  }

  function visible([x, y, depth]: Vertex) {
    const px = x * scaleX - 0.5;
    const py = y * scaleY - 0.5;
    const left = Math.floor(px);
    const top = Math.floor(py);
    const a = sampleDepth(left, top);
    const b = sampleDepth(left + 1, top);
    const c = sampleDepth(left, top + 1);
    const d = sampleDepth(left + 1, top + 1);
    const horizontal = px - left;
    const vertical = py - top;
    const nearest = sampleDepth(Math.round(px), Math.round(py));
    // At the silhouette, missing neighbors rule out bilinear interpolation.
    if (!Number.isFinite(Math.min(a, b, c, d))) return depth + 4 >= nearest;
    const upperDepth = a + (b - a) * horizontal;
    const lowerDepth = c + (d - c) * horizontal;
    return depth + 4 >= upperDepth + (lowerDepth - upperDepth) * vertical;
  }

  return {
    shading: terrainShading(buffer, resolution, rows, scaleX, scaleY, surfaceOnly),
    sections: (points: Point[], value: number, closed: boolean) =>
      visibleSections(
        points.map((point) => project(point, value)),
        closed,
        visible,
      ),
  };
}
