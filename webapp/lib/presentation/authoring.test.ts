import { describe, expect, it } from 'vitest';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { TaggingBoard } from '../tagging/board';
import type { Clip } from '../types/clip';
import { createDefaultPresentation } from '../types/presentation';
import type { ProjectManifest } from '../types/project';
import {
  buildPresentationAssetIndex,
  createClipSlide,
  createPinSlide,
  insertSlide,
  moveSlide,
  validateMatchVideoEdge,
} from './authoring';

const manifest: ProjectManifest = {
  schema: 'project.v2',
  name: 'Test',
  created: '2026-07-11T00:00:00.000Z',
  videos: [{
    id: 'video-a', label: 'Match', file: 'media/match.mp4', fps: 25,
    frameCount: frameBoundary(200), frameCountSource: 'normalize', width: 640, height: 360,
  }],
};

const board: TaggingBoard = {
  schema: 'tagging-board.v1',
  defaults: { leadSeconds: 0.4, lagSeconds: 0.4, mode: 'instant' },
  groups: [{ id: 'attack', label: 'Attack', buttons: [{ id: 'attack.pass', label: 'Pass' }] }],
  facets: [],
};

function clip(id: string, primary: string | null, start: number, pinFrame = start + 5): Clip {
  return {
    schema: 'clip.v2', id, videoId: 'video-a', startFrame: videoFrame(start),
    endFrame: frameBoundary(start + 20), tags: { primary, facets: {} }, annotations: [],
    pins: [{ id: `pin-${id}`, frame: videoFrame(pinFrame), annotations: [] }],
  };
}

describe('v2 presentation authoring', () => {
  it('groups clip-first assets by the board and preserves chronology', () => {
    const known = clip('known', 'attack.pass', 30);
    const untagged = clip('untagged', null, 10);
    const unknown = clip('unknown', 'old.tag', 20);
    const index = buildPresentationAssetIndex(board, manifest, [known, unknown, untagged]);
    expect(index.groups[0]?.buttons[0]?.clips.map((entry) => entry.clip.id)).toEqual(['known']);
    expect(index.untagged.map((entry) => entry.clip.id)).toEqual(['untagged']);
    expect(index.unknown.map((entry) => entry.clip.id)).toEqual(['unknown']);
    expect(index.chronological.map((entry) => entry.clip.id)).toEqual(['untagged', 'unknown', 'known']);
  });

  it('keeps transition identity attached to an unchanged slide edge', () => {
    let presentation = createDefaultPresentation('Deck', 'deck', new Date('2026-07-11T00:00:00.000Z'));
    presentation = insertSlide(presentation, createClipSlide('a', 'slide-a'));
    presentation = insertSlide(presentation, createClipSlide('b', 'slide-b'));
    presentation = insertSlide(presentation, createClipSlide('c', 'slide-c'));
    presentation = {
      ...presentation,
      transitions: [{ mode: 'cut' }, { mode: 'match_video', hideAnnotationsDuringPlayback: true }],
    };
    const moved = moveSlide(presentation, 0, 2);
    expect(moved.slides.map((slide) => slide.id)).toEqual(['slide-b', 'slide-c', 'slide-a']);
    expect(moved.transitions).toEqual([
      { mode: 'match_video', hideAnnotationsDuringPlayback: true },
      { mode: 'cut' },
    ]);
  });

  it('validates forward same-video pin transitions and frame offsets', () => {
    const first = clip('first', 'attack.pass', 10, 20);
    const second = clip('second', 'attack.pass', 40, 60);
    const from = createPinSlide(first.id, first.pins[0]!.id, 'from');
    const to = createPinSlide(second.id, second.pins[0]!.id, 'to');
    const valid = validateMatchVideoEdge(from, to, {
      mode: 'match_video', hideAnnotationsDuringPlayback: true,
      startOffsetFrames: 2, endOffsetFrames: -3,
    }, [first, second], manifest);
    expect(valid).toMatchObject({ ok: true, range: { startFrame: 22, endFrame: 57 } });
    expect(validateMatchVideoEdge(to, from, {
      mode: 'match_video', hideAnnotationsDuringPlayback: true,
    }, [first, second], manifest)).toMatchObject({ ok: false });
  });
});
