import { parseAnnotations } from '../types/annotations';
import type { ClipPin, Clip, PinAnnotationRef } from '../types/clip';
import type { PresentationSlide, Presentation } from '../types/presentation';
import type { ProjectManifest } from '../types/project';
import { listClips } from '../fs/clipStorage';
import {
  getDirectoryPath,
  isNotFoundError,
  pathExists,
  readTextFile,
  splitSafeRelativePath,
} from '../fs/fsAccess';
import { listPresentations } from '../fs/presentationStorage';

export type ProjectIntegritySeverity = 'error' | 'warning';

export type ProjectIntegrityCode =
  | 'clip-read-error'
  | 'presentation-read-error'
  | 'missing-video-file'
  | 'unresolved-clip-video'
  | 'missing-annotation-document'
  | 'invalid-annotation-document'
  | 'annotation-anchor-mismatch'
  | 'orphan-annotation-document'
  | 'unresolved-presentation-clip'
  | 'unresolved-presentation-pin'
  | 'unresolved-presentation-annotation'
  | 'invalid-presentation-cue'
  | 'invalid-match-video-transition';

export interface ProjectIntegrityIssue {
  severity: ProjectIntegritySeverity;
  code: ProjectIntegrityCode;
  path: string;
  message: string;
}

export interface ProjectIntegrityReport {
  ok: boolean;
  issues: ProjectIntegrityIssue[];
  clips: Clip[];
  presentations: Presentation[];
}

function issue(
  issues: ProjectIntegrityIssue[],
  severity: ProjectIntegritySeverity,
  code: ProjectIntegrityCode,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

function pinById(clip: Clip, pinId: string): ClipPin | null {
  return clip.pins.find((pin) => pin.id === pinId) ?? null;
}

function annotationRefById(pin: ClipPin, annotationId: string): PinAnnotationRef | null {
  return pin.annotations.find((annotation) => annotation.id === annotationId) ?? null;
}

function selectedAnnotationIds(pin: ClipPin, selected: string[] | null | undefined): Set<string> {
  return new Set(selected === null || selected === undefined
    ? pin.annotations.map((annotation) => annotation.id)
    : selected);
}

function checkAnnotationSelection(
  issues: ProjectIntegrityIssue[],
  path: string,
  pin: ClipPin,
  annotationIds: string[] | null | undefined,
  cueIds: readonly string[],
): void {
  const effective = selectedAnnotationIds(pin, annotationIds);
  for (const annotationId of effective) {
    if (!annotationRefById(pin, annotationId)) {
      issue(
        issues,
        'warning',
        'unresolved-presentation-annotation',
        path,
        `Annotation "${annotationId}" does not resolve on pin "${pin.id}".`,
      );
    }
  }
  for (const annotationId of cueIds) {
    if (!effective.has(annotationId) || !annotationRefById(pin, annotationId)) {
      issue(
        issues,
        'warning',
        'invalid-presentation-cue',
        path,
        `Annotation cue "${annotationId}" is not in the slide's effective annotation set.`,
      );
    }
  }
}

async function checkClipAnnotationDocuments(
  projectDir: FileSystemDirectoryHandle,
  clip: Clip,
  issues: ProjectIntegrityIssue[],
): Promise<void> {
  const expectedFiles = new Set<string>();
  for (const pin of clip.pins) {
    for (const reference of pin.annotations) {
      expectedFiles.add(reference.file);
      const path = ['analysis', 'clips', clip.id, ...splitSafeRelativePath(reference.file)];
      let raw: unknown;
      try {
        raw = JSON.parse(await readTextFile(projectDir, path));
      } catch (error) {
        issue(
          issues,
          isNotFoundError(error) ? 'warning' : 'error',
          isNotFoundError(error) ? 'missing-annotation-document' : 'invalid-annotation-document',
          path.join('/'),
          isNotFoundError(error)
            ? `Annotation document "${reference.file}" is missing.`
            : error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      try {
        const document = parseAnnotations(raw);
        if (
          document.annotationId !== reference.id
          || document.clipId !== clip.id
          || document.pinId !== pin.id
          || document.frame !== pin.frame
        ) {
          issue(
            issues,
            'error',
            'annotation-anchor-mismatch',
            path.join('/'),
            `Annotation document anchor does not match ${clip.id}/${pin.id}@${pin.frame}.`,
          );
        }
      } catch (error) {
        issue(
          issues,
          'error',
          'invalid-annotation-document',
          path.join('/'),
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  let annotationsDirectory: FileSystemDirectoryHandle;
  try {
    annotationsDirectory = await getDirectoryPath(projectDir, ['analysis', 'clips', clip.id, 'annotations'], false);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  for await (const [name, handle] of annotationsDirectory.entries()) {
    const relativePath = `annotations/${name}`;
    if (handle.kind !== 'file' || !expectedFiles.has(relativePath)) {
      issue(
        issues,
        'warning',
        'orphan-annotation-document',
        `analysis/clips/${clip.id}/${relativePath}`,
        `Unreferenced annotation entry "${relativePath}" exists in clip "${clip.id}".`,
      );
    }
  }
}

function resolveSlidePin(
  slide: PresentationSlide,
  clips: Map<string, Clip>,
): { clip: Clip; pin: ClipPin } | null {
  if (slide.kind !== 'pin') return null;
  const clip = clips.get(slide.clipId);
  const pin = clip ? pinById(clip, slide.pinId) : null;
  return clip && pin ? { clip, pin } : null;
}

function checkPresentation(
  presentation: Presentation,
  clips: Map<string, Clip>,
  videoIdsByClip: Map<string, string>,
  issues: ProjectIntegrityIssue[],
): void {
  presentation.slides.forEach((slide, slideIndex) => {
    const path = `presentations/${presentation.id}.json/slides[${slideIndex}]`;
    if (slide.kind === 'title') return;
    const clip = clips.get(slide.clipId);
    if (!clip) {
      issue(issues, 'warning', 'unresolved-presentation-clip', path, `Clip "${slide.clipId}" is missing.`);
      return;
    }
    if (slide.kind === 'pin') {
      const pin = pinById(clip, slide.pinId);
      if (!pin) {
        issue(issues, 'warning', 'unresolved-presentation-pin', path, `Pin "${slide.pinId}" is missing.`);
        return;
      }
      checkAnnotationSelection(
        issues,
        path,
        pin,
        slide.annotationIds,
        (slide.annotationCues ?? []).map((cue) => cue.annotationId),
      );
      return;
    }

    const effectivePinIds = new Set(slide.pausePins === null
      ? clip.pins.map((pin) => pin.id)
      : slide.pausePins);
    for (const pinId of effectivePinIds) {
      if (!pinById(clip, pinId)) {
        issue(issues, 'warning', 'unresolved-presentation-pin', path, `Pause pin "${pinId}" is missing.`);
      }
    }
    for (const cue of slide.pauseCues ?? []) {
      const pin = pinById(clip, cue.pinId);
      if (!pin || !effectivePinIds.has(cue.pinId)) {
        issue(
          issues,
          'warning',
          'invalid-presentation-cue',
          path,
          `Pause cue pin "${cue.pinId}" is not in the slide's effective pin set.`,
        );
        continue;
      }
      checkAnnotationSelection(
        issues,
        path,
        pin,
        cue.annotationIds,
        (cue.annotationCues ?? []).map((annotationCue) => annotationCue.annotationId),
      );
    }
  });

  presentation.transitions.forEach((transition, transitionIndex) => {
    if (transition.mode !== 'match_video') return;
    const path = `presentations/${presentation.id}.json/transitions[${transitionIndex}]`;
    const left = resolveSlidePin(presentation.slides[transitionIndex], clips);
    const right = resolveSlidePin(presentation.slides[transitionIndex + 1], clips);
    if (!left || !right) {
      issue(
        issues,
        'warning',
        'invalid-match-video-transition',
        path,
        'Match-video transitions require two resolving pin slides.',
      );
      return;
    }
    const sameVideo = videoIdsByClip.get(left.clip.id) === videoIdsByClip.get(right.clip.id);
    const startFrame = left.pin.frame + (transition.startOffsetFrames ?? 0);
    const endFrame = right.pin.frame + (transition.endOffsetFrames ?? 0);
    if (!sameVideo || endFrame <= startFrame) {
      issue(
        issues,
        'warning',
        'invalid-match-video-transition',
        path,
        'Match-video pins must be forward ordered on the same video with a non-empty trimmed range.',
      );
    }
  });
}

export async function checkProjectIntegrity(
  projectDir: FileSystemDirectoryHandle,
  manifest: ProjectManifest,
): Promise<ProjectIntegrityReport> {
  const issues: ProjectIntegrityIssue[] = [];
  const clipResult = await listClips(projectDir);
  const presentationResult = await listPresentations(projectDir);

  clipResult.errors.forEach((entry) => {
    issue(issues, 'error', 'clip-read-error', `analysis/clips/${entry.clipId}`, entry.error.message);
  });
  presentationResult.errors.forEach((entry) => {
    issue(
      issues,
      'error',
      'presentation-read-error',
      `presentations/${entry.presentationId}.json`,
      entry.error.message,
    );
  });

  for (const video of manifest.videos) {
    if (!(await pathExists(projectDir, splitSafeRelativePath(video.file), 'file'))) {
      issue(issues, 'error', 'missing-video-file', video.file, `Video file "${video.file}" is missing.`);
    }
  }
  const videos = new Set(manifest.videos.map((video) => video.id));
  for (const clip of clipResult.clips) {
    if (!videos.has(clip.videoId)) {
      issue(
        issues,
        'error',
        'unresolved-clip-video',
        `analysis/clips/${clip.id}/clip.json`,
        `Clip videoId "${clip.videoId}" does not resolve.`,
      );
    }
    await checkClipAnnotationDocuments(projectDir, clip, issues);
  }

  const clips = new Map(clipResult.clips.map((clip) => [clip.id, clip]));
  const videoIdsByClip = new Map(clipResult.clips.map((clip) => [clip.id, clip.videoId]));
  for (const presentation of presentationResult.presentations) {
    checkPresentation(presentation, clips, videoIdsByClip, issues);
  }

  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    issues,
    clips: clipResult.clips,
    presentations: presentationResult.presentations,
  };
}

export const checkProjectOnOpen = checkProjectIntegrity;
