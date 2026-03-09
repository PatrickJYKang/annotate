// ---------------------------------------------------------------------------
// Occlusion compositor — fetches segmentation masks from sidecar and
// composites a foreground layer (video pixels where people are) that
// sits above annotations so people appear in front of drawn shapes.
// ---------------------------------------------------------------------------

import { requestSegmentation, type SegmentationResult } from './sidecarClient';

// ---------------------------------------------------------------------------
// LRU mask cache — keyed by rounded frame ms
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_LIMIT = 30;

export class OcclusionCache {
  private _map = new Map<number, ImageBitmap>();
  private _order: number[] = [];
  private _limit: number;

  constructor(limit = DEFAULT_CACHE_LIMIT) {
    this._limit = limit;
  }

  get(key: number): ImageBitmap | undefined {
    const bmp = this._map.get(key);
    if (bmp) {
      // Move to end (most recently used)
      const idx = this._order.indexOf(key);
      if (idx >= 0) this._order.splice(idx, 1);
      this._order.push(key);
    }
    return bmp;
  }

  set(key: number, bmp: ImageBitmap): void {
    if (this._map.has(key)) {
      const idx = this._order.indexOf(key);
      if (idx >= 0) this._order.splice(idx, 1);
    }
    this._map.set(key, bmp);
    this._order.push(key);

    // Evict oldest if over limit
    while (this._order.length > this._limit) {
      const evict = this._order.shift()!;
      const old = this._map.get(evict);
      if (old) old.close();
      this._map.delete(evict);
    }
  }

  has(key: number): boolean {
    return this._map.has(key);
  }

  clear(): void {
    for (const bmp of this._map.values()) {
      bmp.close();
    }
    this._map.clear();
    this._order.length = 0;
  }

  get size(): number {
    return this._map.size;
  }
}

// ---------------------------------------------------------------------------
// Fetch + decode mask
// ---------------------------------------------------------------------------

/**
 * Fetch an occlusion mask from the sidecar for a specific video frame.
 * Returns an ImageBitmap of the alpha mask (single-channel grayscale PNG).
 */
export async function fetchOcclusionMask(
  video: { videoRef?: string; videoPath?: string },
  frameMs: number,
  baseUrl?: string,
): Promise<{ mask: ImageBitmap; width: number; height: number; personCount: number }> {
  const result: SegmentationResult = await requestSegmentation(
    { ...video, frameMs },
    baseUrl,
  );

  // Decode base64 data URI to ImageBitmap
  const resp = await fetch(result.mask);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);

  return {
    mask: bmp,
    width: result.width,
    height: result.height,
    personCount: result.personCount,
  };
}

// ---------------------------------------------------------------------------
// Composite foreground layer
// ---------------------------------------------------------------------------

/**
 * Given a video frame (as CanvasImageSource) and a mask (ImageBitmap),
 * produce a composited foreground canvas where only the masked (person)
 * pixels from the video are visible.
 *
 * The result can be used as a Konva Image source on a layer above annotations.
 */
export function compositeForeground(
  videoFrame: CanvasImageSource,
  mask: ImageBitmap,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Draw the video frame
  ctx.drawImage(videoFrame, 0, 0, width, height);

  // Apply mask as alpha: keep only pixels where mask is opaque
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

// ---------------------------------------------------------------------------
// Round frame ms to nearest frame boundary for cache keying
// ---------------------------------------------------------------------------

export function roundToFrame(ms: number, fps: number): number {
  if (fps <= 0) return Math.round(ms);
  const frameDuration = 1000 / fps;
  return Math.round(ms / frameDuration) * frameDuration;
}
