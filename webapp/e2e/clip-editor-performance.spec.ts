import path from 'node:path';
import { expect, test } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const CLIP_ID = 'clip-sequence';
const START_FRAME = 5;
const TRACKED_FRAME_COUNT = 1000;

test('keeps dense tracked timelines responsive during playback and drawing', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
    { rootName: 'clip-editor-performance-project' },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  await page.evaluate(async ({ clipId, startFrame, trackedFrameCount }) => {
    const project = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const writeJson = async (
      directory: FileSystemDirectoryHandle,
      fileName: string,
      value: unknown,
    ) => {
      const file = await directory.getFileHandle(fileName, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(value, null, 2));
      await writable.close();
    };

    const projectFile = await project.getFileHandle('project.json').then((handle) => handle.getFile());
    const projectData = JSON.parse(await projectFile.text());
    projectData.videos[0].frameCount = startFrame + trackedFrameCount;
    await writeJson(project, 'project.json', projectData);

    const clips = await project.getDirectoryHandle('analysis')
      .then((analysis) => analysis.getDirectoryHandle('clips'));
    const clipDirectory = await clips.getDirectoryHandle(clipId);
    const clipFile = await clipDirectory.getFileHandle('clip.json').then((handle) => handle.getFile());
    const clipData = JSON.parse(await clipFile.text());
    const highlights = Array.from({ length: 6 }, (_, objectIndex) => ({
      id: `dense-highlight-${objectIndex}`,
      type: 'highlight',
      name: `Player ${objectIndex + 1}`,
      coordMode: 'image',
      source: 'auto',
      style: {
        stroke: '#ffffff',
        fill: '#ffffff',
        fillOpacity: 0.2,
        strokeWidth: 6,
      },
      keyframes: Array.from({ length: trackedFrameCount }, (_, frameIndex) => ({
        frame: startFrame + frameIndex,
        cx: 100 + objectIndex * 75 + frameIndex * 0.1,
        cy: 210 + objectIndex * 9,
        radius: 32,
        provenance: 'tracked',
      })),
    }));
    clipData.endFrame = startFrame + trackedFrameCount;
    clipData.annotations = [
      ...highlights,
      {
        id: 'dense-poly',
        type: 'poly',
        coordMode: 'image',
        source: 'manual',
        closed: false,
        vertexRefs: highlights.slice(0, 4).map((highlight) => highlight.id),
        style: {
          stroke: '#00e5a8',
          fill: 'transparent',
          strokeWidth: 5,
        },
        keyframes: [{
          frame: startFrame,
          points: [[100, 210], [175, 219], [250, 228], [325, 237]],
          provenance: 'manual',
        }],
      },
    ];
    await writeJson(clipDirectory, 'clip.json', clipData);
  }, {
    clipId: CLIP_ID,
    startFrame: START_FRAME,
    trackedFrameCount: TRACKED_FRAME_COUNT,
  });

  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await page.getByTestId(`clip-tree-row-${CLIP_ID}`).click();
  const editorPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  const editorPage = await editorPagePromise;
  await editorPage.setViewportSize({ width: 1280, height: 900 });

  await expect(editorPage.getByTestId('clip-editor')).toBeVisible();
  await expect(editorPage.locator('[data-timeline-annotation-id] button')).toHaveCount(6001);

  await editorPage.getByRole('button', { name: 'Play', exact: true }).click();
  await editorPage.waitForTimeout(750);
  await expect.poll(
    () => editorPage.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
  ).toBeGreaterThan(0.5);
  await editorPage.getByRole('button', { name: 'Pause', exact: true }).click();

  const stage = editorPage.getByTestId('clip-stage');
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error('Clip stage did not have a layout box.');
  await editorPage.getByRole('button', { name: 'Arrow', exact: true }).click();
  await editorPage.mouse.click(
    stageBox.x + stageBox.width * 0.2,
    stageBox.y + stageBox.height * 0.35,
  );
  const pointerStartedAt = Date.now();
  await editorPage.mouse.move(
    stageBox.x + stageBox.width * 0.75,
    stageBox.y + stageBox.height * 0.6,
    { steps: 80 },
  );
  expect(Date.now() - pointerStartedAt).toBeLessThan(5000);
  await editorPage.mouse.click(
    stageBox.x + stageBox.width * 0.75,
    stageBox.y + stageBox.height * 0.6,
  );
  await expect(editorPage.getByRole('button', { name: '8. Arrow', exact: true })).toBeVisible();
});
