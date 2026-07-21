import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { Clip } from '../types/clip';
import {
  conflictedBoardHotkeys,
  pruneInapplicableFacets,
  resolveButtonCapture,
  type TaggingBoard,
} from './board';
import type { TaggingSelection } from './selection';

export interface ActiveRangeCapture {
  buttonId: string;
  buttonLabel: string;
  startFrame: number;
  order: number;
  facets: TaggingSelection['facets'];
}

interface InternalRangeCapture extends Omit<ActiveRangeCapture, 'facets'> {
  tags: TaggingSelection;
}

export type CapturePressResult =
  | { kind: 'armed'; range: ActiveRangeCapture }
  | { kind: 'waiting'; range: ActiveRangeCapture }
  | { kind: 'created'; clip: Clip; mode: 'range' };

export interface CaptureEngineOptions {
  board: TaggingBoard;
  videoFrameCount: number;
  videoFps: number;
  videoId: string;
  getArmedFacets?: () => TaggingSelection['facets'];
  onFacetsConsumed?: (facetGroupIds: string[]) => void;
  createId?: () => string;
}

export interface CaptureEngine {
  pressButton: (buttonId: string, playheadFrame: number) => CapturePressResult;
  cancelRange: (buttonId: string) => ActiveRangeCapture | null;
  cancelMostRecentRange: () => ActiveRangeCapture | null;
  cancelAllRanges: () => ActiveRangeCapture[];
  getActiveRanges: () => ActiveRangeCapture[];
  setRangeFacets: (buttonId: string, facets: TaggingSelection['facets']) => ActiveRangeCapture | null;
}

function defaultClipId(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `clip-${suffix}`;
}

function requireFrameCount(frameCount: number): void {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new RangeError('videoFrameCount must be a positive integer.');
  }
}

function clampPlayhead(frame: number, frameCount: number): number {
  const finite = Number.isFinite(frame) ? Math.round(frame) : 0;
  return Math.max(0, Math.min(frameCount - 1, finite));
}

function publicRange(range: InternalRangeCapture): ActiveRangeCapture {
  return {
    buttonId: range.buttonId,
    buttonLabel: range.buttonLabel,
    startFrame: range.startFrame,
    order: range.order,
    facets: structuredClone(range.tags.facets),
  };
}

export function createCaptureEngine(options: CaptureEngineOptions): CaptureEngine {
  requireFrameCount(options.videoFrameCount);
  if (!Number.isFinite(options.videoFps) || options.videoFps <= 0) {
    throw new RangeError('videoFps must be positive.');
  }
  const activeRanges = new Map<string, InternalRangeCapture>();
  let order = 0;

  const snapshotTags = (buttonId: string): TaggingSelection => {
    const selection: TaggingSelection = {
      primary: buttonId,
      facets: structuredClone(options.getArmedFacets?.() ?? {}),
    };
    const tags = pruneInapplicableFacets(options.board, buttonId, selection);
    const consumed = Object.keys(tags.facets);
    if (consumed.length > 0) options.onFacetsConsumed?.(consumed);
    return tags;
  };

  const createClip = (
    id: string,
    label: string,
    startFrame: number,
    endFrame: number,
    tags: TaggingSelection,
  ): Clip => ({
    schema: 'clip.v2',
    id,
    videoId: options.videoId,
    startFrame: videoFrame(startFrame),
    endFrame: frameBoundary(endFrame),
    label,
    tags: structuredClone(tags),
    pins: [],
    annotations: [],
  });

  const getActiveRanges = (): ActiveRangeCapture[] => (
    [...activeRanges.values()]
      .sort((left, right) => left.order - right.order)
      .map(publicRange)
  );

  return {
    pressButton(buttonId, playheadFrame) {
      const capture = resolveButtonCapture(options.board, buttonId);
      const frame = clampPlayhead(playheadFrame, options.videoFrameCount);
      const active = activeRanges.get(buttonId);
      if (!active) {
        const range: InternalRangeCapture = {
          buttonId,
          buttonLabel: capture.button.label,
          startFrame: frame,
          order: order++,
          tags: snapshotTags(buttonId),
        };
        activeRanges.set(buttonId, range);
        return { kind: 'armed', range: publicRange(range) };
      }

      const endFrame = Math.min(options.videoFrameCount, frame + 1);
      if (endFrame <= active.startFrame) {
        return { kind: 'waiting', range: publicRange(active) };
      }
      activeRanges.delete(buttonId);
      return {
        kind: 'created',
        mode: 'range',
        clip: createClip(
          (options.createId ?? defaultClipId)(),
          active.buttonLabel,
          active.startFrame,
          endFrame,
          active.tags,
        ),
      };
    },
    cancelRange(buttonId) {
      const active = activeRanges.get(buttonId);
      if (!active) return null;
      activeRanges.delete(buttonId);
      return publicRange(active);
    },
    cancelMostRecentRange() {
      const active = [...activeRanges.values()].sort((left, right) => right.order - left.order)[0];
      if (!active) return null;
      activeRanges.delete(active.buttonId);
      return publicRange(active);
    },
    cancelAllRanges() {
      const ranges = getActiveRanges();
      activeRanges.clear();
      return ranges;
    },
    getActiveRanges,
    setRangeFacets(buttonId, facets) {
      const active = activeRanges.get(buttonId);
      if (!active) return null;
      active.tags = pruneInapplicableFacets(options.board, buttonId, {
        primary: buttonId,
        facets: structuredClone(facets),
      });
      return publicRange(active);
    },
  };
}

export type BoardHotkeyAction =
  | { kind: 'button'; buttonId: string }
  | { kind: 'facet'; facetGroupId: string; optionId: string };

export interface BoardHotkeyEvent {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

export interface BoardHotkeyMap {
  actions: ReadonlyMap<string, BoardHotkeyAction>;
  resolve: (event: BoardHotkeyEvent) => BoardHotkeyAction | null;
}

function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as EventTarget & { tagName?: string; isContentEditable?: boolean };
  return element.isContentEditable === true
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName?.toUpperCase() ?? '');
}

export function buildHotkeyMap(board: TaggingBoard): BoardHotkeyMap {
  const collisions = conflictedBoardHotkeys(board);
  const actions = new Map<string, BoardHotkeyAction>();
  const add = (hotkey: string | undefined, action: BoardHotkeyAction) => {
    const key = hotkey?.trim().toLocaleLowerCase();
    if (!key || collisions.has(key)) return;
    actions.set(key, action);
  };
  board.groups.forEach((group) => group.buttons.forEach((button) => {
    add(button.hotkey, { kind: 'button', buttonId: button.id });
  }));
  board.facets.forEach((facet) => facet.options.forEach((option) => {
    add(option.hotkey, { kind: 'facet', facetGroupId: facet.id, optionId: option.id });
  }));
  return {
    actions,
    resolve(event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
      if (isTextEntryTarget(event.target)) return null;
      return actions.get(event.key.trim().toLocaleLowerCase()) ?? null;
    },
  };
}
