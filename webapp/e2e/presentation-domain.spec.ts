import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';
import { activatePresentationMarkRow, dragPresentationMarkToDeck, presentationMarkRow } from './support/presentationHelpers';

async function readManifestFromFixture(page: Page) {
  return await page.evaluate(async () => {
    const dir = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    const handle = await dir.getFileHandle('project.json', { create: false });
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  });
}

test('presentation mark materialization reuses an existing still instead of creating a duplicate', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/retrieval-project.matchproj'),
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByText('Playwright Retrieval Fixture')).toBeVisible();

  await page.getByRole('button', { name: 'Presentations' }).click();
  await page.getByRole('button', { name: 'Open' }).click();

  await page.getByRole('button', { name: 'Time' }).click();
  await expect(presentationMarkRow(page, /0:00\.400/)).toBeVisible();
  await expect(presentationMarkRow(page, /0:01\.200/)).toBeVisible();

  await activatePresentationMarkRow(page, /0:00\.400/);
  await dragPresentationMarkToDeck(page, /0:00\.400/);
  await expect(page.getByText('2 marks · 1 stills · 0 clips')).toBeVisible();

  await activatePresentationMarkRow(page, /0:00\.400/);
  await dragPresentationMarkToDeck(page, /0:00\.400/);
  await expect(page.getByText('2 marks · 1 stills · 0 clips')).toBeVisible();

  const manifest = await readManifestFromFixture(page);
  expect(manifest.stills).toHaveLength(1);
  expect(manifest.stills[0]).toMatchObject({
    videoId: 'video-playwright-1',
    t_ms: 400,
  });
});
