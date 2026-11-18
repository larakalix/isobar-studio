import { contours } from 'd3-contour';

export type Point = [number, number];

export interface PressureGrid {
  x: number[];
  y: number[];
  /** Row-major values with ascending x and y axes. */
  values: number[];
}

export const MAX_CSV_BYTES = 1_000_000;
const MAX_GRID_POINTS = 16_000;

export function parseGridCsv(text: string): PressureGrid {
  const rows = text
    .trim()
    .split(/\r\n?|\n/)
    .filter((line) => line.trim() !== '');
  const headings = rows
    .shift()
    ?.split(',')
    .map((cell) =>
      cell
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .toLowerCase(),
    );
  if (headings?.join(',') !== 'x,y,pressure') {
    throw new Error('Use the CSV header x,y,pressure.');
  }
  if (rows.length > MAX_GRID_POINTS) {
    throw new Error('Use a grid with at most 16,000 pressure readings.');
  }

  const readings = new Map<number, Map<number, number>>();
  const columns = new Set<number>();
  const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

  rows.forEach((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));
    if (cells.length !== 3 || cells.some((cell) => !numberPattern.test(cell))) {
      throw new Error(`Reading ${index + 1} needs numeric x, y and pressure values.`);
    }

    const [x, y, pressure] = cells.map(Number);
    if (
      [x, y].some((coordinate) => !Number.isFinite(coordinate) || Math.abs(coordinate) > 1e9) ||
      !Number.isFinite(pressure) ||
      pressure <= 0 ||
      pressure > 2000
    ) {
      throw new Error(
        `Reading ${index + 1} needs coordinates within ±1 billion and pressure above 0 through 2,000 hPa.`,
      );
    }

    const row = readings.get(y) ?? new Map<number, number>();
    if (row.has(x)) throw new Error(`Reading ${index + 1} repeats a coordinate from this CSV.`);

    row.set(x, pressure);
    readings.set(y, row);
    columns.add(x);
  });

  const x = [...columns].sort((a, b) => a - b);
  const y = [...readings.keys()].sort((a, b) => a - b);
  if (x.length < 2 || y.length < 2 || x.length * y.length !== rows.length) {
    throw new Error(
      'Include one reading for every x and y combination in a grid of at least 2 × 2.',
    );
  }

  const values = y.flatMap((coordinate) =>
    x.map((column) => readings.get(coordinate)!.get(column)!),
  );
  return { x, y, values };
}

export function traceContours(grid: PressureGrid, density: number, reference = grid) {
  const min = Math.min(...grid.values);
  const max = Math.max(...grid.values);
  if (min === max) return [];

  const origin = reference === grid ? min : Math.min(...reference.values);
  const range = (reference === grid ? max : Math.max(...reference.values)) - origin;
  if (range === 0) return [];
  const step = range / (density + 1);
  // Keep the original elevation interval through sculpt edits, adding lines where a point extends the range.
  const start = reference === grid ? 1 : Math.floor((min - origin) / step) + 1;
  const stop = reference === grid ? density : Math.ceil((max - origin) / step) - 1;
  const thresholds = Array.from(
    { length: stop - start + 1 },
    (_, index) => origin + ((start + index) * range) / (density + 1),
  ).filter((value) => value > min && value < max);

  return contours()
    .size([grid.x.length, grid.y.length])
    .thresholds(thresholds)(grid.values)
    .map(({ value, coordinates }, position) => ({
      value,
      index: reference === grid ? position : Math.round((value - origin) / step) - 1,
      rings: coordinates.flat() as Point[][],
    }));
}
