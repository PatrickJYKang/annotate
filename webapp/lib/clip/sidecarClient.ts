// ---------------------------------------------------------------------------
// Sidecar API client — communicates with the Python ML sidecar service.
// ---------------------------------------------------------------------------

export const SIDECAR_BASE_URL =
  (typeof window !== 'undefined' && (window as any).__SIDECAR_URL) ||
  'http://127.0.0.1:8321';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  capabilities: string[];
  models: {
    yolo: boolean;
    mobilesam: boolean;
    narya: boolean;
    opencv: boolean;
  };
}

export interface TrackingParams {
  videoPath?: string;
  videoRef?: string;
  startMs: number;
  endMs: number;
  seedBbox: { x: number; y: number; w: number; h: number };
  seedFrameMs: number;
  fps?: number;
  classes?: number[];
  confThreshold?: number;
  iouThreshold?: number;
}

export interface TrackingKeyframe {
  tMs: number;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface TrackingResult {
  keyframes: TrackingKeyframe[];
  trackId: number;
  detectionCount: number;
}

export interface TrackingError {
  message: string;
  detectedBboxes?: { x: number; y: number; w: number; h: number; confidence: number }[];
}

export interface SegmentationParams {
  videoPath?: string;
  videoRef?: string;
  frameMs: number;
  confThreshold?: number;
}

export interface SegmentationResult {
  mask: string;  // data:image/png;base64,...
  width: number;
  height: number;
  personCount: number;
}

export interface HomographyParams {
  videoPath?: string;
  videoRef?: string;
  startMs: number;
  endMs: number;
  fps?: number;
  skipInterval?: number;
}

export interface ManualTrackHomographyParams {
  videoPath?: string;
  videoRef?: string;
  startMs: number;
  endMs: number;
  seedMs: number;
  seedMatrix: number[];
  fps?: number;
  skipInterval?: number;
}

export interface VideoRegisterResult {
  videoRef: string;
  filename: string;
  sizeBytes: number;
}

export interface HomographyFrameResult {
  tMs: number;
  matrix: number[];  // 9 floats, row-major 3×3
  method: string;
}

export interface HomographyResult {
  frames: HomographyFrameResult[];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export function extractErrorMessage(body: any, fallback: string): string {
  const detail = body?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail === 'object' && typeof detail.message === 'string' && detail.message) {
    return detail.message;
  }
  if (typeof body?.message === 'string' && body.message) return body.message;
  return fallback;
}

export async function checkHealth(
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Video registration
// ---------------------------------------------------------------------------

export async function registerVideoFile(
  file: File,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<VideoRegisterResult> {
  const form = new FormData();
  form.append('file', file, file.name || 'video.mp4');

  const res = await fetch(`${baseUrl}/video/register`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Video register failed (${res.status})`));
  }

  return await res.json();
}

export async function requestManualTrackHomography(
  params: ManualTrackHomographyParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<HomographyResult> {
  const res = await fetch(`${baseUrl}/homography/manual-track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Manual homography track failed (${res.status})`));
  }

  return await res.json();
}

export async function unregisterVideoRef(
  videoRef: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<void> {
  await fetch(`${baseUrl}/video/${videoRef}`, { method: 'DELETE' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export async function requestTracking(
  params: TrackingParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<TrackingResult> {
  const res = await fetch(`${baseUrl}/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail;
    if (typeof detail === 'object' && detail !== null) {
      const err: TrackingError = {
        message: extractErrorMessage(body, `Tracking failed (${res.status})`),
        detectedBboxes: detail.detectedBboxes,
      };
      throw err;
    }
    throw { message: extractErrorMessage(body, `Tracking failed (${res.status})`) } as TrackingError;
  }

  return await res.json();
}

export async function requestSegmentation(
  params: SegmentationParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<SegmentationResult> {
  const res = await fetch(`${baseUrl}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Segmentation failed (${res.status})`));
  }

  return await res.json();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportStartParams {
  clipId: string;
  fps?: number;
  width?: number;
  height?: number;
}

export interface ExportStartResult {
  sessionId: string;
  framesDir: string;
}

export interface ExportEncodeResult {
  outputPath: string;
}

export async function startExport(
  params: ExportStartParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<ExportStartResult> {
  const res = await fetch(`${baseUrl}/export/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Export start failed (${res.status})`));
  }
  return await res.json();
}

export async function sendExportFrame(
  sessionId: string,
  frameIndex: number,
  imageBase64: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<{ frameIndex: number; path: string }> {
  const res = await fetch(`${baseUrl}/export/frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, frameIndex, image: imageBase64 }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Export frame failed (${res.status})`));
  }
  return await res.json();
}

export async function encodeExport(
  sessionId: string,
  fps: number = 30,
  outputPath?: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<ExportEncodeResult> {
  const res = await fetch(`${baseUrl}/export/encode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, fps, outputPath }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Export encode failed (${res.status})`));
  }
  return await res.json();
}

export async function cleanupExport(
  sessionId: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<void> {
  await fetch(`${baseUrl}/export/${sessionId}`, { method: 'DELETE' }).catch(() => {});
}

export async function requestHomography(
  params: HomographyParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<HomographyResult> {
  const res = await fetch(`${baseUrl}/homography`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, `Homography failed (${res.status})`));
  }

  return await res.json();
}
