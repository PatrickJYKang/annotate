import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

const CLIP_ID = 'clip-playwright-1';

test('presentation authoring treats clips as first-class assets and supports clip-centered browsing', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByText('Playwright Clip Fixture')).toBeVisible();

  await page.getByRole('button', { name: 'Presentations' }).click();
  await page.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByText(/stills · 1 clips/)).toBeVisible();
  await page.getByRole('button', { name: 'Clips', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add clip' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add still' })).toHaveCount(0);

  await page
    .locator('[data-presentation-asset-kind="still"][data-presentation-asset-id="still-playwright-1"]')
    .first()
    .dragTo(page.getByTestId('presentation-deck-drop-end'));
  await page
    .locator(`[data-presentation-asset-kind="clip"][data-presentation-asset-id="${CLIP_ID}"]`)
    .first()
    .dragTo(page.getByTestId('presentation-deck-drop-end'));

  await expect(page.getByRole('button', { name: /Slide 2/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Slide 3/i })).toBeVisible();

  await page.getByRole('button', { name: /Slide 3/i }).click();
  await expect(page.getByText('Kind: clip')).toBeVisible();
  await expect(page.getByText(`Clip: ${CLIP_ID}`)).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
});
