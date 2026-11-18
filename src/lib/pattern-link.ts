import { CONTRAST, MAJOR_INTERVAL, MAJOR_WEIGHT, WEIGHT } from './artwork-style';
import {
  DEFAULT_DENSITY,
  DEFAULT_SEED,
  MAX_DENSITY,
  MIN_DENSITY,
  PATTERN_DURATION,
  SCALE,
  WARP,
} from './pattern';
import { readPatternView } from './pattern-view';
import type { PatternView } from './pattern-view';
import { MAX_SCULPT_POINTS, SCULPT_RADIUS, SCULPT_STRENGTH } from './sculpt';
import type { SculptPoint } from './sculpt';
import { DEFAULT_VARIANT, findPatternVariant, PATTERN_VARIANTS } from './variants';
import type { PatternVariant } from './variants';

interface PatternSnapshot {
  seed: number;
  variant: PatternVariant;
  view: PatternView;
  density: number;
  scale: number;
  warp: number;
  weight: number;
  major: boolean;
  majorInterval: number;
  majorWeight: number;
  contrast: number;
  lineColor: string | null;
  background: string;
  time: number;
  transparent: boolean;
  sculptPoints: readonly SculptPoint[];
}

const defaultPreset = PATTERN_VARIANTS[DEFAULT_VARIANT];
const defaultSnapshot: PatternSnapshot = {
  seed: DEFAULT_SEED,
  variant: DEFAULT_VARIANT,
  view: 'flat',
  density: DEFAULT_DENSITY,
  scale: SCALE.initial,
  warp: WARP.initial,
  weight: defaultPreset.weight,
  major: true,
  majorInterval: MAJOR_INTERVAL.initial,
  majorWeight: MAJOR_WEIGHT.initial,
  contrast: defaultPreset.contrast,
  lineColor: null,
  background: defaultPreset.background,
  time: 0,
  transparent: false,
  sculptPoints: [],
};

function boundedNumber(value: string | null, min: number, max: number, fallback: number) {
  if (!value?.trim()) return fallback;
  const number = Number(value);
  return number >= min && number <= max ? number : fallback;
}

function readHex(value: string | null) {
  return value && /^[0-9a-f]{6}$/i.test(value) ? '#' + value.toLowerCase() : null;
}

function readSculptPoints(params: URLSearchParams): SculptPoint[] {
  return params
    .getAll('point')
    .slice(0, MAX_SCULPT_POINTS)
    .flatMap((entry) => {
      const [kind, x, y, radius, strength, ...rest] = entry.split(',');
      if ((kind !== 'p' && kind !== 'v') || rest.length) return [];
      const point: SculptPoint = {
        kind: kind === 'p' ? 'peak' : 'valley',
        x: boundedNumber(x, 0, 1, NaN),
        y: boundedNumber(y, 0, 1, NaN),
        radius: boundedNumber(radius, SCULPT_RADIUS.min, SCULPT_RADIUS.max, NaN),
        strength: boundedNumber(strength, SCULPT_STRENGTH.min, SCULPT_STRENGTH.max, NaN),
      };
      return Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isInteger(point.radius) &&
        Number.isInteger(point.strength)
        ? [point]
        : [];
    });
}

export function readPatternLink(hash: string): PatternSnapshot | null {
  if (!hash) return defaultSnapshot;

  const params = new URLSearchParams(hash.slice(1));
  if (params.get('pattern') !== '1') return null;

  const seed = boundedNumber(params.get('seed'), 0, 0xffffffff, NaN);
  if (!Number.isInteger(seed)) return null;

  // Version-one links originally omitted the variant for Flow.
  const variant = findPatternVariant(params.get('variant'), 'flow');
  const preset = PATTERN_VARIANTS[variant];
  return {
    seed,
    variant,
    view: readPatternView(params.get('view')),
    density: boundedNumber(params.get('density'), MIN_DENSITY, MAX_DENSITY, DEFAULT_DENSITY),
    scale: boundedNumber(params.get('scale'), SCALE.min, SCALE.max, SCALE.initial),
    warp: boundedNumber(params.get('warp'), WARP.min, WARP.max, WARP.initial),
    weight: boundedNumber(params.get('weight'), WEIGHT.min, WEIGHT.max, preset.weight),
    major: params.get('major') !== '0',
    majorInterval: Math.round(
      boundedNumber(
        params.get('majorEvery'),
        MAJOR_INTERVAL.min,
        MAJOR_INTERVAL.max,
        MAJOR_INTERVAL.initial,
      ),
    ),
    majorWeight: boundedNumber(
      params.get('majorWeight'),
      MAJOR_WEIGHT.min,
      MAJOR_WEIGHT.max,
      MAJOR_WEIGHT.initial,
    ),
    contrast: boundedNumber(params.get('contrast'), CONTRAST.min, CONTRAST.max, preset.contrast),
    lineColor: readHex(params.get('ink')),
    background: readHex(params.get('bg')) ?? preset.background,
    time: boundedNumber(params.get('frame'), 0, PATTERN_DURATION, 0),
    transparent: params.get('transparent') === '1',
    sculptPoints: readSculptPoints(params),
  };
}

export function createPatternLink(address: string, snapshot: PatternSnapshot) {
  const url = new URL(address);
  const params = new URLSearchParams({
    pattern: '1',
    seed: String(snapshot.seed),
    variant: snapshot.variant,
    density: String(snapshot.density),
    weight: String(snapshot.weight),
    contrast: String(snapshot.contrast),
    bg: snapshot.background.slice(1),
  });
  if (snapshot.scale !== SCALE.initial) params.set('scale', String(snapshot.scale));
  if (snapshot.warp !== WARP.initial) params.set('warp', String(snapshot.warp));
  if (snapshot.view !== 'flat') params.set('view', snapshot.view);
  if (!snapshot.major) params.set('major', '0');
  if (snapshot.majorInterval !== MAJOR_INTERVAL.initial)
    params.set('majorEvery', String(snapshot.majorInterval));
  if (snapshot.majorWeight !== MAJOR_WEIGHT.initial)
    params.set('majorWeight', String(snapshot.majorWeight));
  if (snapshot.lineColor) params.set('ink', snapshot.lineColor.slice(1));
  if (snapshot.time > 0) params.set('frame', String(snapshot.time));
  if (snapshot.transparent) params.set('transparent', '1');
  for (const { kind, x, y, radius, strength } of snapshot.sculptPoints) {
    params.append('point', [kind === 'peak' ? 'p' : 'v', x, y, radius, strength].join(','));
  }
  url.hash = params.toString();
  return url.href;
}
