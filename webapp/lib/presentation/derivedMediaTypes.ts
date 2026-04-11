export type PlaybackWorkflow =
  | 'authoring_retrieval'
  | 'authoring_clip_preview'
  | 'authoring_transition_preview'
  | 'present_transition'
  | 'present_clip'
  | 'present_retrieval';

export type PlaybackAssetClass = 'original' | 'exact_motion';

export type PlaybackAssetReadiness = 'ready' | 'queued' | 'running' | 'failed' | 'missing' | 'stale';

export type PlaybackAssetQualityClass = 'exact' | 'degraded';

export type DerivedMediaJobKind = 'exact_motion_generate';

export type DerivedMediaExecutionMode = 'interactive' | 'prepare_presentation';

export type DerivedMediaJobStatus = 'queued' | 'probing' | 'running' | 'finalizing' | 'ready' | 'failed' | 'cancelled' | 'obsolete';

export type PresentationPreparationStatus = 'ready' | 'degraded' | 'failed';

export interface DerivedMediaSourceReference {
  sourceVideoId: string;
  sourceVideoRef?: string;
  sourceVideoPath?: string;
}

export interface DerivedMediaBounds {
  startMs: number;
  endMs: number;
}

export interface DerivedMediaJobProgress {
  status: DerivedMediaJobStatus;
  percent?: number;
  currentTimeMs?: number;
  durationMs?: number;
  label?: string;
}

export interface ExactMotionGenerationRequest extends DerivedMediaSourceReference {
  kind: 'exact_motion_generate';
  generationKey: string;
  sourceFingerprint: string;
  presentationId: string;
  motionKind: 'transition' | 'clip_slide';
  transitionOrClipId: string;
  outputPath: string;
  profileVersion: string;
  bounds: DerivedMediaBounds;
}

export type DerivedMediaGenerationRequest = ExactMotionGenerationRequest;

export interface DerivedMediaJobSnapshot {
  jobId: string;
  kind: DerivedMediaJobKind;
  generationKey: string;
  status: DerivedMediaJobStatus;
  outputPath: string;
  profileVersion: string;
  sourceVideoId: string;
  remoteJobId?: string;
  progress?: DerivedMediaJobProgress;
  error?: string;
  presentationId?: string;
  motionKind?: 'transition' | 'clip_slide';
  transitionOrClipId?: string;
  bounds?: DerivedMediaBounds;
}

export interface DerivedMediaQueuedJob {
  executionMode: DerivedMediaExecutionMode;
  queuedAt: string;
  request: DerivedMediaGenerationRequest;
  snapshot: DerivedMediaJobSnapshot;
}

export interface DerivedMediaJobQueueFile {
  schema: 1;
  jobs: DerivedMediaQueuedJob[];
}

export interface PresentationPreparationStatusRecord {
  status: PresentationPreparationStatus;
  updatedAt: string;
  requiredCount: number;
  readyCount: number;
  failedCount: number;
  queuedJobCount: number;
}

export interface PresentationPreparationStatusFile {
  schema: 1;
  preparation: PresentationPreparationStatusRecord | null;
}

export interface ResolvedPlaybackAsset {
  assetId: string;
  assetClass: PlaybackAssetClass;
  readiness: PlaybackAssetReadiness;
  qualityClass: PlaybackAssetQualityClass;
  safeForPresent: boolean;
  sourceVideoId?: string;
  filePath?: string;
  objectUrl?: string | null;
  durationMs?: number;
  sourceFingerprint?: string;
  generationKey?: string;
  fallbackFromAssetId?: string | null;
  failureReason?: string;
}

export type PlaybackAssetRegistry = Record<string, ResolvedPlaybackAsset>;

export type PreferredPlaybackAssetIdByVideoId = Record<string, string>;

export interface ExactMotionAssetIndexFile {
  schema: 1;
  entries: ExactMotionAssetIndexEntry[];
}

export interface ExactMotionAssetIndexEntry {
  assetId: string;
  generationKey: string;
  motionKind: 'transition' | 'clip_slide';
  transitionOrClipId: string;
  sourceVideoId: string;
  sourceFingerprint: string;
  relativePath: string;
  status: PlaybackAssetReadiness;
  profileVersion: string;
  createdAt: string;
  lastUsedAt?: string;
  byteSize?: number;
  durationMs?: number;
  error?: string;
}
