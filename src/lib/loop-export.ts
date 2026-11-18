export const LOOP_DURATIONS = [8, 16, 32, 64];
export const LOOP_DEFAULT_DURATION = 16;
export const LOOP_FRAME_RATE = 30;
const LONG_EDGE = 1280;

export function loopDimensions(width: number, height: number) {
  const scale = LONG_EDGE / Math.max(width, height);
  // Even dimensions accommodate codecs that subsample chroma in 2×2 blocks.
  const even = (dimension: number) => Math.max(2, Math.round((dimension * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

interface LoopExportOptions {
  svg: SVGSVGElement;
  duration: number;
  renderFrame: (phase: number) => void;
  onProgress: (progress: number) => void;
  signal: AbortSignal;
}

export async function exportLoop({
  svg,
  duration,
  renderFrame,
  onProgress,
  signal,
}: LoopExportOptions) {
  if (typeof VideoEncoder === 'undefined')
    throw new Error('Video encoding is unavailable in this browser.');
  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    Quality,
    WebMOutputFormat,
    canEncodeVideo,
    getFirstEncodableVideoCodec,
  } = await import('mediabunny');
  signal.throwIfAborted();

  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const quality = new Quality('high');
  const options = {
    width,
    height,
    frameRate: LOOP_FRAME_RATE,
    quality,
    latencyMode: 'quality',
  } as const;
  const codec = (await canEncodeVideo('avc', options))
    ? 'avc'
    : await getFirstEncodableVideoCodec(['vp9', 'vp8'], options);
  signal.throwIfAborted();
  if (!codec) throw new Error('Video encoding is unavailable in this browser.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create a video canvas.');

  const target = new BufferTarget();
  const format = codec === 'avc' ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({ target, format });
  const source = new CanvasSource(canvas, { codec, quality, latencyMode: 'quality' });
  output.addVideoTrack(source, { frameRate: LOOP_FRAME_RATE });
  const frameCount = duration * LOOP_FRAME_RATE;
  const serializer = new XMLSerializer();
  const image = new Image();

  try {
    await output.start();
    for (let frame = 0; frame < frameCount; frame += 1) {
      signal.throwIfAborted();
      // Leave the closing frame to the next playback cycle to keep the cadence even.
      renderFrame(frame / frameCount);
      const raster = URL.createObjectURL(
        new Blob([serializer.serializeToString(svg)], { type: 'image/svg+xml' }),
      );
      try {
        image.src = raster;
        await image.decode();
        signal.throwIfAborted();
        context.drawImage(image, 0, 0, width, height);
      } finally {
        URL.revokeObjectURL(raster);
      }
      // Give the encoder time to consume the current canvas before drawing the next frame.
      await source.add(frame / LOOP_FRAME_RATE, 1 / LOOP_FRAME_RATE);
      onProgress((frame + 1) / frameCount);
    }
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer) throw new Error('The video export produced no data.');
    return {
      blob: new Blob([target.buffer], { type: format.mimeType }),
      extension: codec === 'avc' ? 'mp4' : 'webm',
    };
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled')
      await output.cancel().catch(() => {});
    throw error;
  }
}
