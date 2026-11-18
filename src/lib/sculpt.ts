import { CANVAS_HEIGHT, CANVAS_WIDTH } from './pattern';
import type { PressureGrid } from './pressure';

export const SCULPT_RADIUS = { min: 5, max: 45, initial: 23 };
export const SCULPT_STRENGTH = { min: 15, max: 250, initial: 120 };
export const MAX_SCULPT_POINTS = 24;

export interface SculptPoint {
  kind: 'peak' | 'valley';
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export function applySculptPoints(
  grid: PressureGrid,
  points: readonly SculptPoint[],
): PressureGrid {
  if (!points.length) return grid;

  const { x, y, values } = grid;
  const offsets = new Float64Array(values.length);
  // Express both axes in canvas-height units so the influence stays circular.
  const aspect = CANVAS_WIDTH / CANVAS_HEIGHT;
  for (const point of points) {
    const radius = point.radius / 100;
    const radiusSquared = radius * radius;
    const distanceAcross = x.map((column) => ((column - point.x) * aspect) ** 2);
    const elevation = (point.strength / 100) * (point.kind === 'peak' ? 1 : -1);
    for (let row = 0; row < y.length; row += 1) {
      const distanceDown = (1 - y[row] - point.y) ** 2;
      if (distanceDown >= radiusSquared) continue;
      for (let column = 0; column < x.length; column += 1) {
        const distance = distanceAcross[column] + distanceDown;
        if (distance >= radiusSquared) continue;
        const falloff = 1 - distance / radiusSquared;
        offsets[row * x.length + column] += elevation * falloff ** 3;
      }
    }
  }

  // Taper stacked edits so small overlaps blend and a pile of points stays within a useful elevation range.
  const relief = (Math.max(...values) - Math.min(...values)) * 0.7;
  return {
    x,
    y,
    values: values.map(
      (value, index) => value + (relief * offsets[index]) / (1 + Math.abs(offsets[index])),
    ),
  };
}
