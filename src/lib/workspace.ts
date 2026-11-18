import { ARTWORK_PALETTES } from './artwork-palettes';
import { contourStyles, MAJOR_INTERVAL, MAJOR_WEIGHT, terrainColor } from './artwork-style';
import { createImageEditor } from './image-editor';
import { readImage } from './image-pattern';
import { exportLoop, loopDimensions } from './loop-export';
import { createPatternLink, readPatternLink } from './pattern-link';
import {
  canvasViewBox,
  createPattern,
  DEFAULT_SEED,
  PATTERN_DURATION,
  renderPattern,
  SCALE,
  WARP,
} from './pattern';
import { PATTERN_VIEWS, readPatternView } from './pattern-view';
import type { PatternView } from './pattern-view';
import { MAX_CSV_BYTES, parseGridCsv } from './pressure';
import type { PressureGrid } from './pressure';
import { applySculptPoints } from './sculpt';
import type { SculptPoint } from './sculpt';
import { createSculptEditor } from './sculpt-editor';
import { DEFAULT_VARIANT, findPatternVariant, PATTERN_VARIANTS } from './variants';
import type { PatternVariant } from './variants';

function element<T extends Element>(id: string) {
  const result = document.querySelector<T>(`#${id}`);
  if (!result) throw new Error(`Missing studio element: ${id}`);
  return result;
}

const stage = element<HTMLElement>('stage');
const artwork = element<HTMLElement>('artwork');
const svg = element<SVGSVGElement>('pattern-svg');
const contourLayer = element<SVGGElement>('pattern-contours');
const terrainSurface = element<SVGGElement>('terrain-surface');
const terrainBase = element<SVGRectElement>('terrain-base');
const directView = element<SVGGElement>('direct-view');
const kaleidoscopeDefs = element<SVGDefsElement>('kaleidoscope-defs');
const kaleidoscopeView = element<SVGGElement>('kaleidoscope-view');
const patternDescription = element<SVGDescElement>('pattern-description');
const traces = svg.querySelectorAll<SVGPathElement>('[data-trace]');
const density = element<HTMLInputElement>('density');
const densityValue = element<HTMLOutputElement>('density-value');
const stillButton = element<HTMLButtonElement>('static-mode');
const animateButton = element<HTMLButtonElement>('animate-mode');
const fullscreenButton = element<HTMLButtonElement>('fullscreen');
const emptyState = element<HTMLElement>('empty-state');
const status = element<HTMLElement>('status');
const importTrigger = element<HTMLButtonElement>('open-import');
const exportButton = element<HTMLButtonElement>('export-svg');
const loopTrigger = element<HTMLButtonElement>('open-loop');
const loopDialog = element<HTMLDialogElement>('loop-dialog');
const loopForm = element<HTMLFormElement>('loop-form');
const loopDuration = element<HTMLSelectElement>('loop-duration');
const loopProgress = element<HTMLProgressElement>('loop-progress');
const loopStatus = element<HTMLElement>('loop-status');
const loopError = element<HTMLElement>('loop-error');
const loopStart = element<HTMLButtonElement>('loop-start');
const loopCancel = element<HTMLButtonElement>('loop-cancel');
const dialog = element<HTMLDialogElement>('import-dialog');
const importError = element<HTMLElement>('import-error');
const fileInput = element<HTMLInputElement>('csv-file');
const imageInput = element<HTMLInputElement>('image-file');
const sourceFile = element<HTMLElement>('source-file');
const editorPickers = document.querySelectorAll<HTMLDetailsElement>('.editor-picker');
const patternScale = element<HTMLInputElement>('pattern-scale');
const scaleValue = element<HTMLOutputElement>('pattern-scale-value');
const patternWarp = element<HTMLInputElement>('pattern-warp');
const warpValue = element<HTMLOutputElement>('pattern-warp-value');
const shapeFields = element<HTMLFieldSetElement>('shape-fields');
const shapePicker = element<HTMLDetailsElement>('shape-picker');
const viewOptions = document.querySelectorAll<HTMLInputElement>('input[name="pattern-view"]');
const kaleidoscopeOption = element<HTMLInputElement>('kaleidoscope-option');
const variantOptions = shapeFields.querySelectorAll<HTMLInputElement>(
  'input[name="pattern-variant"]',
);
const shapeReset = element<HTMLButtonElement>('reset-shape');
const shapeSourceNote = element<HTMLElement>('shape-source-note');
const lineWeight = element<HTMLInputElement>('line-weight');
const weightValue = element<HTMLOutputElement>('line-weight-value');
const majorToggle = element<HTMLInputElement>('major-contours');
const majorInterval = element<HTMLInputElement>('major-interval');
const majorIntervalValue = element<HTMLOutputElement>('major-interval-value');
const majorWeight = element<HTMLInputElement>('major-weight');
const majorWeightValue = element<HTMLOutputElement>('major-weight-value');
const majorFields = element<HTMLFieldSetElement>('major-fields');
const majorSummary = element<HTMLElement>('major-summary');
const lineContrast = element<HTMLInputElement>('line-contrast');
const contrastValue = element<HTMLOutputElement>('line-contrast-value');
const lineColor = element<HTMLInputElement>('line-color');
const lineColorValue = element<HTMLOutputElement>('line-color-value');
const autoLineColor = element<HTMLButtonElement>('auto-line-color');
const autoContrastNote = element<HTMLElement>('auto-contrast-note');
const backgroundColor = element<HTMLInputElement>('background-color');
const colorValue = element<HTMLOutputElement>('background-color-value');
const palettePicker = element<HTMLDetailsElement>('palette-picker');
const paletteSelection = element<HTMLElement>('palette-selection');
const paletteOptions = Object.entries(ARTWORK_PALETTES).map(([id, palette]) => ({
  ...palette,
  button: element<HTMLButtonElement>(`palette-${id}`),
}));
const patternBackground = svg.querySelector('[data-background]')!;
const transparentSvg = element<HTMLInputElement>('transparent-svg');
const shareButton = element<HTMLButtonElement>('copy-pattern-link');
const shareLabel = element<HTMLElement>('share-label');
const shareDialog = element<HTMLDialogElement>('share-dialog');
const shareInput = element<HTMLInputElement>('pattern-link');

let seed = DEFAULT_SEED;
let variant: PatternVariant = DEFAULT_VARIANT;
let view: PatternView = 'flat';
let samplePattern = createPattern(seed, variant);
// Keep the base grid so moving or undoing a sculpt point starts from the same surface.
let grid: PressureGrid = samplePattern(0);
let time = 0;
let frameId = 0;
let lastFrame: number | undefined;
let playing = false;
let source: 'generated' | 'csv' | 'image' = 'generated';
let imageInverted = false;
let importSequence = 0;
let copyFeedbackTimer = 0;
let customLineColor: string | null = null;
let loopController: AbortController | null = null;

function createFramePainter(target: SVGSVGElement) {
  // The preview and the detached SVG used for video export share this renderer.
  const contourPaths = target.querySelectorAll('[data-trace]');
  const terrain = target.querySelector('#terrain-surface');
  const shades = terrain?.querySelectorAll('path');
  return ({ paths, shading }: ReturnType<typeof renderPattern>) => {
    contourPaths.forEach((trace, index) => trace.setAttribute('d', paths[index]));
    terrain?.setAttribute('display', shading ? 'inline' : 'none');
    if (shading) shades?.forEach((shade, index) => shade.setAttribute('d', shading[index]));
  };
}

const paintPreview = createFramePainter(svg);
const activeMajorInterval = () => (majorToggle.checked ? majorInterval.valueAsNumber : 0);

function renderGenerated(
  grid: PressureGrid,
  density: number,
  view: PatternView,
  interval: number,
  points: readonly SculptPoint[],
) {
  return renderPattern(applySculptPoints(grid, points), density, true, view, interval, false, grid);
}

function paint() {
  const imageArtwork = source === 'image';
  const renderGrid =
    imageArtwork && imageInverted && view === '3d'
      ? { ...grid, values: grid.values.map((value) => -value) }
      : grid;
  const interval = activeMajorInterval();
  const frame =
    source === 'generated'
      ? renderGenerated(grid, density.valueAsNumber, view, interval, sculptEditor.points)
      : renderPattern(
          renderGrid,
          density.valueAsNumber,
          source !== 'csv',
          view,
          interval,
          imageArtwork,
        );
  paintPreview(frame);
  const empty = frame.paths.every((path) => path === '');
  emptyState.hidden = !empty;
  exportButton.disabled = empty;
}

const sculptEditor = createSculptEditor(svg, {
  enter: () => {
    setPlaying(false);
    setPatternView('flat');
    paint();
  },
  setView: (next) => {
    setPatternView(next);
    paint();
  },
  paint,
  announce: (message) => {
    status.textContent = message;
  },
});

const imageEditor = createImageEditor((next, inverted) => {
  grid = next;
  imageInverted = inverted;
  paint();
});

function paintGeneratedFrame() {
  grid = samplePattern(time, patternScale.valueAsNumber, patternWarp.valueAsNumber);
  paint();
}

function resizePreview() {
  if (artwork.clientWidth && artwork.clientHeight) {
    stage.style.setProperty('--editor-max-height', `${artwork.clientHeight - 12}px`);
    const box = canvasViewBox(
      artwork.clientWidth,
      artwork.clientHeight,
      view,
      source === 'image',
    ).map((coordinate) => coordinate.toFixed(4));
    svg.setAttribute('viewBox', box.join(' '));
    ['x', 'y', 'width', 'height'].forEach((attribute, index) => {
      patternBackground.setAttribute(attribute, box[index]);
      terrainBase.setAttribute(attribute, box[index]);
    });
    sculptEditor.updateView(view);
  }
}

function setPatternView(next: PatternView) {
  view = next;
  for (const option of viewOptions) option.checked = option.value === view;

  // Kaleidoscope defines the contour layer once and reuses it in every wedge.
  const mirrored = view === 'kaleidoscope';
  const root = mirrored ? kaleidoscopeDefs : directView;
  if (contourLayer.parentNode !== root) root.append(contourLayer);
  kaleidoscopeView.setAttribute('display', mirrored ? 'inline' : 'none');
  patternDescription.textContent =
    view === '3d'
      ? 'A close-up of tilted terrain with contour lines at different elevations.'
      : mirrored
        ? 'Twelve mirrored wedges of the contour pattern.'
        : 'Flowing contour lines.';
  resizePreview();
}

for (const option of viewOptions) {
  option.addEventListener('change', () => {
    if (!option.checked) return;
    setPatternView(readPatternView(option.value));
    paint();
    status.textContent = `${PATTERN_VIEWS[view]} view selected.`;
  });
}

function tick(now: number) {
  if (!playing) return;

  const elapsed = lastFrame === undefined ? 0 : now - lastFrame;
  if (lastFrame === undefined || elapsed >= 1000 / 32) {
    time = (time + Math.min(elapsed, 65) / 1000) % PATTERN_DURATION;
    lastFrame = now;
    paintGeneratedFrame();
  }
  frameId = requestAnimationFrame(tick);
}

function setPlaying(next: boolean) {
  if (playing === next) return;

  playing = next;
  lastFrame = undefined;
  animateButton.setAttribute('aria-pressed', String(playing));
  stillButton.setAttribute('aria-pressed', String(!playing));
  if (playing) frameId = requestAnimationFrame(tick);
  else cancelAnimationFrame(frameId);
}

stillButton.addEventListener('click', () => setPlaying(false));
animateButton.addEventListener('click', () => setPlaying(source === 'generated'));
document.addEventListener('visibilitychange', () => {
  lastFrame = undefined;
});

function showGeneratedPattern(nextSeed: number, frame = 0, points: readonly SculptPoint[] = []) {
  importSequence += 1;
  seed = nextSeed;
  time = frame;
  lastFrame = undefined;
  samplePattern = createPattern(seed, variant);
  source = 'generated';
  sculptEditor.reset(points);
  imageEditor.clear();
  updateSourceControls();
  sourceFile.hidden = true;
  resizePreview();
  paintGeneratedFrame();
}

element<HTMLButtonElement>('new-pattern').addEventListener('click', () => {
  let nextSeed: number;
  do {
    nextSeed = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (nextSeed === seed);
  showGeneratedPattern(nextSeed);
  status.textContent = 'New contour pattern generated.';
});

function updateRange(input: HTMLInputElement, valueText: string) {
  const percent =
    ((input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty('--progress', `${percent}%`);
  input.setAttribute('aria-valuetext', valueText);
}

function updateDensity() {
  updateRange(density, `${density.value} contour levels`);
  densityValue.value = density.value;
}

density.addEventListener('input', () => {
  updateDensity();
  paint();
});

function updateShapeFields() {
  scaleValue.value = `${patternScale.value}%`;
  warpValue.value = `${patternWarp.value}%`;
  updateRange(patternScale, scaleValue.value);
  updateRange(patternWarp, warpValue.value);
}

function updateSourceControls() {
  const imageArtwork = source === 'image';
  const staticSource = source !== 'generated';
  sculptEditor.setAvailable(!staticSource);
  const kaleidoscopeLabel = kaleidoscopeOption.closest('label')!;
  emptyState.textContent = imageArtwork
    ? 'No silhouette in this crop. Adjust the crop or smoothing.'
    : 'This grid has no pressure contours.';
  shapeFields.disabled = staticSource;
  shapeFields.hidden = imageArtwork;
  shapeReset.disabled = staticSource;
  shapeReset.hidden = imageArtwork;
  shapeSourceNote.hidden = source !== 'csv';
  kaleidoscopeOption.disabled = imageArtwork;
  kaleidoscopeLabel.hidden = imageArtwork;
  animateButton.disabled = staticSource;
  animateButton.title = staticSource ? 'Animation is available for generated patterns.' : '';
  loopTrigger.disabled = staticSource;
  loopTrigger.title = staticSource
    ? 'Loop export is available for generated patterns.'
    : 'Export loop';
  shareButton.disabled = staticSource;
  shareButton.title = staticSource
    ? 'Pattern links are available for generated patterns.'
    : 'Copy pattern link';
}

function updateShapePreview() {
  updateShapeFields();
  if (source === 'generated') paintGeneratedFrame();
}

for (const input of [patternScale, patternWarp]) {
  input.addEventListener('input', updateShapePreview);
}
shapeReset.addEventListener('click', () => {
  patternScale.valueAsNumber = SCALE.initial;
  patternWarp.valueAsNumber = WARP.initial;
  updateShapePreview();
  status.textContent = 'Default shape restored.';
});

function updateArtworkStyle() {
  const weight = lineWeight.valueAsNumber;
  const contrast = lineContrast.valueAsNumber;
  const background = backgroundColor.value;
  const styles = contourStyles(weight, contrast, background, majorWeight.valueAsNumber);
  const auto = customLineColor === null;
  traces.forEach((trace, index) => {
    trace.setAttribute('stroke', customLineColor ?? styles[index].color);
    trace.setAttribute('stroke-width', String(styles[index].width));
  });
  artwork.style.setProperty('--artwork', background);
  patternBackground.setAttribute('fill', background);

  const chosenColor = customLineColor ?? styles[0].color;
  terrainBase.setAttribute('fill', terrainColor(background, chosenColor));
  terrainSurface.setAttribute('fill', chosenColor);
  if (lineColor.value !== chosenColor) lineColor.value = chosenColor;
  lineColorValue.value = chosenColor.toUpperCase();
  autoLineColor.setAttribute('aria-pressed', String(auto));
  lineContrast.disabled = !auto;
  autoContrastNote.hidden = auto;
  weightValue.value = `${weight.toFixed(1)} px`;
  contrastValue.value = `${contrast}%`;
  colorValue.value = background.toUpperCase();
  updateRange(lineWeight, weightValue.value);
  updateRange(lineContrast, contrastValue.value);
  const selected = paletteOptions.find(
    (palette) => palette.background === background && palette.line === customLineColor,
  );
  for (const palette of paletteOptions)
    palette.button.setAttribute('aria-pressed', String(palette === selected));
  paletteSelection.textContent = selected?.name ?? '';
}

function updateMajorFields() {
  majorFields.disabled = !majorToggle.checked;
  majorIntervalValue.value = `Every ${majorInterval.value}`;
  majorWeightValue.value = `+${majorWeight.valueAsNumber.toFixed(1)} px`;
  majorSummary.textContent = majorToggle.checked ? majorIntervalValue.value : 'Off';
  updateRange(majorInterval, `${majorIntervalValue.value} contour levels`);
  updateRange(majorWeight, `${majorWeight.valueAsNumber.toFixed(1)} extra pixels`);
}

for (const control of [majorToggle, majorInterval]) {
  control.addEventListener('input', () => {
    updateMajorFields();
    paint();
  });
}
majorWeight.addEventListener('input', () => {
  updateMajorFields();
  updateArtworkStyle();
});

for (const { button, name, background, line } of paletteOptions) {
  button.addEventListener('click', () => {
    backgroundColor.value = background;
    customLineColor = line;
    updateArtworkStyle();
    status.textContent = `${name} palette applied.`;
  });
}

for (const input of [lineWeight, lineContrast, backgroundColor]) {
  input.addEventListener('input', updateArtworkStyle);
}
function setCustomLineColor() {
  customLineColor = lineColor.value;
  updateArtworkStyle();
}
lineColor.addEventListener('input', setCustomLineColor);
lineColor.addEventListener('change', setCustomLineColor);
autoLineColor.addEventListener('click', () => {
  customLineColor = customLineColor === null ? lineColor.value : null;
  updateArtworkStyle();
});

element<HTMLButtonElement>('reset-style').addEventListener('click', () => {
  const preset = PATTERN_VARIANTS[variant];
  lineWeight.valueAsNumber = preset.weight;
  majorToggle.checked = true;
  majorInterval.valueAsNumber = MAJOR_INTERVAL.initial;
  majorWeight.valueAsNumber = MAJOR_WEIGHT.initial;
  lineContrast.valueAsNumber = preset.contrast;
  backgroundColor.value = preset.background;
  customLineColor = null;
  updateMajorFields();
  updateArtworkStyle();
  paint();
  status.textContent = 'Default style restored.';
});

for (const option of variantOptions) {
  option.addEventListener('change', () => {
    if (!option.checked || source !== 'generated') return;

    const previous = PATTERN_VARIANTS[variant];
    variant = findPatternVariant(option.value);
    const preset = PATTERN_VARIANTS[variant];
    if (lineWeight.valueAsNumber === previous.weight) lineWeight.valueAsNumber = preset.weight;
    if (lineContrast.valueAsNumber === previous.contrast)
      lineContrast.valueAsNumber = preset.contrast;
    if (backgroundColor.value === previous.background) backgroundColor.value = preset.background;

    samplePattern = createPattern(seed, variant);
    paintGeneratedFrame();
    updateArtworkStyle();
    status.textContent = `${preset.name} pattern selected.`;
  });
}
document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (target instanceof Node) {
    for (const picker of editorPickers) {
      if (picker.open && !picker.contains(target)) picker.open = false;
    }
  }
});

function restorePatternLink() {
  const snapshot = readPatternLink(window.location.hash);
  if (!snapshot) return;

  setPlaying(false);
  variant = snapshot.variant;
  for (const option of variantOptions) option.checked = option.value === variant;
  density.valueAsNumber = snapshot.density;
  patternScale.valueAsNumber = snapshot.scale;
  patternWarp.valueAsNumber = snapshot.warp;
  lineWeight.valueAsNumber = snapshot.weight;
  majorToggle.checked = snapshot.major;
  majorInterval.valueAsNumber = snapshot.majorInterval;
  majorWeight.valueAsNumber = snapshot.majorWeight;
  lineContrast.valueAsNumber = snapshot.contrast;
  backgroundColor.value = snapshot.background;
  customLineColor = snapshot.lineColor;
  transparentSvg.checked = snapshot.transparent;
  updateDensity();
  updateMajorFields();
  updateShapeFields();
  setPatternView(snapshot.view);
  showGeneratedPattern(snapshot.seed, snapshot.time, snapshot.sculptPoints);
  updateArtworkStyle();
}

shareButton.addEventListener('click', async () => {
  const link = createPatternLink(window.location.href, {
    seed,
    variant,
    view,
    density: density.valueAsNumber,
    scale: patternScale.valueAsNumber,
    warp: patternWarp.valueAsNumber,
    weight: lineWeight.valueAsNumber,
    major: majorToggle.checked,
    majorInterval: majorInterval.valueAsNumber,
    majorWeight: majorWeight.valueAsNumber,
    contrast: lineContrast.valueAsNumber,
    lineColor: customLineColor,
    background: backgroundColor.value,
    time,
    sculptPoints: sculptEditor.points,
    transparent: transparentSvg.checked,
  });

  try {
    await navigator.clipboard.writeText(link);
  } catch {
    shareInput.value = link;
    shareDialog.showModal();
    shareInput.focus();
    shareInput.select();
    return;
  }

  shareButton.dataset.copied = '';
  shareLabel.textContent = 'Copied';
  status.textContent = 'Pattern link copied.';
  window.clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = window.setTimeout(() => {
    delete shareButton.dataset.copied;
    shareLabel.textContent = 'Copy link';
  }, 1800);
});

importTrigger.addEventListener('click', () => {
  importError.hidden = true;
  dialog.showModal();
});
dialog.addEventListener('close', () => {
  if (!dialog.open) importSequence += 1;
});
element<HTMLButtonElement>('choose-file').addEventListener('click', () => fileInput.click());
element<HTMLButtonElement>('choose-image').addEventListener('click', () => imageInput.click());

function bindImport<T>(
  input: HTMLInputElement,
  read: (file: File) => Promise<T>,
  apply: (data: T, file: File) => void,
) {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Closing the dialog or selecting another file invalidates an in-flight read.
    const sequence = ++importSequence;
    importError.hidden = true;

    try {
      const next = await read(file);
      if (sequence !== importSequence || !dialog.open) return;
      apply(next, file);
      dialog.close();
      if (source === 'image') shapePicker.querySelector('summary')?.focus();
    } catch (error) {
      if (sequence !== importSequence || !dialog.open) return;
      importError.textContent =
        error instanceof Error ? error.message : 'Could not read this file.';
      importError.hidden = false;
    }
  });
}

function useImportedSource(next: 'image' | 'csv', label: string) {
  setPlaying(false);
  source = next;
  updateSourceControls();
  sourceFile.textContent = label;
  sourceFile.hidden = false;
}

bindImport(
  fileInput,
  async (file) => {
    if (file.size > MAX_CSV_BYTES) throw new Error('Choose a CSV up to 1 MB.');
    return parseGridCsv(await file.text());
  },
  (next, file) => {
    imageEditor.clear();
    useImportedSource('csv', `Pressure grid from ${file.name}`);
    grid = next;
    resizePreview();
    paint();
    status.textContent = 'Pressure grid imported.';
  },
);

bindImport(imageInput, readImage, (next, file) => {
  useImportedSource('image', `Image from ${file.name}`);
  setPatternView(view === '3d' ? '3d' : 'flat');
  imageEditor.set(next);
  shapePicker.open = true;
  status.textContent = 'Image contours ready. Open Crop image or adjust smoothing in Shape.';
});

function artworkSvg(width: number, height: number, transparent = false) {
  // Sculpt handles and other editor controls live outside the artwork SVG.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('class');
  clone.removeAttribute('id');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('overflow', 'hidden');
  if (transparent) {
    clone.querySelector('[data-background]')?.remove();
    clone.querySelector('#terrain-base')?.remove();
  }
  if (view !== '3d') clone.querySelector('#terrain-surface')?.remove();
  if (view === 'kaleidoscope') clone.querySelector('#direct-view')?.remove();
  else {
    clone.querySelector('#kaleidoscope-defs')?.remove();
    clone.querySelector('#kaleidoscope-view')?.remove();
  }
  return clone;
}

function artworkFilename() {
  const variantSuffix = variant === 'flow' ? '' : `-${variant}`;
  const viewSuffix = view === 'flat' ? '' : `-${view}`;
  const base =
    source === 'generated'
      ? `isobars-${seed}${variantSuffix}`
      : source === 'image'
        ? 'isobars-image'
        : 'isobars-pressure-grid';
  return base + viewSuffix;
}

function downloadFile(file: Blob, filename: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

exportButton.addEventListener('click', () => {
  resizePreview();
  const { width, height } = svg.viewBox.baseVal;
  const isTransparent = transparentSvg.checked;
  const clone =
    view === '3d'
      ? artworkSvg(artwork.clientWidth, artwork.clientHeight, isTransparent)
      : artworkSvg(width, height, isTransparent);
  const source = new XMLSerializer().serializeToString(clone);
  downloadFile(
    new Blob([source], { type: 'image/svg+xml;charset=utf-8' }),
    `${artworkFilename()}${isTransparent ? '-transparent' : ''}.svg`,
  );
  status.textContent = isTransparent
    ? 'Current frame exported as a transparent SVG.'
    : 'Current frame exported as SVG.';
});

loopTrigger.addEventListener('click', () => {
  loopError.hidden = true;
  loopDialog.showModal();
});

function cancelLoop() {
  if (loopController) {
    loopCancel.disabled = true;
    loopStatus.textContent = 'Canceling export…';
    loopController.abort();
  } else {
    loopDialog.close();
  }
}

loopDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelLoop();
});
loopCancel.addEventListener('click', cancelLoop);

loopForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loopController || source !== 'generated') return;

  resizePreview();
  const { width, height } = loopDimensions(artwork.clientWidth, artwork.clientHeight);
  const frameSvg = artworkSvg(width, height);
  const strokeScale = width / artwork.clientWidth;
  for (const path of frameSvg.querySelectorAll('[data-trace]')) {
    path.setAttribute(
      'stroke-width',
      String(Number(path.getAttribute('stroke-width')) * strokeScale),
    );
  }
  const drawFrame = createFramePainter(frameSvg);
  // Capture everything the frame callback needs before asynchronous encoding begins.
  const duration = Number(loopDuration.value);
  const filename = `${artworkFilename()}-${duration}s-loop`;
  const start = time;
  const generateFrame = samplePattern;
  const frameDensity = density.valueAsNumber;
  const scale = patternScale.valueAsNumber;
  const warp = patternWarp.valueAsNumber;
  const frameView = view;
  const sculptPoints = sculptEditor.points;
  const interval = activeMajorInterval();
  const resume = playing;
  const sourceRevision = importSequence;
  setPlaying(false);

  const controller = new AbortController();
  loopController = controller;
  loopStart.disabled = true;
  loopDuration.disabled = true;
  loopProgress.value = 0;
  loopProgress.hidden = false;
  loopError.hidden = true;
  loopStatus.textContent = 'Rendering frames…';
  loopStatus.hidden = false;
  loopCancel.focus();

  try {
    const { blob, extension } = await exportLoop({
      svg: frameSvg,
      duration,
      renderFrame: (phase) => {
        const frame = generateFrame(
          (start + phase * PATTERN_DURATION) % PATTERN_DURATION,
          scale,
          warp,
        );
        drawFrame(renderGenerated(frame, frameDensity, frameView, interval, sculptPoints));
      },
      onProgress: (progress) => {
        loopProgress.value = progress;
        if (progress === 1 && !controller.signal.aborted)
          loopStatus.textContent = 'Finishing video…';
      },
      signal: controller.signal,
    });
    downloadFile(blob, `${filename}.${extension}`);
    loopDialog.close();
    status.textContent = 'Seamless loop exported.';
  } catch (error) {
    if (controller.signal.aborted) {
      loopDialog.close();
    } else {
      loopError.textContent =
        error instanceof Error ? error.message : 'Could not export this loop.';
      loopError.hidden = false;
    }
  } finally {
    loopController = null;
    loopStart.disabled = false;
    loopDuration.disabled = false;
    loopCancel.disabled = false;
    loopProgress.hidden = true;
    loopStatus.hidden = true;
    if (loopDialog.open) loopStart.focus();
    if (resume && sourceRevision === importSequence) setPlaying(true);
  }
});

function updateFullscreen() {
  const expanded = document.fullscreenElement === stage || stage.classList.contains('is-expanded');
  const label = expanded ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreenButton.setAttribute('aria-label', label);
  fullscreenButton.title = label;
  importTrigger.inert = expanded;
  exportButton.inert = expanded;
  loopTrigger.inert = expanded;
  shareButton.inert = expanded;
  sculptEditor.setFullscreen(expanded);
  resizePreview();
}

fullscreenButton.addEventListener('click', async () => {
  if (stage.classList.contains('is-expanded')) {
    stage.classList.remove('is-expanded');
  } else if (document.fullscreenElement === stage) {
    await document.exitFullscreen();
  } else {
    try {
      await stage.requestFullscreen();
    } catch {
      stage.classList.add('is-expanded');
    }
  }
  updateFullscreen();
});
document.addEventListener('fullscreenchange', updateFullscreen);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || loopDialog.open || dialog.open || shareDialog.open) return;
  if (palettePicker.open && palettePicker.contains(document.activeElement)) {
    palettePicker.open = false;
    palettePicker.querySelector('summary')?.focus();
    return;
  }
  for (const picker of editorPickers) {
    if (picker.open) {
      picker.open = false;
      picker.querySelector('summary')?.focus();
      return;
    }
  }
  if (sculptEditor.close()) return;
  if (stage.classList.contains('is-expanded')) {
    stage.classList.remove('is-expanded');
    updateFullscreen();
    fullscreenButton.focus();
  }
});
window.addEventListener('hashchange', restorePatternLink);
if (window.location.hash) restorePatternLink();
new ResizeObserver(resizePreview).observe(artwork);
resizePreview();
