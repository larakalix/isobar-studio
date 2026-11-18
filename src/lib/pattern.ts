import { MAJOR_INTERVAL } from './artwork-style';
import { createElevationView, elevationViewBox, openGridContours } from './pattern-view';
import type { PatternView } from './pattern-view';
import { traceContours } from './pressure';
import type { Point, PressureGrid } from './pressure';
import { createTerrainNoise } from './terrain';
import { DEFAULT_VARIANT } from './variants';
import type { PatternVariant } from './variants';

export const DEFAULT_SEED = 74;
export const DEFAULT_DENSITY = 15;
export const MIN_DENSITY = 6;
export const MAX_DENSITY = 32;
export const PATTERN_DURATION = 64;
export const SCALE = { min: 60, max: 180, step: 5, initial: 100 };
export const WARP = { min: 0, max: 200, step: 5, initial: 100 };

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 740;

const TAU = 2 * Math.PI;
const samples = (steps: number) => Array.from({ length: steps + 1 }, (_, index) => index / steps);
const standardGrid = { x: samples(128), y: samples(80) };
const detailGrid = { x: samples(160), y: samples(100) };

type Surface = (x: number, y: number) => number;

function flowSurface(phases: number[], t: number, bend: number): Surface {
  const driftX = 0.14 * Math.sin(t);
  const driftY = 0.15 * Math.sin(t * 2 + 1.1);
  const baseDriftY = 0.15 * Math.sin(1.1);
  return (x, y) => {
    const u =
      x +
      0.108 * bend * Math.sin(TAU * (0.73 * y - 0.48 * x + phases[0]) + driftX * 3) +
      0.046 * bend * Math.cos(TAU * (1.3 * y + 0.57 * x + phases[1]));
    const v =
      y +
      0.165 * bend * Math.sin(TAU * (0.91 * x + 0.34 * y + phases[2]) + (driftY - baseDriftY) * 4) +
      0.051 * bend * Math.sin(TAU * (0.61 * x - 1.16 * y + phases[3]));

    return (
      0.91 * Math.sin(TAU * (1.33 * u + 0.44 * v + phases[4]) + driftX) +
      0.76 * Math.cos(TAU * (0.49 * u - 1.04 * v + phases[5]) - driftY + baseDriftY) +
      0.4 * Math.sin(TAU * (1.74 * u - 0.76 * v + phases[6]) + driftX * 0.4) +
      0.19 * Math.cos(TAU * (0.68 * u + 1.56 * v + phases[7]))
    );
  };
}

function topographicSurface(noise: Surface, t: number, bend: number): Surface {
  const driftX = 0.34 * Math.sin(t);
  const driftY = 0.24 * (Math.cos(t) - 1);
  return (x, y) => {
    const u = 7.4 * x + driftX + 0.8 * bend * noise(2.6 * x + 19, 2.4 * y + 7);
    const v = 5.0 * y + driftY + 0.72 * bend * noise(3.1 * x - 5, 2.2 * y + 14);
    return (
      noise(u + 11.4, v + 6.2) +
      0.33 * noise(1.78 * u - 12, 1.84 * v + 33) +
      0.06 * noise(3.35 * u + 49, 3.16 * v - 17)
    );
  };
}

function branchWeight(distance: number) {
  const progress = Math.min(1, Math.max(0, distance / 0.3));
  return progress * progress * (3 - 2 * progress);
}

function channel(distance: number, width: number) {
  const offset = distance / width;
  return Math.exp(-offset * offset);
}

function valleySurface(noise: Surface, phases: number[], t: number, bend: number): Surface {
  const drift = 0.043 * Math.sin(t);
  const fork = 0.33 + 0.16 * (phases[5] - 0.5);
  const verticalOffset = 0.14 * (phases[6] - 0.5) + 0.028 * (Math.cos(t) - 1);
  return (x, y) => {
    const u = x + drift + 0.095 * bend * noise(3.1 * x + 17, 3.4 * y - 4);
    const v = y + 0.13 * bend * noise(3.8 * x - 13, 3.0 * y + 4);
    const stem =
      0.41 +
      0.18 * u +
      verticalOffset +
      bend *
        (0.125 * Math.sin(TAU * (0.72 * u + phases[0])) +
          0.043 * Math.sin(TAU * (1.72 * u + phases[2])));
    const east = u - fork;
    const west = 0.64 - u;
    const main = channel(v - stem, 0.1);
    const north = 0.81 * branchWeight(east) * channel(v - stem - 0.57 * east, 0.062);
    const south = 0.72 * branchWeight(west) * channel(v - stem + 0.53 * west, 0.068);

    // Combine the channels without making the junctions artificially deep.
    const depth = 1 - (1 - main) * (1 - north) * (1 - south);
    const terrain =
      noise(5.8 * u + 8.5, 6.8 * v - 19.2) + 0.23 * noise(11.3 * u - 12, 12.1 * v + 23);
    return 0.91 * terrain - 0.61 * depth;
  };
}

export function createPattern(seed: number, variant: PatternVariant = DEFAULT_VARIANT) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const phases = Array.from({ length: 8 }, random);
  const noise = createTerrainNoise(seed);
  const createSurface =
    variant === 'valleys'
      ? (phase: number, bend: number) => valleySurface(noise, phases, phase, bend)
      : variant === 'topographic'
        ? (phase: number, bend: number) => topographicSurface(noise, phase, bend)
        : (phase: number, bend: number) => flowSurface(phases, phase, bend);
  const grid = variant === 'flow' ? standardGrid : detailGrid;

  return (
    seconds: number,
    scalePercent = SCALE.initial,
    warpPercent = WARP.initial,
  ): PressureGrid => {
    // The variants move through one angular cycle over the loop period.
    const surface = createSurface((seconds * TAU) / PATTERN_DURATION, warpPercent / WARP.initial);
    const frequencyOffset = SCALE.initial / scalePercent - 1;
    const values = grid.y.flatMap((row) => {
      const y = row + (row - 0.5) * frequencyOffset;
      return grid.x.map((column) => surface(column + (column - 0.5) * frequencyOffset, y));
    });
    return { ...grid, values };
  };
}

function projectAxis(axis: number[], dimension: number) {
  const min = axis[0];
  const max = axis[axis.length - 1];

  // Marching squares places samples at i + 0.5 and closes rings beyond the grid.
  // Keep those closing edges outside the viewport so lines can flow off the canvas.
  return (sample: number) => {
    const position = sample - 0.5;
    if (position < 0) return -3;
    if (position > axis.length - 1) return dimension + 3;
    const index = Math.min(axis.length - 2, Math.floor(position));
    const value = axis[index] + (axis[index + 1] - axis[index]) * (position - index);
    return ((value - min) / (max - min)) * dimension;
  };
}

const coordinates = ([x, y]: Point) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

function contourOutline(points: Point[], smooth: boolean, closed: boolean) {
  if (!smooth || points.length < 3)
    return `M${points.map(coordinates).join(' ')}${closed ? 'Z' : ''}`;

  const midpoints = points.map(([x, y], index): Point => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return [(x + nextX) / 2, (y + nextY) / 2];
  });
  const segments = points.map(
    (point, index) => `${coordinates(point)} ${coordinates(midpoints[index])}`,
  );
  if (closed) return `M${coordinates(midpoints[midpoints.length - 1])}Q${segments.join(' ')}Z`;
  return `M${coordinates(points[0])}Q${segments.slice(1, -1).join(' ')}L${coordinates(points[points.length - 1])}`;
}

export function renderPattern(
  grid: PressureGrid,
  density: number,
  smooth = true,
  view: PatternView = 'flat',
  majorInterval = MAJOR_INTERVAL.initial,
  imageArtwork = false,
  reference = grid,
) {
  const x = projectAxis(grid.x, CANVAS_WIDTH);
  const y = projectAxis(grid.y, CANVAS_HEIGHT);
  // Grid rows run bottom to top, while SVG y increases down the screen.
  const project = ([column, row]: Point): Point => [x(column), CANVAS_HEIGHT - y(row)];
  const levels = traceContours(grid, density, reference);
  const elevationView =
    view === '3d' && levels.length > 0
      ? createElevationView(grid, CANVAS_WIDTH, CANVAS_HEIGHT, imageArtwork)
      : null;
  const paths = ['', ''];
  const firstMajor = Math.floor(majorInterval / 2);
  for (const { value, index, rings } of levels) {
    const style = majorInterval > 0 && (index - firstMajor) % majorInterval === 0 ? 1 : 0;
    if (elevationView) {
      paths[style] += rings
        .flatMap((ring) => openGridContours(ring, grid.x.length, grid.y.length))
        .flatMap(({ points, closed }) => elevationView.sections(points.map(project), value, closed))
        .map(({ points, closed }) => contourOutline(points, smooth, closed))
        .join('');
    } else {
      paths[style] += rings
        .map((ring) => contourOutline(ring.slice(0, -1).map(project), smooth, true))
        .join('');
    }
  }
  const shading =
    elevationView?.shading.map((rings) =>
      rings.map((ring) => contourOutline(ring, true, true)).join(''),
    ) ?? null;
  return { paths, shading };
}

export function canvasViewBox(
  width: number,
  height: number,
  view: PatternView = 'flat',
  imageArtwork = false,
) {
  if (view === '3d' && !imageArtwork)
    return elevationViewBox(CANVAS_WIDTH, CANVAS_HEIGHT, width / height);
  // Fit the entire silhouette for image artwork and fill the canvas for generated patterns.
  const framingWidth = view === '3d' ? 900 : CANVAS_WIDTH;
  const framingHeight = view === '3d' ? 600 : CANVAS_HEIGHT;
  const fit = imageArtwork ? Math.min : Math.max;
  const scale = fit(width / framingWidth, height / framingHeight);
  const viewWidth = width / scale;
  const viewHeight = height / scale;
  return [(CANVAS_WIDTH - viewWidth) / 2, (CANVAS_HEIGHT - viewHeight) / 2, viewWidth, viewHeight];
}
