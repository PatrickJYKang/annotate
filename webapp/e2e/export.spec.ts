import path from 'node:path';
import { expect, test } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

test('v2 report export writes clip rows and one annotated PNG per pin document', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Export report…' }).click();

  const progress = page.getByRole('region', { name: 'Export report progress' });
  await expect(progress).toContainText('Export complete');
  await expect(progress).toContainText('4/4');
  await expect(page.getByText('Report exported to exports/report/.')).toBeVisible();

  const exported = await page.evaluate(async () => {
    const root = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const exportsDirectory = await root.getDirectoryHandle('exports');
    const report = await exportsDirectory.getDirectoryHandle('report');
    const annotated = await report.getDirectoryHandle('annotated');
    const exportEntries: string[] = [];
    const reportEntries: string[] = [];
    const annotatedEntries: Array<{ name: string; size: number }> = [];
    for await (const [name] of exportsDirectory.entries()) exportEntries.push(name);
    for await (const [name] of report.entries()) reportEntries.push(name);
    for await (const [name, handle] of annotated.entries()) {
      if (handle.kind === 'file') {
        annotatedEntries.push({ name, size: (await (handle as FileSystemFileHandle).getFile()).size });
      }
    }
    const clipsJson = JSON.parse(await report.getFileHandle('clips.json').then((handle) => handle.getFile()).then((file) => file.text()));
    const clipsCsv = await report.getFileHandle('clips.csv').then((handle) => handle.getFile()).then((file) => file.text());
    return {
      exportEntries: exportEntries.sort(),
      reportEntries: reportEntries.sort(),
      annotatedEntries: annotatedEntries.sort((left, right) => left.name.localeCompare(right.name)),
      clipsJson,
      clipsCsv,
    };
  });

  expect(exported.exportEntries).toEqual(['.gitkeep', 'report']);
  expect(exported.reportEntries).toEqual(['annotated', 'clips.csv', 'clips.json']);
  expect(exported.annotatedEntries.map((entry) => entry.name)).toEqual([
    'clip-sequence-f15-pin-shape-ann-shape.png',
    'clip-sequence-f32-pin-release-ann-release.png',
  ]);
  expect(exported.annotatedEntries.every((entry) => entry.size > 0)).toBe(true);
  expect(exported.clipsJson).toEqual([
    expect.objectContaining({
      id: 'clip-sequence',
      videoLabel: 'Retrieval sample',
      startFrame: 5,
      endFrame: 45,
      durationFrames: 40,
      primaryTag: 'offensive.open_play.pass',
      pinCount: 2,
      animatedAnnotationTotal: 2,
      pinAnnotationDocumentTotal: 2,
      pinAnnotationShapeTotal: 2,
      annotatedFiles: [
        'exports/report/annotated/clip-sequence-f15-pin-shape-ann-shape.png',
        'exports/report/annotated/clip-sequence-f32-pin-release-ann-release.png',
      ],
    }),
  ]);
  expect(exported.clipsCsv).toContain('durationFrames');
  expect(exported.clipsCsv).toContain('pass.type=through_ball');
});
