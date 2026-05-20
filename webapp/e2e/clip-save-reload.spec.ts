import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

const CLIP_ID = 'clip-playwright-1';

async function readClipFromFixture(page: Page) {
  return await page.evaluate(async (clipId) => {
    const dir = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    const clipsDir = await dir.getDirectoryHandle('clips', { create: false });
    const handle = await clipsDir.getFileHandle(`clip-${clipId}.json`, { create: false });
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  }, CLIP_ID);
}

test('clip editor persists imported annotations across reload', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );

  await page.goto(`/clip/${CLIP_ID}`);
  await page.getByRole('button', { name: 'Open Project Folder' }).click();

  await expect(page.getByText('1 available for import')).toBeVisible();
  await page.getByRole('button', { name: /^Import 0:00:/ }).click();
  await expect(page.getByText(/Imported 1 annotations from still-playwright-1/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return clip.annotations.length;
  }).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: 'Open Project Folder' }).click();

  await expect(page.getByText('Clip: 0:00 – 0:01 · 1 annotations')).toBeVisible();
  await expect(page.getByText('1 ann · 1 visible')).toBeVisible();

  const clip = await readClipFromFixture(page);
  expect(clip.annotations).toHaveLength(1);
  expect(clip.annotations[0]).toMatchObject({
    type: 'box',
    source: 'manual',
    coordMode: 'image',
  });
  expect(clip.annotations[0].keyframes[0]).toMatchObject({
    tMs: 200,
    x: 140,
    y: 90,
    w: 120,
    h: 150,
  });
});
