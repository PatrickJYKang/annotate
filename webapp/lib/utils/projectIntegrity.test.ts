import { describe, expect, it } from 'vitest';

import defaultBoardDocument from '../../public/tagging/board.json';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import { writeClip } from '../fs/clipStorage';
import { writeJsonFile, writeTextFile } from '../fs/fsAccess';
import { createProject, writeProjectManifest } from '../fs/projectFolder';
import { writePresentation } from '../fs/presentationStorage';
import { MockFileSystem } from '../fs/test/mockFileSystem';
import type { Annotations } from '../types/annotations';
import type { Clip } from '../types/clip';
import type { Presentation } from '../types/presentation';
import type { ProjectManifest } from '../types/project';
import { checkProjectIntegrity } from './projectIntegrity';

async function createFixture(): Promise<{
  fileSystem: MockFileSystem;
  manifest: ProjectManifest;
  clip: Clip;
  annotation: Annotations;
}> {
  const fileSystem = new MockFileSystem();
  const created = await createProject(fileSystem.root, {
    name: 'Integrity fixture',
    created: '2026-07-11T00:00:00.000Z',
    defaultBoardSource: JSON.stringify(defaultBoardDocument),
  });
  const manifest: ProjectManifest = {
    ...created.manifest,
    videos: [{
      id: 'video_main',
      label: 'Main video',
      file: 'media/main.mp4',
      fps: 30,
      frameCount: frameBoundary(1000),
      frameCountSource: 'normalize',
      width: 1920,
      height: 1080,
    }],
  };
  await writeTextFile(fileSystem.root, ['media', 'main.mp4'], 'video bytes');
  await writeProjectManifest(fileSystem.root, manifest);
  const clip: Clip = {
    schema: 'clip.v2',
    id: 'clip_main',
    videoId: 'video_main',
    startFrame: videoFrame(100),
    endFrame: frameBoundary(200),
    tags: { primary: null, facets: {} },
    pins: [{
      id: 'pin_main',
      frame: videoFrame(150),
      annotations: [{
        id: 'ann_main',
        file: 'annotations/ann_main.json',
        role: 'default',
      }],
    }],
    annotations: [],
  };
  const annotation: Annotations = {
    schema: 'annotations.v2',
    annotationId: 'ann_main',
    clipId: clip.id,
    pinId: clip.pins[0].id,
    frame: clip.pins[0].frame,
    image: { width: 1920, height: 1080 },
    shapes: [],
  };
  await writeClip(fileSystem.root, clip);
  await writeJsonFile(fileSystem.root, ['analysis', 'clips', clip.id, 'annotations', 'ann_main.json'], annotation);
  return { fileSystem, manifest, clip, annotation };
}

describe('projectIntegrity', () => {
  it('accepts a fully resolving project graph', async () => {
    const { fileSystem, manifest, clip } = await createFixture();
    const presentation: Presentation = {
      schema: 2,
      id: 'presentation_main',
      name: 'Review',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      slides: [{
        id: 'clip_slide',
        kind: 'clip',
        clipId: clip.id,
        pausePins: null,
        pauseCues: [{ pinId: clip.pins[0].id, annotationIds: null }],
      }],
      transitions: [],
    };
    await writePresentation(fileSystem.root, presentation);

    const report = await checkProjectIntegrity(fileSystem.root, manifest);
    expect(report).toMatchObject({ ok: true, issues: [] });
  });

  it('reports anchor mismatches, missing documents, and clip-local orphans', async () => {
    const { fileSystem, manifest, clip, annotation } = await createFixture();
    clip.pins[0].annotations.push({
      id: 'ann_missing',
      file: 'annotations/ann_missing.json',
      role: 'alternate',
    });
    await writeClip(fileSystem.root, clip);
    await writeJsonFile(
      fileSystem.root,
      ['analysis', 'clips', clip.id, 'annotations', 'ann_main.json'],
      { ...annotation, frame: videoFrame(151) },
    );
    await writeJsonFile(
      fileSystem.root,
      ['analysis', 'clips', clip.id, 'annotations', 'orphan.json'],
      annotation,
    );

    const report = await checkProjectIntegrity(fileSystem.root, manifest);
    expect(report.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'annotation-anchor-mismatch',
      'missing-annotation-document',
      'orphan-annotation-document',
    ]));
    expect(report.ok).toBe(false);
  });

  it('degrades unresolved presentation references into visible warnings', async () => {
    const { fileSystem, manifest, clip } = await createFixture();
    const presentation: Presentation = {
      schema: 2,
      id: 'presentation_broken',
      name: 'Broken references',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      slides: [
        {
          id: 'pin_one',
          kind: 'pin',
          clipId: clip.id,
          pinId: clip.pins[0].id,
          showAnnotations: true,
          annotationIds: ['ann_missing'],
          annotationCues: [{ annotationId: 'ann_missing' }],
        },
        {
          id: 'pin_two',
          kind: 'pin',
          clipId: 'clip_missing',
          pinId: 'pin_missing',
          showAnnotations: true,
        },
      ],
      transitions: [{
        mode: 'match_video',
        hideAnnotationsDuringPlayback: true,
      }],
    };
    await writePresentation(fileSystem.root, presentation);

    const report = await checkProjectIntegrity(fileSystem.root, manifest);
    expect(report.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'unresolved-presentation-annotation',
      'unresolved-presentation-clip',
      'invalid-match-video-transition',
    ]));
    expect(report.issues.filter((entry) => entry.path.includes('presentations/')).every(
      (entry) => entry.severity === 'warning',
    )).toBe(true);
  });

  it('treats missing source media and unresolved clip video ids as errors', async () => {
    const { fileSystem, manifest, clip } = await createFixture();
    await fileSystem.root.getDirectoryHandle('media').then((media) => media.removeEntry('main.mp4'));
    clip.videoId = 'video_missing';
    await writeClip(fileSystem.root, clip);

    const report = await checkProjectIntegrity(fileSystem.root, manifest);
    expect(report.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'missing-video-file',
      'unresolved-clip-video',
    ]));
    expect(report.ok).toBe(false);
  });
});
