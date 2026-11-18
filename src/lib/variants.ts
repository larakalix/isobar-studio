import { CONTRAST, DEFAULT_BACKGROUND, WEIGHT } from './artwork-style';

export const PATTERN_VARIANTS = {
  topographic: { name: 'Topographic', background: '#fbfbfa', weight: 1.1, contrast: 200 },
  flow: {
    name: 'Flow',
    background: DEFAULT_BACKGROUND,
    weight: WEIGHT.initial,
    contrast: CONTRAST.initial,
  },
  valleys: { name: 'Valleys', background: '#ece3d6', weight: 1.1, contrast: 195 },
} as const;

export type PatternVariant = keyof typeof PATTERN_VARIANTS;
export const DEFAULT_VARIANT: PatternVariant = 'topographic';

export function findPatternVariant(
  value: string | null,
  fallback: PatternVariant = DEFAULT_VARIANT,
): PatternVariant {
  if (value === 'ridges' || value === 'islands' || value === 'vortex') return 'valleys';
  return value && Object.hasOwn(PATTERN_VARIANTS, value) ? (value as PatternVariant) : fallback;
}
