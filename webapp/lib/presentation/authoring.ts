import { frameBoundary, videoFrame, type FrameRange } from '../clip/frameMath';
import type { TaggingBoard } from '../tagging/board';
import type { ClipPin, Clip } from '../types/clip';
import type {
  ClipSlide,
  PinSlide,
  PresentationSlide,
  PresentationTransition,
  Presentation,
  TitleSlide,
} from '../types/presentation';
import type { ProjectManifest, VideoEntry } from '../types/project';

export interface PresentationClipAsset {
  clip: Clip;
  video: VideoEntry | null;
  pinCount: number;
}

export interface PresentationAssetButton {
  id: string;
  label: string;
  clips: PresentationClipAsset[];
}

export interface PresentationAssetGroup {
  id: string;
  label: string;
  buttons: PresentationAssetButton[];
  clipCount: number;
}

export interface PresentationAssetIndex {
  groups: PresentationAssetGroup[];
  untagged: PresentationClipAsset[];
  unknown: PresentationClipAsset[];
  chronological: PresentationClipAsset[];
}

export type MatchVideoEdgeResult =
  | { ok: true; video: VideoEntry; range: FrameRange }
  | {
    ok: false;
    code: 'notMatchVideo' | 'requiresPins' | 'missingPins' | 'sameVideo' | 'forward' | 'emptyRange' | 'outsideVideo';
    reason: string;
  };

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function clipAsset(clip: Clip, manifest: ProjectManifest): PresentationClipAsset {
  return {
    clip,
    video: manifest.videos.find((video) => video.id === clip.videoId) ?? null,
    pinCount: clip.pins.length,
  };
}

function compareAssets(left: PresentationClipAsset, right: PresentationClipAsset): number {
  const leftVideo = left.video?.label ?? left.clip.videoId;
  const rightVideo = right.video?.label ?? right.clip.videoId;
  return leftVideo.localeCompare(rightVideo)
    || left.clip.startFrame - right.clip.startFrame
    || left.clip.id.localeCompare(right.clip.id);
}

export function buildPresentationAssetIndex(
  board: TaggingBoard,
  manifest: ProjectManifest,
  clips: readonly Clip[],
): PresentationAssetIndex {
  const assets = clips.map((clip) => clipAsset(clip, manifest)).sort(compareAssets);
  const buttonById = new Map<string, PresentationAssetButton>();
  const groups = board.groups.map((group) => {
    const buttons = group.buttons.map((button) => {
      const entry = { id: button.id, label: button.label, clips: [] as PresentationClipAsset[] };
      buttonById.set(button.id, entry);
      return entry;
    });
    return { id: group.id, label: group.label, buttons, clipCount: 0 };
  });
  const untagged: PresentationClipAsset[] = [];
  const unknown: PresentationClipAsset[] = [];

  for (const asset of assets) {
    const primary = asset.clip.tags.primary;
    if (!primary) {
      untagged.push(asset);
      continue;
    }
    const button = buttonById.get(primary);
    if (!button) {
      unknown.push(asset);
      continue;
    }
    button.clips.push(asset);
  }
  for (const group of groups) {
    group.clipCount = group.buttons.reduce((sum, button) => sum + button.clips.length, 0);
  }
  return { groups, untagged, unknown, chronological: assets };
}

export function createClipSlide(clipId: string, id = newId('slide')): ClipSlide {
  return { id, kind: 'clip', clipId, pausePins: null, notes: '' };
}

export function createPinSlide(clipId: string, pinId: string, id = newId('slide')): PinSlide {
  return {
    id,
    kind: 'pin',
    clipId,
    pinId,
    showAnnotations: true,
    annotationIds: null,
    notes: '',
  };
}

export function createTitleSlide(
  template: TitleSlide['template'] = 'title',
  id = newId('slide'),
): TitleSlide {
  return {
    id,
    kind: 'title',
    template,
    title: 'Untitled title slide',
    body: '',
    notes: '',
  };
}

function edgeKey(from: PresentationSlide, to: PresentationSlide): string {
  return `${from.id}::${to.id}`;
}

export function synchronizeTransitions(
  previousSlides: readonly PresentationSlide[],
  nextSlides: readonly PresentationSlide[],
  previousTransitions: readonly PresentationTransition[],
): PresentationTransition[] {
  const previousByEdge = new Map<string, PresentationTransition>();
  previousSlides.slice(0, -1).forEach((slide, index) => {
    const to = previousSlides[index + 1];
    const transition = previousTransitions[index];
    if (to && transition) previousByEdge.set(edgeKey(slide, to), transition);
  });
  return nextSlides.slice(0, -1).map((slide, index) => (
    previousByEdge.get(edgeKey(slide, nextSlides[index + 1]!)) ?? { mode: 'cut' }
  ));
}

export function withUpdatedPresentation(
  presentation: Presentation,
  slides: PresentationSlide[],
  updatedAt = new Date().toISOString(),
): Presentation {
  return {
    ...presentation,
    slides,
    transitions: synchronizeTransitions(
      presentation.slides,
      slides,
      presentation.transitions,
    ),
    updatedAt,
  };
}

export function insertSlide(
  presentation: Presentation,
  slide: PresentationSlide,
  index = presentation.slides.length,
): Presentation {
  const target = Math.max(0, Math.min(presentation.slides.length, Math.trunc(index)));
  const slides = presentation.slides.slice();
  slides.splice(target, 0, slide);
  return withUpdatedPresentation(presentation, slides);
}

export function moveSlide(
  presentation: Presentation,
  fromIndex: number,
  toIndex: number,
): Presentation {
  if (fromIndex < 0 || fromIndex >= presentation.slides.length) return presentation;
  const slides = presentation.slides.slice();
  const [slide] = slides.splice(fromIndex, 1);
  if (!slide) return presentation;
  slides.splice(Math.max(0, Math.min(slides.length, Math.trunc(toIndex))), 0, slide);
  return withUpdatedPresentation(presentation, slides);
}

export function removeSlide(presentation: Presentation, index: number): Presentation {
  if (index < 0 || index >= presentation.slides.length) return presentation;
  return withUpdatedPresentation(
    presentation,
    presentation.slides.filter((_slide, slideIndex) => slideIndex !== index),
  );
}

export function effectivePausePins(clip: Clip, slide: ClipSlide): ClipPin[] {
  const included = slide.pausePins === null ? null : new Set(slide.pausePins);
  return clip.pins
    .filter((pin) => included === null || included.has(pin.id))
    .slice()
    .sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id));
}

function resolvePinSlide(
  slide: PinSlide,
  clipsById: ReadonlyMap<string, Clip>,
): { clip: Clip; pin: ClipPin } | null {
  const clip = clipsById.get(slide.clipId);
  const pin = clip?.pins.find((candidate) => candidate.id === slide.pinId);
  return clip && pin ? { clip, pin } : null;
}

export function validateMatchVideoEdge(
  fromSlide: PresentationSlide,
  toSlide: PresentationSlide,
  transition: PresentationTransition,
  clips: readonly Clip[],
  manifest: ProjectManifest,
): MatchVideoEdgeResult {
  if (transition.mode !== 'match_video') return { ok: false, code: 'notMatchVideo', reason: 'Transition is not match video.' };
  if (fromSlide.kind !== 'pin' || toSlide.kind !== 'pin') {
    return { ok: false, code: 'requiresPins', reason: 'Match video requires two pin slides.' };
  }
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const from = resolvePinSlide(fromSlide, clipsById);
  const to = resolvePinSlide(toSlide, clipsById);
  if (!from || !to) return { ok: false, code: 'missingPins', reason: 'One or both pin slides are missing.' };
  if (from.clip.videoId !== to.clip.videoId) {
    return { ok: false, code: 'sameVideo', reason: 'Match video pins must belong to the same video.' };
  }
  if (to.pin.frame <= from.pin.frame) {
    return { ok: false, code: 'forward', reason: 'Match video pins must be ordered forward in time.' };
  }
  const start = from.pin.frame + (transition.startOffsetFrames ?? 0);
  const end = to.pin.frame + (transition.endOffsetFrames ?? 0);
  if (start < from.pin.frame || end > to.pin.frame || end <= start) {
    return { ok: false, code: 'emptyRange', reason: 'Match video offsets produce an empty or out-of-pin range.' };
  }
  const video = manifest.videos.find((candidate) => candidate.id === from.clip.videoId);
  if (!video || start < 0 || end > video.frameCount) {
    return { ok: false, code: 'outsideVideo', reason: 'Match video range is outside the source video.' };
  }
  return {
    ok: true,
    video,
    range: { startFrame: videoFrame(start), endFrame: frameBoundary(end) },
  };
}
