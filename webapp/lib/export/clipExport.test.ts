import { beforeEach, describe, expect, it, vi } from 'vitest';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import { MockFileSystem } from '../fs/test/mockFileSystem';
import type { TaggingBoard } from '../tagging/board';
import type { Clip } from '../types/clip';
import type { ProjectManifest } from '../types/project';
import { createFrameRasterQueue } from '../media/frameRaster';
import { renderAnnotatedPng } from './d7Render';
import { annotatedPinExportName, clipRowsToCsv, exportAllClips } from './clipExport';

vi.mock('../media/frameRaster', () => ({
  createFrameRasterQueue: vi.fn(() => ({
    rasterize: vi.fn(async () => ({ blob: new Blob(['frame']), width: 640, height: 360 })),
    dispose: vi.fn(),
  })),
}));

vi.mock('./d7Render', () => ({
  renderAnnotatedPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));

const manifest: ProjectManifest = {
  schema: 'project.v2',
  name: 'Export',
  created: '2026-07-11T00:00:00.000Z',
  videos: [{
    id: 'video',
    label: 'Match',
    file: 'media/match.mp4',
    fps: 25,
    frameCount: frameBoundary(100),
    frameCountSource: 'normalize',
    width: 640,
    height: 360,
  }],
};

const board: TaggingBoard = {
  schema: 'tagging-board.v1',
  defaults: { leadSeconds: 0.04, lagSeconds: 0.04, mode: 'instant' },
  facets: [],
  groups: [{ id: 'attack', label: 'Attack', buttons: [{ id: 'attack.pass', label: 'Pass' }] }],
};

const clip: Clip = {
  schema: 'clip.v2',
  id: 'clip-a',
  label: 'Pass, then shot',
  videoId: 'video',
  startFrame: videoFrame(10),
  endFrame: frameBoundary(50),
  tags: { primary: 'attack.pass', facets: { outcome: 'goal', players: ['nine', 'ten'] } },
  annotations: [{
    id: 'animated',
    type: 'highlight',
    coordMode: 'image',
    source: 'manual',
    style: {},
    keyframes: [{ frame: videoFrame(10), cx: 100, cy: 100, radius: 20, provenance: 'manual' }],
  }],
  pins: [{
    id: 'pin-a',
    frame: videoFrame(20),
    annotations: [
      { id: 'ann-a', file: 'annotations/ann-a.json', role: 'default' },
      { id: 'ann-missing', file: 'annotations/ann-missing.json', role: 'alternate' },
    ],
  }],
};

describe('clip report export', () => {
  beforeEach(() => {
    vi.mocked(createFrameRasterQueue).mockClear();
    vi.mocked(renderAnnotatedPng).mockClear();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 640,
      height: 360,
      close: vi.fn(),
    })));
  });

  it('renders one collision-free file per available pin document and reports partial failures', async () => {
    const fs = new MockFileSystem({
      'media/match.mp4': 'video',
      'analysis/clips/clip-a/annotations/ann-a.json': JSON.stringify({
        schema: 'annotations.v2',
        annotationId: 'ann-a',
        clipId: 'clip-a',
        pinId: 'pin-a',
        frame: 20,
        image: { width: 640, height: 360 },
        shapes: [{ id: 'box', type: 'box', x: 1, y: 2, w: 3, h: 4 }],
      }),
    });
    const result = await exportAllClips({
      projectDir: fs.root,
      manifest,
      clips: [clip],
      board,
    });
    expect(result.rows[0]).toMatchObject({
      id: 'clip-a',
      durationFrames: 40,
      duration: '00:01.600',
      primaryTagLabel: 'Pass',
      pinCount: 1,
      animatedAnnotationTotal: 1,
      pinAnnotationDocumentTotal: 2,
      pinAnnotationShapeTotal: 1,
    });
    expect(result.failures).toEqual([expect.objectContaining({ annotationId: 'ann-missing' })]);
    expect(fs.exists('exports/report/annotated/clip-a-f20-pin-a-ann-a.png')).toBe(true);
    expect(fs.exists('exports/report/clips.json')).toBe(true);
    expect(fs.exists('exports/report/clips.csv')).toBe(true);
    expect(renderAnnotatedPng).toHaveBeenCalledTimes(1);
  });

  it('uses deterministic names and stable CSV serialization', () => {
    expect(annotatedPinExportName('clip/a', 3, 'pin a', 'ann:a')).toBe('clip_a-f3-pin_a-ann_a.png');
    const row = {
      id: 'clip-a',
      label: 'Pass, then shot',
      videoId: 'video',
      videoLabel: 'Match',
      startFrame: 10,
      endFrame: 50,
      durationFrames: 40,
      duration: '00:01.600',
      primaryTag: 'attack.pass',
      primaryTagLabel: 'Pass',
      facets: { players: ['ten', 'nine'], outcome: 'goal' },
      pinCount: 1,
      animatedAnnotationTotal: 1,
      pinAnnotationDocumentTotal: 2,
      pinAnnotationShapeTotal: 1,
      annotatedFiles: ['exports/report/annotated/a.png'],
    };
    const csv = clipRowsToCsv([row]);
    expect(csv).toContain('outcome=goal|players=nine|players=ten');
    expect(csv).toContain('"Pass, then shot"');
  });
});
