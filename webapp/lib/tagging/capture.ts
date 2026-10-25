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
  | { kind: 'armed'; range: ActiveRangeCapture; closedClip?: Clip }
  | { kind: 'waiting'; range: ActiveRangeCapture }
  | { kind: 'created'; clip: Clip; mode: 'range' };

export interface CaptureEngineOptions {
  board: TaggingBoard;
  videoFrameCount: number;
  videoFps: number;
  videoId: string;
  getButtonLabel?: (buttonId: string) => string | undefined;
  getArmedFacets?: () => TaggingSelection['facets'];
  onFacetsConsumed?: (facetGroupIds: string[]) => void;
  createId?: () => string;
}

export interface CaptureEngine {
  pressButton: (buttonId: string, playheadFrame: number) => CapturePressResult;
  pressButtonAndPersist: (
    buttonId: string,
    playheadFrame: number,
    persist: (clip: Clip) => Promise<void>,
  ) => Promise<CapturePressResult>;
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
  const exclusivePeers = new Map<string, Set<string>>();
  for (const group of options.board.exclusiveGroups ?? []) {
    const members = new Set(group.buttonIds);
    for (const id of members) exclusivePeers.set(id, members);
  }
  let order = 0;
  let saving = false;

  const snapshotTags = (buttonId: string): TaggingSelection => {
    const selection: TaggingSelection = {
      primary: buttonId,
      facets: structuredClone(options.getArmedFacets?.() ?? {}),
    };
    return pruneInapplicableFacets(options.board, buttonId, selection);
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
    generatedLabel: label,
    tags: structuredClone(tags),
    pins: [],
    annotations: [],
  });

  const getActiveRanges = (): ActiveRangeCapture[] => (
    [...activeRanges.values()]
      .sort((left, right) => left.order - right.order)
      .map(publicRange)
  );

  const preparePress = (buttonId: string, playheadFrame: number): {
    result: CapturePressResult;
    commit: () => void;
  } => {
    const capture = resolveButtonCapture(options.board, buttonId);
    const frame = clampPlayhead(playheadFrame, options.videoFrameCount);
    const active = activeRanges.get(buttonId);
    if (!active) {
      const previous = [...activeRanges.values()].find((range) => exclusivePeers.get(buttonId)?.has(range.buttonId));
      if (previous && frame < previous.startFrame) {
        return { result: { kind: 'waiting', range: publicRange(previous) }, commit() {} };
      }
      // A switch owns its first frame. The previous half-open range stops there.
      // Switching on the initial frame replaces an empty draft, not a saved clip.
      const closedClip = previous && frame > previous.startFrame
        ? createClip((options.createId ?? defaultClipId)(), previous.buttonLabel, previous.startFrame, frame, previous.tags)
        : undefined;
      const range: InternalRangeCapture = {
        buttonId,
        // Keep the name seen at capture start, even if the UI language changes.
        buttonLabel: options.getButtonLabel?.(buttonId) ?? capture.button.label,
        startFrame: frame,
        order,
        tags: snapshotTags(buttonId),
      };
      return {
        result: { kind: 'armed', range: publicRange(range), ...(closedClip ? { closedClip } : {}) },
        commit() {
          if (previous) activeRanges.delete(previous.buttonId);
          activeRanges.set(buttonId, range);
          order++;
          const consumed = Object.keys(range.tags.facets);
          if (consumed.length > 0) options.onFacetsConsumed?.(consumed);
        },
      };
    }

    const endFrame = Math.min(options.videoFrameCount, frame + 1);
    if (endFrame <= active.startFrame) {
      return { result: { kind: 'waiting', range: publicRange(active) }, commit() {} };
    }
    return {
      result: {
        kind: 'created',
        mode: 'range',
        clip: createClip(
          (options.createId ?? defaultClipId)(),
          active.buttonLabel,
          active.startFrame,
          endFrame,
          active.tags,
        ),
      },
      commit() { activeRanges.delete(buttonId); },
    };
  };

  return {
    pressButton(buttonId, playheadFrame) {
      if (saving) throw new Error('A capture is being saved.');
      const press = preparePress(buttonId, playheadFrame);
      press.commit();
      return press.result;
    },
    async pressButtonAndPersist(buttonId, playheadFrame, persist) {
      if (saving) throw new Error('A capture is being saved.');
      saving = true;
      try {
        const press = preparePress(buttonId, playheadFrame);
        const clip = press.result.kind === 'created' ? press.result.clip
          : press.result.kind === 'armed' ? press.result.closedClip : undefined;
        if (clip) await persist(clip);
        // Do not discard the old capture or consume the new facets before saving.
        press.commit();
        return press.result;
      } finally {
        saving = false;
      }
    },
    cancelRange(buttonId) {
      if (saving) return null;
      const active = activeRanges.get(buttonId);
      if (!active) return null;
      activeRanges.delete(buttonId);
      return publicRange(active);
    },
    cancelMostRecentRange() {
      if (saving) return null;
      const active = [...activeRanges.values()].sort((left, right) => right.order - left.order)[0];
      if (!active) return null;
      activeRanges.delete(active.buttonId);
      return publicRange(active);
    },
    cancelAllRanges() {
      if (saving) return [];
      const ranges = getActiveRanges();
      activeRanges.clear();
      return ranges;
    },
    getActiveRanges,
    setRangeFacets(buttonId, facets) {
      if (saving) return null;
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
