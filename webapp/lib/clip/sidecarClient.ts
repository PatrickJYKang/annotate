// ---------------------------------------------------------------------------
// Sidecar API client — communicates with the Python ML sidecar service.
// ---------------------------------------------------------------------------

export const SIDECAR_BASE_URL =
  (typeof window !== 'undefined' && (window as any).__SIDECAR_URL) ||
  process.env.NEXT_PUBLIC_SIDECAR_URL ||
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

export interface DerivedMediaJobStatusResponse {
  jobId: string;
  kind: 'preview_proxy';
  status: 'queued' | 'running' | 'finalizing' | 'ready' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  label?: string;
  sizeBytes?: number;
  error?: string;
  outputAvailable: boolean;
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

async function buildErrorMessageFromResponse(
  res: Response,
  fallback: string,
): Promise<string> {
  const body = await res.json().catch(async () => {
    const text = await res.text().catch(() => '');
    return text ? { detail: text } : {};
  });
  return extractErrorMessage(body, fallback);
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
    throw new Error(await buildErrorMessageFromResponse(res, `Video register failed (${res.status})`));
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
    throw new Error(await buildErrorMessageFromResponse(res, `Manual homography track failed (${res.status})`));
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
    throw new Error(await buildErrorMessageFromResponse(res, `Segmentation failed (${res.status})`));
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

export interface ExactMotionEncodeParams {
  videoPath?: string;
  videoRef?: string;
  startMs: number;
  endMs: number;
}

export interface PreviewProxyEncodeParams {
  videoPath?: string;
  videoRef?: string;
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
    throw new Error(await buildErrorMessageFromResponse(res, `Export start failed (${res.status})`));
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
    throw new Error(await buildErrorMessageFromResponse(res, `Export frame failed (${res.status})`));
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
    throw new Error(await buildErrorMessageFromResponse(res, `Export encode failed (${res.status})`));
  }
  return await res.json();
}

export async function requestExactMotionEncode(
  params: ExactMotionEncodeParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<Blob> {
  const res = await fetch(`${baseUrl}/derived-media/exact-motion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Exact-motion encode failed (${res.status})`));
  }
  return await res.blob();
}

export async function requestPreviewProxyEncode(
  params: PreviewProxyEncodeParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<Blob> {
  const res = await fetch(`${baseUrl}/derived-media/preview-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Preview proxy encode failed (${res.status})`));
  }
  return await res.blob();
}

export async function startPreviewProxyEncodeJob(
  params: PreviewProxyEncodeParams,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<DerivedMediaJobStatusResponse> {
  const res = await fetch(`${baseUrl}/derived-media/preview-proxy/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Preview proxy encode job failed (${res.status})`));
  }
  return await res.json();
}

export async function getDerivedMediaJobStatus(
  jobId: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<DerivedMediaJobStatusResponse> {
  const res = await fetch(`${baseUrl}/derived-media/jobs/${jobId}`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Derived-media job lookup failed (${res.status})`));
  }
  return await res.json();
}

export async function downloadDerivedMediaJobOutput(
  jobId: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<Blob> {
  const res = await fetch(`${baseUrl}/derived-media/jobs/${jobId}/file`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Derived-media job download failed (${res.status})`));
  }
  return await res.blob();
}

export async function cleanupDerivedMediaJob(
  jobId: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<void> {
  await fetch(`${baseUrl}/derived-media/jobs/${jobId}`, {
    method: 'DELETE',
  }).catch(() => {});
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
    throw new Error(await buildErrorMessageFromResponse(res, `Homography failed (${res.status})`));
  }

  return await res.json();
}
