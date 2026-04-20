import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

const CLIP_ID = 'clip-playwright-1';

test('presentation authoring treats clips as first-class assets and supports clip-centered browsing', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project.matchproj'),
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByText('Playwright Clip Fixture')).toBeVisible();

  await page.getByRole('button', { name: 'Presentations' }).click();
  await page.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByText('1 videos · 1 marks · 1 stills · 1 clips')).toBeVisible();
  await page.getByRole('button', { name: 'Clip centered' }).click();
  await expect(page.getByRole('button', { name: 'Add clip' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add still' })).toBeVisible();

  await page.getByRole('button', { name: 'Add still' }).click();
  await page.getByRole('button', { name: 'Add clip' }).click();

  await expect(page.getByRole('button', { name: /Slide 2/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Slide 3/i })).toBeVisible();

  await page.getByRole('button', { name: /Slide 2/i }).click();
  await expect(page.getByText('Kind: clip')).toBeVisible();
  await expect(page.getByText(`Clip: ${CLIP_ID}`)).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
});
