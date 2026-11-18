export const DEFAULT_BACKGROUND = '#0c0c0c';
const defaultLineColors = ['#514f4d', '#686561'];

export const WEIGHT = { min: 0.4, max: 4, step: 0.1, initial: 1.4 };
export const CONTRAST = { min: 20, max: 200, step: 5, initial: 100 };
export const MAJOR_INTERVAL = { min: 2, max: 10, step: 1, initial: 5 };
export const MAJOR_WEIGHT = { min: 0.1, max: 3, step: 0.1, initial: 0.1 };

export function terrainColor(background: string, ink: string) {
  return (
    '#' +
    [1, 3, 5]
      .map((offset) => {
        const base = parseInt(background.slice(offset, offset + 2), 16);
        const line = parseInt(ink.slice(offset, offset + 2), 16);
        return Math.round(base + (line - base) * 0.06)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

function linearRgb(hex: string) {
  return [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
}

function luminance([r, g, b]: number[]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexWithLuminance(channels: number[], original: number, target: number) {
  const tinted = channels.map((value) => {
    const adjusted =
      target <= original
        ? value * (target / original)
        : value + ((1 - value) * (target - original)) / (1 - original);
    const srgb = adjusted <= 0.0031308 ? adjusted * 12.92 : 1.055 * adjusted ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255)
      .toString(16)
      .padStart(2, '0');
  });
  return '#' + tinted.join('');
}

const defaultLuminance = luminance(linearRgb(DEFAULT_BACKGROUND));
const defaultInks = defaultLineColors.map(linearRgb);

export function contourStyles(
  weight: number,
  contrast: number,
  background: string,
  majorWeight = MAJOR_WEIGHT.initial,
) {
  const backgroundLuminance = luminance(linearRgb(background));
  // Choose the direction with more contrast headroom against the current background.
  const lightRange = 1.05 / (backgroundLuminance + 0.05);
  const darkRange = (backgroundLuminance + 0.05) / 0.05;
  const lighten = lightRange >= darkRange;
  const available = Math.max(lightRange, darkRange);

  return defaultInks.map((ink, index) => {
    const inkLuminance = luminance(ink);
    const restingContrast = (inkLuminance + 0.05) / (defaultLuminance + 0.05);
    const softContrast = index === 0 ? 1.6 : 1.8;
    const strongContrast =
      index === 0 ? Math.min(5.2, 1 + (available - 1) * 0.82) : Math.min(7, available);
    const ratio =
      contrast <= CONTRAST.initial
        ? softContrast +
          ((restingContrast - softContrast) * (contrast - CONTRAST.min)) /
            (CONTRAST.initial - CONTRAST.min)
        : restingContrast +
          ((strongContrast - restingContrast) * (contrast - CONTRAST.initial)) /
            (CONTRAST.max - CONTRAST.initial);
    const target = lighten
      ? (backgroundLuminance + 0.05) * ratio - 0.05
      : (backgroundLuminance + 0.05) / ratio - 0.05;

    return {
      color: hexWithLuminance(ink, inkLuminance, target),
      width: Number((weight + index * majorWeight).toFixed(2)),
    };
  });
}
