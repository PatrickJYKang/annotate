import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTaggingBoard } from '../tagging/board';
import { parseAnnotations } from '../types/annotations';
import { parseClip, type Clip } from '../types/clip';
import { checkProjectIntegrity } from '../utils/projectIntegrity';
import { MockFileSystem } from './test/mockFileSystem';
import { parsePresentation } from './presentationStorage';
import { parseProjectManifest } from './projectFolder';

const FIXTURE_ROOT = fileURLToPath(new URL('../../e2e/fixtures/', import.meta.url));

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function parseFixture(fixtureName: string): Promise<Clip[]> {
  const fixturePath = path.join(FIXTURE_ROOT, fixtureName);
  parseProjectManifest(await readJson(path.join(fixturePath, 'project.json')));
  parseTaggingBoard(await readFile(path.join(fixturePath, 'tagging-board.json'), 'utf8'));

  const clipsPath = path.join(fixturePath, 'analysis', 'clips');
  const clipEntries = await readdir(clipsPath, { withFileTypes: true });
  const clips: Clip[] = [];
  for (const entry of clipEntries) {
    if (!entry.isDirectory()) continue;
    const clipPath = path.join(clipsPath, entry.name);
    const clip = parseClip(await readJson(path.join(clipPath, 'clip.json')), {
      folderId: entry.name,
    });
    clips.push(clip);

    const annotationsPath = path.join(clipPath, 'annotations');
    const annotationEntries = await readdir(annotationsPath, { withFileTypes: true });
    for (const annotationEntry of annotationEntries) {
      if (!annotationEntry.isFile() || !annotationEntry.name.endsWith('.json')) continue;
      parseAnnotations(await readJson(path.join(annotationsPath, annotationEntry.name)));
    }
  }

  const presentationEntries = await readdir(path.join(fixturePath, 'presentations'), {
    withFileTypes: true,
  });
  for (const entry of presentationEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    parsePresentation(await readJson(path.join(fixturePath, 'presentations', entry.name)));
  }
  return clips;
}

async function fixtureFiles(
  fixtureName: string,
): Promise<Record<string, Uint8Array>> {
  const fixturePath = path.join(FIXTURE_ROOT, fixtureName);
  const files: Record<string, Uint8Array> = {};

  const visit = async (directoryPath: string, relativePath = ''): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) await visit(childPath, childRelativePath);
      else if (entry.isFile()) files[childRelativePath] = await readFile(childPath);
    }
  };

  await visit(fixturePath);
  return files;
}

describe('v2 fixture graphs', () => {
  it('keeps the clip-editor fixture valid and frame-native', async () => {
    const clips = await parseFixture('clip-editor-project');

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ startFrame: 5, endFrame: 45 });
    expect(clips[0].annotations[0].keyframes.map((keyframe) => keyframe.frame)).toEqual([
      8,
      20,
      38,
    ]);
  });

  it('allows overlapping clips to own independent pins at the same source frame', async () => {
    const clips = await parseFixture('retrieval-project');

    expect(clips).toHaveLength(2);
    expect(clips.map((clip) => clip.pins[0].frame)).toEqual([25, 25]);
    expect(new Set(clips.map((clip) => clip.pins[0].id)).size).toBe(2);
  });

  it('surfaces the deliberate cross-document failures in the broken fixture', async () => {
    await parseFixture('broken-project');
    const files = await fixtureFiles('broken-project');
    const fileSystem = new MockFileSystem(files);
    const manifest = parseProjectManifest(JSON.parse(await fileSystem.readText('project.json')));

    const report = await checkProjectIntegrity(fileSystem.root, manifest);
    const codes = report.issues.map((issue) => issue.code);

    expect(report.ok).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      'unresolved-clip-video',
      'annotation-anchor-mismatch',
      'orphan-annotation-document',
      'unresolved-presentation-clip',
    ]));
  });
});
