import {
  MAX_INTERACTIVE_DERIVED_MEDIA_JOBS,
  MAX_INTERACTIVE_EXACT_MOTION_JOBS,
  MAX_INTERACTIVE_PREVIEW_PROXY_JOBS,
  MAX_PREPARE_PRESENTATION_EXACT_MOTION_JOBS,
} from './derivedMediaConfig';
import type {
  DerivedMediaExecutionMode,
  DerivedMediaGenerationRequest,
  DerivedMediaJobProgress,
  DerivedMediaJobQueueFile,
  DerivedMediaJobSnapshot,
  DerivedMediaJobStatus,
  DerivedMediaQueuedJob,
} from './derivedMediaTypes';

export interface DerivedMediaConcurrencyPolicy {
  mode: DerivedMediaExecutionMode;
  maxPreviewProxyJobs: number;
  maxExactMotionJobs: number;
  maxTotalJobs: number;
  allowPreviewProxyJobs: boolean;
}

export function getDerivedMediaConcurrencyPolicy(mode: DerivedMediaExecutionMode): DerivedMediaConcurrencyPolicy {
  if (mode === 'prepare_presentation') {
    return {
      mode,
      maxPreviewProxyJobs: 0,
      maxExactMotionJobs: MAX_PREPARE_PRESENTATION_EXACT_MOTION_JOBS,
      maxTotalJobs: MAX_PREPARE_PRESENTATION_EXACT_MOTION_JOBS,
      allowPreviewProxyJobs: false,
    };
  }
  return {
    mode,
    maxPreviewProxyJobs: MAX_INTERACTIVE_PREVIEW_PROXY_JOBS,
    maxExactMotionJobs: MAX_INTERACTIVE_EXACT_MOTION_JOBS,
    maxTotalJobs: MAX_INTERACTIVE_DERIVED_MEDIA_JOBS,
    allowPreviewProxyJobs: true,
  };
}

export function isTerminalDerivedMediaJobStatus(status: DerivedMediaJobStatus): boolean {
  return status === 'ready'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'obsolete';
}

export function isActiveDerivedMediaJobStatus(status: DerivedMediaJobStatus): boolean {
  return !isTerminalDerivedMediaJobStatus(status);
}

export function normalizeDerivedMediaJobProgress(progress: Partial<DerivedMediaJobProgress>): DerivedMediaJobProgress {
  const percent = typeof progress.percent === 'number'
    && Number.isFinite(progress.percent)
    ? Math.max(0, Math.min(100, progress.percent))
    : undefined;
  return {
    status: progress.status ?? 'queued',
    percent,
    currentTimeMs: progress.currentTimeMs,
    durationMs: progress.durationMs,
    label: progress.label,
  };
}

export function createDerivedMediaJobSnapshot(
  request: DerivedMediaGenerationRequest,
  jobId: string,
): DerivedMediaJobSnapshot {
  if (request.kind === 'preview_proxy_generate') {
    return {
      jobId,
      kind: request.kind,
      generationKey: request.generationKey,
      status: 'queued',
      outputPath: request.outputPath,
      profileVersion: request.profileVersion,
      sourceVideoId: request.sourceVideoId,
      progress: normalizeDerivedMediaJobProgress({
        status: 'queued',
        label: 'Queued',
      }),
    };
  }
  return {
    jobId,
    kind: request.kind,
    generationKey: request.generationKey,
    status: 'queued',
    outputPath: request.outputPath,
    profileVersion: request.profileVersion,
    sourceVideoId: request.sourceVideoId,
    presentationId: request.presentationId,
    motionKind: request.motionKind,
    transitionOrClipId: request.transitionOrClipId,
    bounds: request.bounds,
    progress: normalizeDerivedMediaJobProgress({
      status: 'queued',
      label: 'Queued',
    }),
  };
}

export function updateDerivedMediaJobSnapshot(
  snapshot: DerivedMediaJobSnapshot,
  update: Partial<Omit<DerivedMediaJobSnapshot, 'jobId' | 'kind' | 'generationKey' | 'outputPath' | 'profileVersion' | 'sourceVideoId'>>,
): DerivedMediaJobSnapshot {
  return {
    ...snapshot,
    ...update,
    progress: update.progress ? normalizeDerivedMediaJobProgress(update.progress) : snapshot.progress,
  };
}

export function createDerivedMediaJobId(prefix: string = 'dmjob'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getDerivedMediaQueuedJobByGenerationKey(
  queue: DerivedMediaJobQueueFile,
  generationKey: string,
): DerivedMediaQueuedJob | null {
  for (let index = queue.jobs.length - 1; index >= 0; index -= 1) {
    const candidate = queue.jobs[index];
    if (candidate.snapshot.generationKey === generationKey) {
      return candidate;
    }
  }
  return null;
}

function isSameExactMotionTarget(a: DerivedMediaQueuedJob, b: DerivedMediaGenerationRequest): boolean {
  if (a.request.kind !== 'exact_motion_generate' || b.kind !== 'exact_motion_generate') {
    return false;
  }
  return a.request.presentationId === b.presentationId
    && a.request.motionKind === b.motionKind
    && a.request.transitionOrClipId === b.transitionOrClipId
    && a.request.sourceVideoId === b.sourceVideoId;
}

function isSamePreviewProxyTarget(a: DerivedMediaQueuedJob, b: DerivedMediaGenerationRequest): boolean {
  if (a.request.kind !== 'preview_proxy_generate' || b.kind !== 'preview_proxy_generate') {
    return false;
  }
  return a.request.sourceVideoId === b.sourceVideoId;
}

export function markSupersededPreviewProxyJobsObsolete(
  queue: DerivedMediaJobQueueFile,
  request: DerivedMediaGenerationRequest,
): DerivedMediaJobQueueFile {
  if (request.kind !== 'preview_proxy_generate') {
    return queue;
  }
  let changed = false;
  const jobs = queue.jobs.map((job) => {
    if (
      !isSamePreviewProxyTarget(job, request)
      || job.snapshot.generationKey === request.generationKey
      || !isActiveDerivedMediaJobStatus(job.snapshot.status)
    ) {
      return job;
    }
    changed = true;
    return {
      ...job,
      snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
        status: 'obsolete',
        error: 'Superseded by a newer preview-proxy request',
        remoteJobId: undefined,
        progress: {
          ...job.snapshot.progress,
          status: 'obsolete',
          label: 'Obsolete',
        },
      }),
    };
  });
  if (!changed) {
    return queue;
  }
  return {
    schema: queue.schema,
    jobs,
  };
}

export function markSupersededExactMotionJobsObsolete(
  queue: DerivedMediaJobQueueFile,
  request: DerivedMediaGenerationRequest,
): DerivedMediaJobQueueFile {
  if (request.kind !== 'exact_motion_generate') {
    return queue;
  }
  let changed = false;
  const jobs = queue.jobs.map((job) => {
    if (
      !isSameExactMotionTarget(job, request)
      || job.snapshot.generationKey === request.generationKey
      || !isActiveDerivedMediaJobStatus(job.snapshot.status)
    ) {
      return job;
    }
    changed = true;
    return {
      ...job,
      snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
        status: 'obsolete',
        error: 'Superseded by a newer exact-motion request',
        progress: {
          ...job.snapshot.progress,
          status: 'obsolete',
          label: 'Obsolete',
        },
      }),
    };
  });
  if (!changed) {
    return queue;
  }
  return {
    schema: queue.schema,
    jobs,
  };
}

export function isQueuedPreviewProxyJobCurrentForPromotion(
  queue: DerivedMediaJobQueueFile,
  jobId: string,
): boolean {
  const index = queue.jobs.findIndex((job) => job.snapshot.jobId === jobId);
  if (index < 0) {
    return false;
  }
  const current = queue.jobs[index];
  if (current.request.kind !== 'preview_proxy_generate' || current.snapshot.status === 'obsolete' || current.snapshot.status === 'cancelled') {
    return false;
  }
  for (let laterIndex = index + 1; laterIndex < queue.jobs.length; laterIndex += 1) {
    const candidate = queue.jobs[laterIndex];
    if (
      isSamePreviewProxyTarget(candidate, current.request)
      && candidate.snapshot.generationKey !== current.snapshot.generationKey
      && candidate.snapshot.status !== 'obsolete'
      && candidate.snapshot.status !== 'cancelled'
    ) {
      return false;
    }
  }
  return true;
}

export function isQueuedExactMotionJobCurrentForPromotion(
  queue: DerivedMediaJobQueueFile,
  jobId: string,
): boolean {
  const index = queue.jobs.findIndex((job) => job.snapshot.jobId === jobId);
  if (index < 0) {
    return false;
  }
  const current = queue.jobs[index];
  if (current.request.kind !== 'exact_motion_generate' || current.snapshot.status === 'obsolete' || current.snapshot.status === 'cancelled') {
    return false;
  }
  for (let laterIndex = index + 1; laterIndex < queue.jobs.length; laterIndex += 1) {
    const candidate = queue.jobs[laterIndex];
    if (
      isSameExactMotionTarget(candidate, current.request)
      && candidate.snapshot.generationKey !== current.snapshot.generationKey
      && candidate.snapshot.status !== 'obsolete'
      && candidate.snapshot.status !== 'cancelled'
    ) {
      return false;
    }
  }
  return true;
}

export function enqueueDerivedMediaGenerationRequest(
  queue: DerivedMediaJobQueueFile,
  request: DerivedMediaGenerationRequest,
  executionMode: DerivedMediaExecutionMode,
): { queue: DerivedMediaJobQueueFile; job: DerivedMediaQueuedJob; created: boolean } {
  const existing = getDerivedMediaQueuedJobByGenerationKey(queue, request.generationKey);
  if (existing && isActiveDerivedMediaJobStatus(existing.snapshot.status)) {
    return {
      queue,
      job: existing,
      created: false,
    };
  }
  const nextQueue = request.kind === 'exact_motion_generate'
    ? markSupersededExactMotionJobsObsolete(queue, request)
    : markSupersededPreviewProxyJobsObsolete(queue, request);

  const nextJob: DerivedMediaQueuedJob = {
    executionMode,
    queuedAt: new Date().toISOString(),
    request,
    snapshot: createDerivedMediaJobSnapshot(
      request,
      createDerivedMediaJobId(request.kind === 'exact_motion_generate' ? 'dmexact' : 'dmproxy'),
    ),
  };

  if (!existing) {
    return {
      queue: {
        schema: nextQueue.schema,
        jobs: [...nextQueue.jobs, nextJob],
      },
      job: nextJob,
      created: true,
    };
  }

  return {
    queue: {
      schema: nextQueue.schema,
      jobs: nextQueue.jobs.map((job) => job.snapshot.generationKey === request.generationKey ? nextJob : job),
    },
    job: nextJob,
    created: true,
  };
}
