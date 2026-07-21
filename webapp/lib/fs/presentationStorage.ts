import { isSafeClipIdSegment } from '../types/clip';
import type {
  ClipPauseCue,
  PinAnnotationCue,
  PresentationSlide,
  PresentationTransition,
  Presentation,
} from '../types/presentation';
import type { StorageReadError } from './clipStorage';
import {
  getDirectoryPath,
  isNotFoundError,
  readTextFile,
  removePath,
  writeJsonFile,
} from './fsAccess';

export type PresentationReadResult =
  | { ok: true; presentation: Presentation }
  | { ok: false; presentationId: string; error: StorageReadError };

export interface PresentationListResult {
  presentations: Presentation[];
  errors: { presentationId: string; error: StorageReadError }[];
}

const PRESENTATIONS_PATH = ['presentations'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalDuration(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number.`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string' || !isSafeClipIdSegment(entry))
  ) {
    throw new Error(`${path} must be null or an array of non-empty strings.`);
  }
  return value;
}

function parseAnnotationCue(raw: unknown, path: string): PinAnnotationCue {
  if (!isRecord(raw) || typeof raw.annotationId !== 'string' || !isSafeClipIdSegment(raw.annotationId)) {
    throw new Error(`${path}.annotationId is required.`);
  }
  const enterAtMs = optionalDuration(raw.enterAtMs, `${path}.enterAtMs`);
  const exitAtMs = optionalDuration(raw.exitAtMs, `${path}.exitAtMs`);
  if (enterAtMs !== undefined && exitAtMs !== undefined && exitAtMs < enterAtMs) {
    throw new Error(`${path}.exitAtMs cannot precede enterAtMs.`);
  }
  return { annotationId: raw.annotationId, enterAtMs, exitAtMs };
}

function parseAnnotationCues(raw: unknown, path: string): PinAnnotationCue[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error(`${path} must be an array.`);
  return raw.map((cue, index) => parseAnnotationCue(cue, `${path}[${index}]`));
}

function parsePauseCue(raw: unknown, path: string): ClipPauseCue {
  if (!isRecord(raw) || typeof raw.pinId !== 'string' || !isSafeClipIdSegment(raw.pinId)) {
    throw new Error(`${path}.pinId is required.`);
  }
  return {
    pinId: raw.pinId,
    holdMs: optionalDuration(raw.holdMs, `${path}.holdMs`),
    annotationIds: optionalStringArray(raw.annotationIds, `${path}.annotationIds`),
    annotationCues: parseAnnotationCues(raw.annotationCues, `${path}.annotationCues`),
  };
}

function parseSlide(raw: unknown, path: string): PresentationSlide {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isSafeClipIdSegment(raw.id)) {
    throw new Error(`${path}.id is required.`);
  }
  const notes = typeof raw.notes === 'string' ? raw.notes : undefined;
  const holdMs = optionalDuration(raw.holdMs, `${path}.holdMs`);
  if (raw.kind === 'clip') {
    if (typeof raw.clipId !== 'string' || !isSafeClipIdSegment(raw.clipId)) {
      throw new Error(`${path}.clipId is required.`);
    }
    const pausePins = optionalStringArray(raw.pausePins, `${path}.pausePins`);
    if (pausePins === undefined) throw new Error(`${path}.pausePins is required (use null for all pins).`);
    if (raw.pauseCues !== undefined && !Array.isArray(raw.pauseCues)) {
      throw new Error(`${path}.pauseCues must be an array.`);
    }
    return {
      id: raw.id,
      kind: 'clip',
      clipId: raw.clipId,
      pausePins,
      pauseCues: Array.isArray(raw.pauseCues)
        ? raw.pauseCues.map((cue, index) => parsePauseCue(cue, `${path}.pauseCues[${index}]`))
        : undefined,
      notes,
      holdMs,
    };
  }
  if (raw.kind === 'pin') {
    if (typeof raw.clipId !== 'string' || !isSafeClipIdSegment(raw.clipId)) {
      throw new Error(`${path}.clipId is required.`);
    }
    if (typeof raw.pinId !== 'string' || !isSafeClipIdSegment(raw.pinId)) {
      throw new Error(`${path}.pinId is required.`);
    }
    if (typeof raw.showAnnotations !== 'boolean') throw new Error(`${path}.showAnnotations is required.`);
    return {
      id: raw.id,
      kind: 'pin',
      clipId: raw.clipId,
      pinId: raw.pinId,
      showAnnotations: raw.showAnnotations,
      annotationIds: optionalStringArray(raw.annotationIds, `${path}.annotationIds`),
      annotationCues: parseAnnotationCues(raw.annotationCues, `${path}.annotationCues`),
      notes,
      holdMs,
    };
  }
  if (raw.kind === 'title') {
    if (raw.template !== 'title' && raw.template !== 'section' && raw.template !== 'divider') {
      throw new Error(`${path}.template is invalid.`);
    }
    if (typeof raw.title !== 'string') throw new Error(`${path}.title is required.`);
    return {
      id: raw.id,
      kind: 'title',
      template: raw.template,
      title: raw.title,
      body: typeof raw.body === 'string' ? raw.body : undefined,
      notes,
      holdMs,
    };
  }
  throw new Error(`${path}.kind is invalid.`);
}

function parseTransition(raw: unknown, path: string): PresentationTransition {
  if (!isRecord(raw)) throw new Error(`${path} must be an object.`);
  if (raw.mode === 'cut') return { mode: 'cut' };
  if (raw.mode !== 'match_video') throw new Error(`${path}.mode is invalid.`);
  if (typeof raw.hideAnnotationsDuringPlayback !== 'boolean') {
    throw new Error(`${path}.hideAnnotationsDuringPlayback is required.`);
  }
  if (raw.playbackRate !== undefined && (typeof raw.playbackRate !== 'number' || raw.playbackRate <= 0)) {
    throw new Error(`${path}.playbackRate must be positive.`);
  }
  if (
    raw.startOffsetFrames !== undefined
    && (typeof raw.startOffsetFrames !== 'number' || !Number.isInteger(raw.startOffsetFrames) || raw.startOffsetFrames < 0)
  ) {
    throw new Error(`${path}.startOffsetFrames must be a non-negative integer.`);
  }
  if (
    raw.endOffsetFrames !== undefined
    && (typeof raw.endOffsetFrames !== 'number' || !Number.isInteger(raw.endOffsetFrames) || raw.endOffsetFrames > 0)
  ) {
    throw new Error(`${path}.endOffsetFrames must be a non-positive integer.`);
  }
  return {
    mode: 'match_video',
    hideAnnotationsDuringPlayback: raw.hideAnnotationsDuringPlayback,
    playbackRate: raw.playbackRate as number | undefined,
    startOffsetFrames: raw.startOffsetFrames as number | undefined,
    endOffsetFrames: raw.endOffsetFrames as number | undefined,
  };
}

export function parsePresentation(raw: unknown): Presentation {
  if (!isRecord(raw) || raw.schema !== 2) throw new Error('Presentation schema must be 2.');
  if (typeof raw.id !== 'string' || !isSafeClipIdSegment(raw.id)) {
    throw new Error('Presentation id must be a safe identifier.');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Presentation name is required.');
  if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) {
    throw new Error('Presentation createdAt is invalid.');
  }
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) {
    throw new Error('Presentation updatedAt is invalid.');
  }
  if (!Array.isArray(raw.slides) || !Array.isArray(raw.transitions)) {
    throw new Error('Presentation slides and transitions must be arrays.');
  }
  const slides = raw.slides.map((slide, index) => parseSlide(slide, `slides[${index}]`));
  if (new Set(slides.map((slide) => slide.id)).size !== slides.length) {
    throw new Error('Presentation slide ids must be unique.');
  }
  const transitions = raw.transitions.map((transition, index) => (
    parseTransition(transition, `transitions[${index}]`)
  ));
  if (transitions.length !== Math.max(slides.length - 1, 0)) {
    throw new Error('Presentation transitions must have exactly slides.length - 1 entries.');
  }
  return {
    schema: 2,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    slides,
    transitions,
    theme: isRecord(raw.theme)
      ? {
          background: typeof raw.theme.background === 'string' ? raw.theme.background : undefined,
          panelColor: typeof raw.theme.panelColor === 'string' ? raw.theme.panelColor : undefined,
          textColor: typeof raw.theme.textColor === 'string' ? raw.theme.textColor : undefined,
        }
      : undefined,
  };
}

function presentationPath(presentationId: string): string[] {
  if (!isSafeClipIdSegment(presentationId)) {
    throw new Error(`Unsafe presentation id: ${JSON.stringify(presentationId)}`);
  }
  return [...PRESENTATIONS_PATH, `${presentationId}.json`];
}

export async function readPresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<PresentationReadResult> {
  let source: string;
  try {
    source = await readTextFile(projectDir, presentationPath(presentationId));
  } catch (error) {
    return {
      ok: false,
      presentationId,
      error: {
        code: isNotFoundError(error) ? 'not-found' : 'io-error',
        message: isNotFoundError(error)
          ? `Presentation "${presentationId}" was not found.`
          : error instanceof Error ? error.message : String(error),
      },
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return {
      ok: false,
      presentationId,
      error: {
        code: 'invalid-json',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  try {
    const presentation = parsePresentation(raw);
    if (presentation.id !== presentationId) {
      throw new Error(
        `Presentation file "${presentationId}.json" contains id "${presentation.id}".`,
      );
    }
    return { ok: true, presentation };
  } catch (error) {
    return {
      ok: false,
      presentationId,
      error: { code: 'invalid-document', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function writePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentation: Presentation,
): Promise<void> {
  const parsed = parsePresentation(presentation);
  await getDirectoryPath(projectDir, PRESENTATIONS_PATH, true);
  await writeJsonFile(projectDir, presentationPath(parsed.id), parsed);
}

export async function listPresentations(
  projectDir: FileSystemDirectoryHandle,
): Promise<PresentationListResult> {
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await getDirectoryPath(projectDir, PRESENTATIONS_PATH, false);
  } catch (error) {
    return {
      presentations: [],
      errors: [{
        presentationId: '*',
        error: {
          code: isNotFoundError(error) ? 'not-found' : 'io-error',
          message: error instanceof Error ? error.message : String(error),
        },
      }],
    };
  }
  const presentations: Presentation[] = [];
  const errors: PresentationListResult['errors'] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    const presentationId = name.slice(0, -'.json'.length);
    const result = await readPresentation(projectDir, presentationId);
    if (result.ok) presentations.push(result.presentation);
    else errors.push({ presentationId, error: result.error });
  }
  presentations.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return { presentations, errors };
}

async function requirePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<Presentation> {
  const result = await readPresentation(projectDir, presentationId);
  if (!result.ok) throw new Error(result.error.message);
  return result.presentation;
}

export async function renamePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  name: string,
  now = new Date(),
): Promise<Presentation> {
  const current = await requirePresentation(projectDir, presentationId);
  const next: Presentation = {
    ...current,
    name: name.trim() || 'Untitled presentation',
    updatedAt: now.toISOString(),
  };
  await writePresentation(projectDir, next);
  return next;
}

export interface DuplicatePresentationOptions {
  id: string;
  name?: string;
  now?: Date;
}

export async function duplicatePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  options: DuplicatePresentationOptions,
): Promise<Presentation> {
  const current = await requirePresentation(projectDir, presentationId);
  const iso = (options.now ?? new Date()).toISOString();
  const copy: Presentation = {
    ...structuredClone(current),
    id: options.id,
    name: options.name?.trim() || `${current.name} copy`,
    createdAt: iso,
    updatedAt: iso,
  };
  await writePresentation(projectDir, copy);
  return copy;
}

export async function deletePresentation(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<void> {
  await requirePresentation(projectDir, presentationId);
  await removePath(projectDir, presentationPath(presentationId));
}
