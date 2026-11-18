import { CANVAS_HEIGHT, CANVAS_WIDTH } from './pattern';
import type { PatternView } from './pattern-view';
import { MAX_SCULPT_POINTS, SCULPT_RADIUS, SCULPT_STRENGTH } from './sculpt';
import type { SculptPoint } from './sculpt';

interface SculptActions {
  enter: () => void;
  setView: (view: 'flat' | '3d') => void;
  paint: () => void;
  announce: (message: string) => void;
}

interface Position {
  x: number;
  y: number;
}
interface Snapshot {
  points: readonly SculptPoint[];
  selected: number;
}
interface Drag {
  pointerId: number;
  before: Snapshot;
  offset: Position;
}

const arrows: Record<string, Position> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function createSculptEditor(svg: SVGSVGElement, actions: SculptActions) {
  const trigger = document.querySelector<HTMLButtonElement>('#open-sculpt')!;
  const panel = document.querySelector<HTMLElement>('#sculpt-panel')!;
  const canvas = document.querySelector<HTMLElement>('#sculpt-canvas')!;
  const guide = canvas.querySelector<HTMLElement>('#sculpt-radius-guide')!;
  const peak = panel.querySelector<HTMLButtonElement>('#sculpt-peak')!;
  const valley = panel.querySelector<HTMLButtonElement>('#sculpt-valley')!;
  const ranges = panel.querySelector<HTMLFieldSetElement>('#sculpt-ranges')!;
  const radius = ranges.querySelector<HTMLInputElement>('#sculpt-radius')!;
  const strength = ranges.querySelector<HTMLInputElement>('#sculpt-strength')!;
  const undo = panel.querySelector<HTMLButtonElement>('#sculpt-undo')!;
  const remove = panel.querySelector<HTMLButtonElement>('#sculpt-remove')!;
  const preview = panel.querySelector<HTMLButtonElement>('#sculpt-view')!;
  const done = panel.querySelector<HTMLButtonElement>('#sculpt-done')!;
  const hint = panel.querySelector<HTMLElement>('#sculpt-hint')!;

  const defaults = { radius: SCULPT_RADIUS.initial, strength: SCULPT_STRENGTH.initial };
  // Point edits replace the array, so undo can retain earlier states by reference.
  const history: Snapshot[] = [];
  const markers: HTMLButtonElement[] = [];
  let points: readonly SculptPoint[] = [];
  let selected = -1;
  let tool: SculptPoint['kind'] = 'peak';
  let view: PatternView = 'flat';
  let active = false;
  let drag: Drag | null = null;
  let rangeEdit: Snapshot | null = null;
  let pendingPaint = 0;

  function snapshot(): Snapshot {
    return { points, selected };
  }

  function remember(before: Snapshot) {
    if (before.points === points) return;
    if (history.length === 40) history.shift();
    history.push(before);
    undo.disabled = false;
  }

  function paint() {
    if (pendingPaint) cancelAnimationFrame(pendingPaint);
    pendingPaint = 0;
    actions.paint();
  }

  function queuePaint() {
    // The marker follows each pointer event while contour tracing runs once per frame.
    if (!pendingPaint) pendingPaint = requestAnimationFrame(paint);
  }

  function projectMarkers() {
    // The SVG matrix accounts for the responsive crop and fullscreen scaling.
    const matrix = canvas.hidden ? null : svg.getScreenCTM();
    guide.hidden = true;
    if (!matrix) return;

    const bounds = canvas.getBoundingClientRect();
    points.forEach((point, index) => {
      const projected = new DOMPoint(
        point.x * CANVAS_WIDTH,
        point.y * CANVAS_HEIGHT,
      ).matrixTransform(matrix);
      const x = projected.x - bounds.left;
      const y = projected.y - bounds.top;
      const marker = markers[index];
      marker.hidden = x < -1 || x > bounds.width + 1 || y < -1 || y > bounds.height + 1;
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;

      if (selected === index && !marker.hidden) {
        const diameter = (point.radius * CANVAS_HEIGHT * Math.abs(matrix.a)) / 50;
        guide.hidden = false;
        guide.dataset.kind = point.kind;
        guide.style.left = `${x}px`;
        guide.style.top = `${y}px`;
        guide.style.width = guide.style.height = `${diameter}px`;
      }
    });
  }

  function syncRange(input: HTMLInputElement, value: number) {
    input.valueAsNumber = value;
    const percentage = `${value}%`;
    const output = panel.querySelector<HTMLOutputElement>(`#${input.id}-value`)!;
    output.value = percentage;
    input.setAttribute('aria-valuetext', percentage);
    input.style.setProperty(
      '--progress',
      `${(100 * (value - Number(input.min))) / (Number(input.max) - Number(input.min))}%`,
    );
  }

  function sync() {
    const editing = active && view === 'flat';
    panel.hidden = !active;
    canvas.hidden = !editing;
    trigger.setAttribute('aria-pressed', String(active));
    preview.textContent = view === 'flat' ? 'Preview 3D' : 'Edit in Flat';
    peak.disabled = valley.disabled = ranges.disabled = active && !editing;
    peak.setAttribute('aria-pressed', String(tool === 'peak'));
    valley.setAttribute('aria-pressed', String(tool === 'valley'));
    undo.disabled = !history.length;
    remove.disabled = !editing || selected < 0;

    const point = points[selected];
    syncRange(radius, (point ?? defaults).radius);
    syncRange(strength, (point ?? defaults).strength);
    hint.textContent = !editing
      ? 'Choose Edit in Flat to move or add points.'
      : point
        ? `${point.kind === 'peak' ? 'Peak' : 'Valley'} ${selected + 1} selected. Drag to move, or click the canvas to add another.`
        : 'Click or tap the canvas to place a point. Drag a marker to move it.';

    while (markers.length > points.length) markers.pop()?.remove();
    while (markers.length < points.length) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'sculpt-marker';
      canvas.append(marker);
      markers.push(marker);
    }
    points.forEach((entry, index) => {
      const marker = markers[index];
      marker.dataset.kind = entry.kind;
      marker.textContent = entry.kind === 'peak' ? '+' : '−';
      marker.setAttribute(
        'aria-label',
        `${entry.kind === 'peak' ? 'Peak' : 'Valley'} ${index + 1}`,
      );
      marker.setAttribute('aria-pressed', String(selected === index));
    });
    projectMarkers();
  }

  function place(at: Position) {
    if (points.length >= MAX_SCULPT_POINTS) {
      hint.textContent = `You can place up to ${MAX_SCULPT_POINTS} points. Remove one to add another.`;
      actions.announce(hint.textContent);
      return false;
    }
    points = [...points, { kind: tool, ...at, ...defaults }];
    selected = points.length - 1;
    return true;
  }

  function replace(point: SculptPoint) {
    points = points.map((item, index) => (index === selected ? point : item));
  }

  function cursor(event: PointerEvent): Position | null {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: at.x / CANVAS_WIDTH, y: at.y / CANVAS_HEIGHT };
  }

  function withinCanvas({ x, y }: Position) {
    const box = svg.viewBox.baseVal;
    const clamp = (value: number, origin: number, size: number, edge: number) => {
      const min = Math.max(0, origin / edge);
      const max = Math.min(1, (origin + size) / edge);
      return Math.round(10_000 * Math.max(min, Math.min(max, value))) / 10_000;
    };
    return {
      x: clamp(x, box.x, box.width, CANVAS_WIDTH),
      y: clamp(y, box.y, box.height, CANVAS_HEIGHT),
    };
  }

  function move(at: Position) {
    const point = points[selected];
    const next = withinCanvas(at);
    if (next.x === point.x && next.y === point.y) return;
    replace({ ...point, ...next });
    projectMarkers();
    queuePaint();
  }

  function endDrag(canceled = false) {
    if (!drag) return;
    const { before, pointerId } = drag;
    drag = null;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    const changed = points !== before.points;
    if (canceled) ({ points, selected } = before);
    else remember(before);
    sync();
    if (pendingPaint || (canceled && changed)) paint();
  }

  function endRangeEdit() {
    if (!rangeEdit) return;
    remember(rangeEdit);
    rangeEdit = null;
    if (pendingPaint) paint();
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    const at = cursor(event);
    if (!at) return;
    endRangeEdit();

    const before = snapshot();
    const hit = markers.indexOf(event.target as HTMLButtonElement);
    if (hit >= 0) selected = hit;
    else if (!place(withinCanvas(at))) return;
    event.preventDefault();
    const point = points[selected];
    // Keep the grab offset and treat placement plus dragging as one undoable edit.
    drag = { pointerId: event.pointerId, before, offset: { x: point.x - at.x, y: point.y - at.y } };
    canvas.setPointerCapture(event.pointerId);
    sync();
    markers[selected].focus({ preventScroll: true });
    if (hit < 0) queuePaint();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    const at = cursor(event);
    if (at) move({ x: at.x + drag.offset.x, y: at.y + drag.offset.y });
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    const at = cursor(event);
    if (at) move({ x: at.x + drag.offset.x, y: at.y + drag.offset.y });
    endDrag();
  });
  canvas.addEventListener('lostpointercapture', (event) => {
    if (drag?.pointerId === event.pointerId) endDrag(true);
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (drag?.pointerId === event.pointerId) endDrag(true);
  });

  canvas.addEventListener('focusin', (event) => {
    const index = markers.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || index === selected || drag) return;
    selected = index;
    sync();
  });

  function removeSelected() {
    endDrag();
    endRangeEdit();
    if (selected < 0) return;
    const before = snapshot();
    points = points.filter((_, index) => index !== selected);
    selected = -1;
    remember(before);
    sync();
    canvas.focus({ preventScroll: true });
    paint();
    actions.announce('Sculpt point removed.');
  }

  canvas.addEventListener('keydown', (event) => {
    if (drag) return;
    const index = markers.indexOf(event.target as HTMLButtonElement);
    if (index >= 0 && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      removeSelected();
    } else if (index >= 0 && arrows[event.key]) {
      event.preventDefault();
      const before = snapshot();
      const direction = arrows[event.key];
      const step = event.shiftKey ? 0.04 : 0.01;
      const point = points[index];
      move({ x: point.x + direction.x * step, y: point.y + direction.y * step });
      remember(before);
    } else if (event.target === canvas && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const before = snapshot();
      const box = svg.viewBox.baseVal;
      if (
        !place(
          withinCanvas({
            x: (box.x + box.width / 2) / CANVAS_WIDTH,
            y: (box.y + box.height / 2) / CANVAS_HEIGHT,
          }),
        )
      )
        return;
      remember(before);
      sync();
      markers[selected].focus({ preventScroll: true });
      paint();
    }
  });

  function undoEdit() {
    if (drag) endDrag();
    endRangeEdit();
    const before = history.pop();
    if (!before) return;
    ({ points, selected } = before);
    sync();
    paint();
    actions.announce('Sculpt edit undone.');
  }

  function choose(next: SculptPoint['kind']) {
    endDrag();
    endRangeEdit();
    tool = next;
    selected = -1;
    sync();
  }
  peak.addEventListener('click', () => choose('peak'));
  valley.addEventListener('click', () => choose('valley'));
  remove.addEventListener('click', removeSelected);
  undo.addEventListener('click', undoEdit);

  for (const [input, key] of [
    [radius, 'radius'],
    [strength, 'strength'],
  ] as const) {
    input.addEventListener('input', () => {
      const value = input.valueAsNumber;
      if (selected >= 0) {
        rangeEdit ??= snapshot();
        replace({ ...points[selected], [key]: value });
        projectMarkers();
        queuePaint();
      } else {
        defaults[key] = value;
      }
      syncRange(input, value);
    });
    input.addEventListener('change', endRangeEdit);
    input.addEventListener('blur', endRangeEdit);
  }

  function close(focus = true) {
    if (!active) return false;
    endDrag();
    endRangeEdit();
    active = false;
    sync();
    if (focus && !trigger.inert) trigger.focus({ preventScroll: true });
    actions.announce('Sculpt mode closed. Edits kept.');
    return true;
  }

  trigger.addEventListener('click', () => {
    if (active) {
      close();
      return;
    }
    active = true;
    actions.enter();
    sync();
    (tool === 'peak' ? peak : valley).focus({ preventScroll: true });
    actions.announce('Sculpt mode. Place peaks and valleys on the canvas.');
  });
  preview.addEventListener('click', () => {
    endDrag();
    endRangeEdit();
    actions.setView(view === 'flat' ? '3d' : 'flat');
  });
  done.addEventListener('click', () => close());

  document.addEventListener('keydown', (event) => {
    if (!active || document.querySelector('dialog[open]') || event.shiftKey || event.altKey) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    undoEdit();
  });

  return {
    close,
    get points() {
      return points;
    },
    reset(next: readonly SculptPoint[] = []) {
      endDrag(true);
      cancelAnimationFrame(pendingPaint);
      pendingPaint = 0;
      rangeEdit = null;
      history.length = 0;
      points = next;
      selected = -1;
      sync();
    },
    setAvailable(available: boolean) {
      trigger.disabled = !available;
      if (!available) close(false);
    },
    updateView(next: PatternView) {
      if (view === next) {
        projectMarkers();
        return;
      }
      view = next;
      sync();
    },
    setFullscreen(expanded: boolean) {
      trigger.inert = expanded;
    },
  };
}
