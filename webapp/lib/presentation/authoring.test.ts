import { describe, expect, it } from 'vitest';

import { buildChronologicalStillGroups, buildClipCenteredStillGroups } from './authoring';
import type { ProjectManifestV1 } from '../types/project';
import type { Clip } from '../types/clip';

function buildManifest(): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name: 'Test project',
    created: new Date().toISOString(),
    videos: [
      { id: 'video-b', label: 'Video B', file: 'videos/b.mp4' },
      { id: 'video-a', label: 'Video A', file: 'videos/a.mp4' },
    ],
    marks: [
      { id: 'mark-1', videoId: 'video-a', t_ms: 6000, tags: { primary: 'build_up', facets: {} } },
      { id: 'mark-2', videoId: 'video-a', t_ms: 2000, tags: { primary: 'press', facets: {} } },
    ],
    stills: [
      { id: 'still-3', videoId: 'video-a', t_ms: 6000, file: 'stills/003.png', sourceMarkId: 'mark-1' },
      { id: 'still-2', videoId: 'video-a', t_ms: 2000, file: 'stills/002.png', sourceMarkId: 'mark-2' },
      { id: 'still-1', videoId: 'video-b', t_ms: 1000, file: 'stills/001.png' },
      { id: 'still-4', videoId: 'video-a', t_ms: 6000, file: 'stills/004.png', sourceMarkId: 'mark-1' },
    ],
    annotations: [],
    reports: [],
    thumbnails: [],
  };
}

describe('buildChronologicalStillGroups', () => {
  it('groups stills by video in manifest order and sorts each group chronologically', () => {
    const groups = buildChronologicalStillGroups(buildManifest());

    expect(groups.map((group) => group.videoId)).toEqual(['video-b', 'video-a']);
    expect(groups[0]?.videoLabel).toBe('Video B');
    expect(groups[1]?.stills.map((entry) => entry.still.id)).toEqual(['still-2', 'still-3', 'still-4']);
  });

  it('preserves source-mark context for chronological rows', () => {
    const groups = buildChronologicalStillGroups(buildManifest());
    const videoA = groups.find((group) => group.videoId === 'video-a');
    const canonical = videoA?.stills.find((entry) => entry.still.id === 'still-3');
    const nonCanonical = videoA?.stills.find((entry) => entry.still.id === 'still-4');
    const unlinked = groups.find((group) => group.videoId === 'video-b')?.stills[0];

    expect(canonical?.sourceMark?.id).toBe('mark-1');
    expect(canonical?.canonicalForSourceMark).toBe(true);
    expect(canonical?.primaryTag).toBe('build_up');
    expect(nonCanonical?.canonicalForSourceMark).toBe(false);
    expect(unlinked?.sourceMark).toBeNull();
    expect(unlinked?.primaryTag).toBeNull();
  });
});

describe('buildClipCenteredStillGroups', () => {
  const clips: Clip[] = [
    {
      schema: 1,
      id: 'clip-a',
      videoId: 'video-a',
      startMs: 1500,
      endMs: 6500,
      annotations: [],
    },
    {
      schema: 1,
      id: 'clip-b',
      videoId: 'video-b',
      startMs: 500,
      endMs: 1500,
      annotations: [],
    },
  ];

  it('groups stills under clips using the derived in-bounds relationship', () => {
    const groups = buildClipCenteredStillGroups(buildManifest(), clips);

    expect(groups.map((group) => group.clip.id)).toEqual(['clip-b', 'clip-a']);
    expect(groups[0]?.stills.map((entry) => entry.still.id)).toEqual(['still-1']);
    expect(groups[1]?.stills.map((entry) => entry.still.id)).toEqual(['still-2', 'still-3', 'still-4']);
  });

  it('preserves source-mark context for clip-centered still rows', () => {
    const groups = buildClipCenteredStillGroups(buildManifest(), clips);
    const clipA = groups.find((group) => group.clip.id === 'clip-a');
    const canonical = clipA?.stills.find((entry) => entry.still.id === 'still-3');
    const nonCanonical = clipA?.stills.find((entry) => entry.still.id === 'still-4');

    expect(canonical?.sourceMark?.id).toBe('mark-1');
    expect(canonical?.canonicalForSourceMark).toBe(true);
    expect(canonical?.primaryTag).toBe('build_up');
    expect(nonCanonical?.canonicalForSourceMark).toBe(false);
  });
});
