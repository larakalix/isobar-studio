import {
  imageCropBounds,
  imageDistances,
  imagePressureGrid,
  IMAGE_SMOOTHING,
  MAX_CROP_TRIM,
} from './image-pattern';
import type { ImageCrop, ImageSource } from './image-pattern';
import type { PressureGrid } from './pressure';

export function createImageEditor(onChange: (grid: PressureGrid, inverted: boolean) => void) {
  const controls = document.querySelector<HTMLElement>('#image-controls')!;
  const smoothing = controls.querySelector<HTMLInputElement>('#image-smoothing')!;
  const smoothingValue = controls.querySelector<HTMLOutputElement>('#image-smoothing-value')!;
  const invert = controls.querySelector<HTMLInputElement>('#image-invert')!;
  const cropPanel = controls.querySelector<HTMLDetailsElement>('#image-crop')!;
  const preview = controls.querySelector<HTMLCanvasElement>('#image-crop-preview')!;
  const context = preview.getContext('2d')!;
  const cropStatus = controls.querySelector<HTMLElement>('#image-crop-status')!;
  const edges = [...controls.querySelectorAll<HTMLInputElement>('[data-crop-edge]')];
  const edgeValues = [...cropPanel.querySelectorAll<HTMLOutputElement>('output')];
  const reset = controls.querySelector<HTMLButtonElement>('#reset-image-crop')!;

  let source: ImageSource | null = null;
  let crop: ImageCrop = [0, 0, 0, 0];
  let distances: Float64Array | undefined;
  let pending = 0;
  let drag: { pointerId: number; x: number; y: number } | null = null;

  function drawCrop(selection = crop) {
    if (!source) return;
    const { width, height } = preview;
    const bounds = imageCropBounds(width, height, selection);
    context.clearRect(0, 0, width, height);
    context.drawImage(source.preview, 0, 0, width, height);
    if (!selection.some(Boolean)) return;
    context.beginPath();
    context.rect(0, 0, width, height);
    context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.fillStyle = '#111b';
    context.fill('evenodd');
    context.lineWidth = 4;
    context.strokeStyle = '#141414';
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.lineWidth = 2;
    context.strokeStyle = '#f1eee8';
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  function syncCrop() {
    edges.forEach((edge, index) => {
      const max = MAX_CROP_TRIM - crop[(index + 2) % 4];
      edge.max = String(max);
      edge.valueAsNumber = crop[index];
      const value = `${crop[index]}%`;
      edgeValues[index].value = value;
      edge.setAttribute('aria-valuetext', `${value} trimmed`);
      edge.style.setProperty('--progress', `${max === 0 ? 0 : (100 * crop[index]) / max}%`);
    });
    reset.disabled = !crop.some(Boolean);
    cropStatus.textContent = reset.disabled ? 'Full image' : 'Cropped';
    drawCrop();
  }

  function syncSmoothing() {
    const value = `${smoothing.value}%`;
    smoothingValue.value = value;
    smoothing.setAttribute('aria-valuetext', value);
    smoothing.style.setProperty('--progress', value);
  }

  function render() {
    pending = 0;
    if (!source) return;
    // Smoothing and inversion reuse the signed distances until the crop changes.
    distances ??= imageDistances(source, crop);
    onChange(imagePressureGrid(distances, smoothing.valueAsNumber), invert.checked);
  }

  function queueRender() {
    if (!pending) pending = requestAnimationFrame(render);
  }

  function setCrop(selection: ImageCrop) {
    crop = selection;
    distances = undefined;
    syncCrop();
    queueRender();
  }

  edges.forEach((edge, index) =>
    edge.addEventListener('input', () => {
      crop[index] = edge.valueAsNumber;
      setCrop(crop);
    }),
  );
  reset.addEventListener('click', () => setCrop([0, 0, 0, 0]));
  smoothing.addEventListener('input', () => {
    syncSmoothing();
    queueRender();
  });
  invert.addEventListener('input', queueRender);

  function pointerPosition(event: PointerEvent) {
    const bounds = preview.getBoundingClientRect();
    const percent = (value: number, size: number) =>
      Math.round(Math.min(100, Math.max(0, (100 * value) / size)));
    return {
      x: percent(event.clientX - bounds.left, bounds.width),
      y: percent(event.clientY - bounds.top, bounds.height),
    };
  }

  function pointerCrop(event: PointerEvent, start: { x: number; y: number }): ImageCrop {
    const end = pointerPosition(event);
    return [
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      100 - Math.max(start.x, end.x),
      100 - Math.max(start.y, end.y),
    ];
  }

  preview.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    drag = { pointerId: event.pointerId, ...pointerPosition(event) };
    preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener('pointermove', (event) => {
    if (drag?.pointerId === event.pointerId) drawCrop(pointerCrop(event, drag));
  });
  preview.addEventListener('pointerup', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    const selection = pointerCrop(event, drag);
    drag = null;
    const [left, top, right, bottom] = selection;
    if (left + right <= MAX_CROP_TRIM && top + bottom <= MAX_CROP_TRIM) setCrop(selection);
    else drawCrop();
  });
  preview.addEventListener('lostpointercapture', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    drawCrop();
  });

  function clear() {
    cancelAnimationFrame(pending);
    pending = 0;
    drag = null;
    source = null;
    distances = undefined;
    controls.hidden = true;
    preview.width = preview.height = 1;
  }

  return {
    clear,
    set(next: ImageSource) {
      clear();
      source = next;
      crop = [0, 0, 0, 0];
      smoothing.valueAsNumber = IMAGE_SMOOTHING.initial;
      invert.checked = false;
      cropPanel.open = false;
      const { width, height } = source.preview;
      const scale = Math.min(260 / width, 135 / height);
      preview.width = Math.max(1, Math.round(width * scale * 2));
      preview.height = Math.max(1, Math.round(height * scale * 2));
      preview.style.width = `${preview.width / 2}px`;
      syncCrop();
      syncSmoothing();
      controls.hidden = false;
      render();
    },
  };
}
