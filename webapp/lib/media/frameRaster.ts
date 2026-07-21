import type { VideoFrame } from '../clip/frameMath';
import { frameToSeconds } from '../clip/frameMath';
import { assertSafePathSegment } from '../fs/fsAccess';

export interface FrameRasterRequest {
  frame: VideoFrame;
  fps: number;
  outputWidth?: number;
}

export interface FrameRasterResult {
  blob: Blob;
  width: number;
  height: number;
}

export interface FrameRasterQueue {
  rasterize(request: FrameRasterRequest): Promise<FrameRasterResult>;
  dispose(): void;
}

export type FrameRasterRenderer = (
  request: FrameRasterRequest,
) => Promise<FrameRasterResult>;

export function frameRasterCachePath(
  videoId: string,
  frame: VideoFrame,
  outputWidth: number,
): string {
  assertSafePathSegment(videoId);
  if (!Number.isInteger(frame) || frame < 0) throw new Error('Frame must be a non-negative integer.');
  if (!Number.isInteger(outputWidth) || outputWidth <= 0) {
    throw new Error('Frame-raster output width must be a positive integer.');
  }
  return `cache/frames/${videoId}/${frame}@${outputWidth}.png`;
}

export function createSerializedFrameRasterQueue(renderer: FrameRasterRenderer): FrameRasterQueue {
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;

  return {
    rasterize(request) {
      if (disposed) return Promise.reject(new Error('Frame raster queue has been disposed.'));
      const result = tail.then(() => renderer(request));
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    dispose() {
      disposed = true;
    },
  };
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed to load video metadata for frame rasterization.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 1e-7 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to seek video to ${seconds.toFixed(6)}s.`));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = seconds;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encode failed during frame rasterization.'));
    }, 'image/png');
  });
}

async function rasterizeVideo(
  video: HTMLVideoElement,
  request: FrameRasterRequest,
): Promise<FrameRasterResult> {
  if (!Number.isFinite(request.fps) || request.fps <= 0) throw new Error('fps must be positive.');
  if (!Number.isInteger(request.frame) || request.frame < 0) throw new Error('frame must be non-negative.');
  await waitForMetadata(video);
  await seekVideo(video, frameToSeconds(request.frame, request.fps));

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const width = request.outputWidth ?? sourceWidth;
  if (!Number.isInteger(width) || width <= 0) throw new Error('outputWidth must be a positive integer.');
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  context.drawImage(video, 0, 0, width, height);
  return { blob: await canvasToPng(canvas), width, height };
}

function cloneVideoSource(source: HTMLVideoElement): HTMLVideoElement {
  const sourceUrl = source.currentSrc || source.src;
  if (!sourceUrl) {
    throw new Error('Frame rasterization requires a URL-backed video source that can be cloned safely.');
  }
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = source.crossOrigin;
  video.src = sourceUrl;
  return video;
}

export function createFrameRasterQueue(source: File | HTMLVideoElement): FrameRasterQueue {
  let objectUrl: string | null = null;
  let video: HTMLVideoElement;
  if (source instanceof File) {
    objectUrl = URL.createObjectURL(source);
    video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
  } else {
    video = cloneVideoSource(source);
  }

  const queue = createSerializedFrameRasterQueue((request) => rasterizeVideo(video, request));
  return {
    rasterize: queue.rasterize,
    dispose() {
      queue.dispose();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    },
  };
}
