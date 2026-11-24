import { expect, it } from 'vitest';
import { parseClip } from '../types/clip';
import { parsePresentation } from '../fs/presentationStorage';
import { createClipSlide, createTitleSlide } from '../presentation/authoring';
import { videoFrame, frameBoundary } from '../clip/frameMath';
import type { ProjectManifest } from '../types/project';
import { importClipTake, recordingSegments, outputFrames } from './recording';

const clip = parseClip({
  schema: 'clip.v2',
  id: 'c',
  videoId: 'v',
  startFrame: 5,
  endFrame: 45,
  tags: { primary: null, facets: {} },
  annotations: [],
  pins: [{ id: 'p', frame: 15, annotations: [] }],
});
const manifest: ProjectManifest = {
  schema: 'project.v2',
  name: 'Match',
  created: '2026-01-01',
  videos: [
    {
      id: 'v',
      label: 'v',
      file: 'media/v.mp4',
      fps: 25,
      width: 640,
      height: 360,
      frameCount: frameBoundary(100),
      frameCountSource: 'probe',
    },
  ],
};
const take = {
  id: 'a',
  name: 'Short',
  startFrame: 14,
  endFrame: 17,
  pauses: [{ pinId: 'p', holdMs: 67, clickTimesMs: [32, 60] }],
};
const presentation = {
  schema: 2,
  id: 'deck',
  name: 'Deck',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  slides: [importClipTake(createClipSlide('c'), take)],
  transitions: [],
};

it('persists the recording separately from clip bounds, and copies import timings by value', () => {
  const original = parseClip({ ...clip, recordings: [take] });
  const slide = importClipTake(createClipSlide('c'), original.recordings![0]);
  slide.pauseCues![0].clickTimesMs!.push(62);
  expect(original.recordings![0].pauses[0].clickTimesMs).toEqual([32, 60]);
  expect(original.startFrame).toBe(5);
  expect(
    parsePresentation({ ...presentation, recordings: [{ ...presentation, id: 'take' }] }).recordings?.[0]
      .slides,
  ).toEqual(parsePresentation(presentation).slides);
});
it('keeps the exclusive out point and samples holds without rounding every segment up', () => {
  const segments = recordingSegments(presentation, [clip], manifest);
  expect(segments.map((s) => [s.kind, s.duration])).toEqual([
    ['video', 40],
    ['pin', 67],
    ['video', 80],
  ]);
  const frames = [...outputFrames(segments, 25)];
  expect(frames.map((f) => f.segment.kind)).toEqual(['video', 'pin', 'pin', 'video', 'video']);
  expect(frames[3].elapsed).toBe(13);
});
it('rejects stale references and malformed clock data, but opens older documents', () => {
  expect(() =>
    recordingSegments(
      presentation,
      [{ ...clip, pins: [{ ...clip.pins[0], frame: videoFrame(18) }] }],
      manifest,
    ),
  ).toThrow(/outside/);
  expect(() =>
    parseClip({
      ...clip,
      recordings: [{ ...take, pauses: [{ pinId: 'p', holdMs: 20, clickTimesMs: [32] }] }],
    }),
  ).toThrow();
  expect(parseClip(clip).recordings).toBeUndefined();
  const title = createTitleSlide('Text');
  title.holdMs = 1000;
  expect([
    ...outputFrames(recordingSegments({ slides: [title], transitions: [] }, [], manifest), 30),
  ]).toHaveLength(30);
});
