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
    supervision?: boolean;
    lap?: boolean;
    mobilesam: boolean;
    ellipse?: boolean;
    pnlcalib?: boolean;
    opencv: boolean;
  };
  tracking?: {
    backend: string;
    detectorModelName: string;
    sampleFps: number;
    classes: number[];
    confThreshold: number;
    iouThreshold: number;
    trackBufferFrames: number;
    minimumConsecutiveFrames?: number;
    directionConsistencyWeight?: number;
    highConfDetThreshold?: number;
    deltaT?: number;
  };
  homography?: {
    providerName: string | null;
    providers: Array<{
      name: string;
      supports_manual_seed_tracking: boolean;
      available: boolean;
    }>;
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
  debugVideo?: boolean;
  stopOnLoss?: boolean;
}

export interface PlayerDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface PlayerDetectionParams {
  videoPath?: string;
  videoRef?: string;
  frameMs: number;
  classes?: number[];
  confThreshold?: number;
}

export interface PlayerDetectionResult {
  frameMs: number;
  detections: PlayerDetection[];
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
  debugVideoPath?: string;
  debugVideoUrl?: string;
  completed?: boolean;
  stoppedAtMs?: number | null;
}

export interface TrackingError {
  message: string;
  detectedBboxes?: { x: number; y: number; w: number; h: number; confidence: number }[];
  debugVideoPath?: string;
  debugVideoUrl?: string;
}

type TrackingStreamEvent =
  | { type: 'keyframe'; keyframe: TrackingKeyframe }
  | { type: 'result'; result: TrackingResult }
  | { type: 'error'; error: Record<string, unknown> };

export interface SegmentationParams {
  videoPath?: string;
  videoRef?: string;
  frameMs: number;
  confThreshold?: number;
}

export interface SegmentationResult {
  mask: string;
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

export interface VideoRegisterResult {
  videoRef: string;
  filename: string;
  sizeBytes: number;
}

export interface AuthoritativeVideoMetadata {
  fps: number;
  fpsNumerator?: number;
  fpsDenominator?: number;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
  frameCountSource: 'normalize' | 'probe';
  importStrategy?: 'preserve' | 'remux' | 'transcode';
}

export interface NormalizedVideoImportResult {
  blob: Blob;
  metadata: AuthoritativeVideoMetadata;
}

export type VideoNormalizationPhase =
  | 'uploading'
  | 'queued'
  | 'analyzing'
  | 'remuxing'
  | 'transcoding'
  | 'normalizing'
  | 'probing'
  | 'downloading'
  | 'complete';

export interface VideoNormalizationProgress {
  phase: VideoNormalizationPhase;
  progress: number;
}

export interface NormalizeVideoImportOptions {
  onProgress?: (progress: VideoNormalizationProgress) => void;
  signal?: AbortSignal;
}

interface NormalizationJobStatus {
  jobId: string;
  status: 'queued' | 'analyzing' | 'remuxing' | 'transcoding' | 'normalizing' | 'probing' | 'complete' | 'failed' | 'canceled';
  progress: number;
  error?: string | null;
  metadata?: AuthoritativeVideoMetadata | null;
}

export interface HomographyFrameResult {
  tMs: number;
  matrix: number[];
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

export async function unregisterVideoRef(
  videoRef: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<void> {
  await fetch(`${baseUrl}/video/${videoRef}`, { method: 'DELETE' }).catch(() => {});
}

async function requestNormalizedVideo(
  file: File,
  fps: number,
  resolution?: { width: number; height: number },
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<Response> {
  const form = new FormData();
  form.append('file', file, file.name || 'video');
  form.append('fps', String(fps));
  if (resolution) {
    form.append('width', String(resolution.width));
    form.append('height', String(resolution.height));
  }

  const res = await fetch(`${baseUrl}/video/normalize`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Video normalization failed (${res.status})`));
  }

  return res;
}

export function readNormalizedVideoMetadata(
  response: Pick<Response, 'headers'>,
  resolution: { width: number; height: number },
): AuthoritativeVideoMetadata {
  const frameCount = Number(response.headers.get('X-Annotate-Frame-Count'));
  const fps = Number(response.headers.get('X-Annotate-Fps'));
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error('Video normalization did not return an authoritative frame count.');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('Video normalization did not return an authoritative frame rate.');
  }
  return {
    fps,
    frameCount,
    width: resolution.width,
    height: resolution.height,
    durationMs: (frameCount * 1000) / fps,
    frameCountSource: 'normalize',
  };
}

function emitNormalizationProgress(
  callback: NormalizeVideoImportOptions['onProgress'],
  phase: VideoNormalizationPhase,
  progress: number,
): void {
  callback?.({ phase, progress: Math.max(0, Math.min(1, progress)) });
}

const IMPORT_UPLOAD_END = 0.35;
const IMPORT_ANALYSIS_END = 0.45;
const IMPORT_MEDIA_END = 0.92;

async function startNormalizationJobWithFetch(
  form: FormData,
  baseUrl: string,
  options: NormalizeVideoImportOptions,
): Promise<{ jobId: string }> {
  emitNormalizationProgress(options.onProgress, 'uploading', 0);
  const response = await fetch(`${baseUrl}/video/normalize/start`, {
    method: 'POST',
    body: form,
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(await buildErrorMessageFromResponse(response, `Video import upload failed (${response.status})`));
  }
  emitNormalizationProgress(options.onProgress, 'uploading', IMPORT_UPLOAD_END);
  return response.json();
}

function startNormalizationJobWithUploadProgress(
  form: FormData,
  baseUrl: string,
  options: NormalizeVideoImportOptions,
): Promise<{ jobId: string }> {
  if (typeof XMLHttpRequest === 'undefined') {
    return startNormalizationJobWithFetch(form, baseUrl, options);
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = () => options.signal?.removeEventListener('abort', abort);
    request.open('POST', `${baseUrl}/video/normalize/start`);
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      const ratio = event.lengthComputable && event.total > 0 ? event.loaded / event.total : 0;
      emitNormalizationProgress(options.onProgress, 'uploading', ratio * IMPORT_UPLOAD_END);
    };
    request.onerror = () => {
      finish();
      reject(new Error('Video import upload failed.'));
    };
    request.onabort = () => {
      finish();
      reject(new DOMException('Video import was canceled.', 'AbortError'));
    };
    request.onload = () => {
      finish();
      const body = request.response ?? (() => {
        try { return JSON.parse(request.responseText); } catch { return {}; }
      })();
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(extractErrorMessage(body, `Video import upload failed (${request.status})`)));
        return;
      }
      if (typeof body?.jobId !== 'string' || !body.jobId) {
        reject(new Error('Video import did not return a job id.'));
        return;
      }
      emitNormalizationProgress(options.onProgress, 'uploading', IMPORT_UPLOAD_END);
      resolve({ jobId: body.jobId });
    };
    if (options.signal?.aborted) {
      request.abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    request.send(form);
  });
}

function waitForNormalizationPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const abort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Video normalization was canceled.', 'AbortError'));
    };
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    timer = globalThis.setTimeout(finish, 350);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function readNormalizationDownload(
  response: Response,
  options: NormalizeVideoImportOptions,
): Promise<Blob> {
  const total = Number(response.headers.get('Content-Length'));
  if (!response.body) {
    const blob = await response.blob();
    emitNormalizationProgress(options.onProgress, 'downloading', 1);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  while (true) {
    if (options.signal?.aborted) {
      await reader.cancel();
      throw new DOMException('Video normalization was canceled.', 'AbortError');
    }
    const result = await reader.read();
    if (result.done) break;
    const chunk = new ArrayBuffer(result.value.byteLength);
    new Uint8Array(chunk).set(result.value);
    chunks.push(chunk);
    received += result.value.byteLength;
    const ratio = Number.isFinite(total) && total > 0 ? received / total : 0;
    emitNormalizationProgress(options.onProgress, 'downloading', 0.95 + ratio * 0.05);
  }
  return new Blob(chunks, { type: response.headers.get('Content-Type') ?? 'video/mp4' });
}

function readJobMetadata(raw: unknown): AuthoritativeVideoMetadata {
  const metadata = raw as Partial<AuthoritativeVideoMetadata> | null;
  if (
    !metadata
    || !Number.isFinite(metadata.fps)
    || Number(metadata.fps) <= 0
    || !Number.isInteger(metadata.frameCount)
    || Number(metadata.frameCount) <= 0
    || !Number.isInteger(metadata.width)
    || Number(metadata.width) <= 0
    || !Number.isInteger(metadata.height)
    || Number(metadata.height) <= 0
    || (metadata.frameCountSource !== 'normalize' && metadata.frameCountSource !== 'probe')
    || !['preserve', 'remux', 'transcode'].includes(String(metadata.importStrategy))
  ) {
    throw new Error('Video import did not return authoritative media metadata.');
  }
  return metadata as AuthoritativeVideoMetadata;
}

async function runVideoImportJob(
  file: File,
  target: { fps: number; width: number; height: number } | null,
  options: NormalizeVideoImportOptions = {},
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<NormalizedVideoImportResult> {
  const form = new FormData();
  form.append('file', file, file.name || 'video');
  if (target) {
    form.append('fps', String(target.fps));
    form.append('width', String(target.width));
    form.append('height', String(target.height));
  }
  let jobId: string | null = null;
  let metadata: AuthoritativeVideoMetadata | null = null;
  try {
    ({ jobId } = await startNormalizationJobWithUploadProgress(form, baseUrl, options));
    emitNormalizationProgress(options.onProgress, 'queued', IMPORT_UPLOAD_END);

    while (true) {
      const statusResponse = await fetch(`${baseUrl}/video/normalize/${jobId}`, { signal: options.signal });
      if (!statusResponse.ok) {
        throw new Error(await buildErrorMessageFromResponse(
          statusResponse,
          `Video import status failed (${statusResponse.status})`,
        ));
      }
      const status = await statusResponse.json() as NormalizationJobStatus;
      if (status.status === 'failed' || status.status === 'canceled') {
        throw new Error(status.error || `Video import ${status.status}.`);
      }
      if (status.status === 'analyzing') {
        emitNormalizationProgress(options.onProgress, 'analyzing', IMPORT_UPLOAD_END + status.progress * (IMPORT_ANALYSIS_END - IMPORT_UPLOAD_END));
      } else if (status.status === 'remuxing') {
        emitNormalizationProgress(options.onProgress, 'remuxing', IMPORT_ANALYSIS_END + status.progress * (IMPORT_MEDIA_END - IMPORT_ANALYSIS_END));
      } else if (status.status === 'transcoding') {
        emitNormalizationProgress(options.onProgress, 'transcoding', IMPORT_ANALYSIS_END + status.progress * (IMPORT_MEDIA_END - IMPORT_ANALYSIS_END));
      } else if (status.status === 'normalizing') {
        emitNormalizationProgress(options.onProgress, 'normalizing', IMPORT_ANALYSIS_END + status.progress * (IMPORT_MEDIA_END - IMPORT_ANALYSIS_END));
      } else if (status.status === 'probing') {
        emitNormalizationProgress(options.onProgress, 'probing', 0.93);
      } else if (status.status === 'complete') {
        metadata = readJobMetadata(status.metadata);
        break;
      } else {
        emitNormalizationProgress(options.onProgress, 'queued', IMPORT_UPLOAD_END);
      }
      await waitForNormalizationPoll(options.signal);
    }

    if (!metadata) throw new Error('Video import completed without authoritative metadata.');
    if (metadata.importStrategy === 'preserve') {
      await fetch(`${baseUrl}/video/normalize/${jobId}`, { method: 'DELETE' });
      jobId = null;
      emitNormalizationProgress(options.onProgress, 'complete', 1);
      return { blob: file, metadata };
    }

    emitNormalizationProgress(options.onProgress, 'downloading', 0.95);
    const response = await fetch(`${baseUrl}/video/normalize/${jobId}/file`, { signal: options.signal });
    if (!response.ok) {
      throw new Error(await buildErrorMessageFromResponse(response, `Video import download failed (${response.status})`));
    }
    const blob = await readNormalizationDownload(response, options);
    emitNormalizationProgress(options.onProgress, 'complete', 1);
    jobId = null; // The sidecar cleans successful jobs after the file response.
    return { blob, metadata };
  } finally {
    if (jobId) {
      await fetch(`${baseUrl}/video/normalize/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }
}

export async function prepareVideoImportWithMetadata(
  file: File,
  options: NormalizeVideoImportOptions = {},
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<NormalizedVideoImportResult> {
  return runVideoImportJob(file, null, options, baseUrl);
}

export async function normalizeVideoImportWithMetadata(
  file: File,
  fps: number,
  resolution: { width: number; height: number },
  options: NormalizeVideoImportOptions = {},
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<NormalizedVideoImportResult> {
  return runVideoImportJob(file, { fps, ...resolution }, options, baseUrl);
}

export async function normalizeVideoImport(
  file: File,
  fps: number,
  resolution?: { width: number; height: number },
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<Blob> {
  return (await requestNormalizedVideo(file, fps, resolution, baseUrl)).blob();
}

export async function probeVideoImport(
  file: File,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<AuthoritativeVideoMetadata> {
  const form = new FormData();
  form.append('file', file, file.name || 'video');
  const response = await fetch(`${baseUrl}/video/probe`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(await buildErrorMessageFromResponse(response, `Video probe failed (${response.status})`));
  }
  const raw = await response.json();
  if (
    !Number.isFinite(raw?.fps)
    || raw.fps <= 0
    || !Number.isInteger(raw?.frameCount)
    || raw.frameCount <= 0
    || !Number.isInteger(raw?.width)
    || raw.width <= 0
    || !Number.isInteger(raw?.height)
    || raw.height <= 0
  ) {
    throw new Error('Video probe returned invalid authoritative metadata.');
  }
  return {
    fps: raw.fps,
    frameCount: raw.frameCount,
    width: raw.width,
    height: raw.height,
    durationMs: Number.isFinite(raw.durationMs) && raw.durationMs > 0
      ? raw.durationMs
      : (raw.frameCount * 1000) / raw.fps,
    frameCountSource: 'probe',
  };
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export async function requestTracking(
  params: TrackingParams,
  baseUrl: string = SIDECAR_BASE_URL,
  signal?: AbortSignal,
): Promise<TrackingResult> {
  const res = await fetch(`${baseUrl}/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = extractErrorMessage(body, `Tracking failed (${res.status})`);
    const detail = body?.detail && typeof body.detail === 'object' ? body.detail : body;
    const err: TrackingError = {
      message,
      detectedBboxes: detail?.detectedBboxes,
      debugVideoPath: detail?.debugVideoPath,
      debugVideoUrl: detail?.debugVideoUrl,
    };
    throw err;
  }

  return await res.json();
}

function trackingErrorFromPayload(body: any, fallback: string): TrackingError {
  const detail = body?.detail && typeof body.detail === 'object' ? body.detail : body;
  return {
    message: extractErrorMessage(body, fallback),
    detectedBboxes: detail?.detectedBboxes,
    debugVideoPath: detail?.debugVideoPath,
    debugVideoUrl: detail?.debugVideoUrl,
  };
}

export async function requestTrackingStream(
  params: TrackingParams,
  onKeyframe: (keyframe: TrackingKeyframe) => void,
  baseUrl: string = SIDECAR_BASE_URL,
  signal?: AbortSignal,
): Promise<TrackingResult> {
  const res = await fetch(`${baseUrl}/track/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (res.status === 404) return requestTracking(params, baseUrl, signal);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw trackingErrorFromPayload(body, `Tracking failed (${res.status})`);
  }
  if (!res.body) throw new Error('Tracking stream response had no body.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: TrackingResult | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as TrackingStreamEvent;
    if (event.type === 'keyframe') {
      onKeyframe(event.keyframe);
    } else if (event.type === 'result') {
      finalResult = event.result;
    } else if (event.type === 'error') {
      throw trackingErrorFromPayload(event.error, 'Tracking failed');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
      if (done) break;
    }
    consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!finalResult) throw new Error('Tracking stream ended before its final result.');
  return finalResult;
}

export async function requestPlayerDetections(
  params: PlayerDetectionParams,
  baseUrl: string = SIDECAR_BASE_URL,
  signal?: AbortSignal,
): Promise<PlayerDetectionResult> {
  const res = await fetch(`${baseUrl}/track/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Player detection failed (${res.status})`));
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

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
// Homography
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportStartParams {
  clipId?: string;
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

export async function downloadExportFile(
  sessionId: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<Blob> {
  const res = await fetch(`${baseUrl}/export/${sessionId}/file`);
  if (!res.ok) {
    throw new Error(await buildErrorMessageFromResponse(res, `Export download failed (${res.status})`));
  }
  return await res.blob();
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

export async function cleanupExport(
  sessionId: string,
  baseUrl: string = SIDECAR_BASE_URL,
): Promise<void> {
  await fetch(`${baseUrl}/export/${sessionId}`, { method: 'DELETE' }).catch(() => {});
}
