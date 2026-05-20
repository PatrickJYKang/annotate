import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';
import { activatePresentationMarkRow } from './support/presentationHelpers';

test('opens a presentation and retrieves a mark without proxy playback', async ({ page }) => {
  const previewProxyRequests: string[] = [];
  const failedBlobRequests: string[] = [];
  const browserConsoleMessages: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/derived-media/preview-proxy')) {
      previewProxyRequests.push(request.url());
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('blob:')) {
      failedBlobRequests.push(request.url());
    }
  });
  page.on('console', (message) => {
    browserConsoleMessages.push(`[${message.type()}] ${message.text()}`);
  });

  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/retrieval-project'),
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByText('Playwright Retrieval Fixture')).toBeVisible();

  await page.getByRole('button', { name: 'Presentations' }).click();
  await page.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByText('Title slide 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Present degraded' })).toHaveCount(0);
  await activatePresentationMarkRow(page, /0:00\.400/);

  await expect(page.getByText('Retrieved mark preview').first()).toBeVisible();
  await expect(page.getByText('Original fallback').first()).toBeVisible();

  const playerVideo = page.locator('video').first();
  await expect(playerVideo).toBeVisible();
  await expect
    .poll(async () => playerVideo.evaluate((element) => (element as HTMLVideoElement).readyState))
    .toBeGreaterThan(0);

  await page.waitForTimeout(1000);

  expect(previewProxyRequests, browserConsoleMessages.join('\n')).toEqual([]);
  expect(failedBlobRequests, browserConsoleMessages.join('\n')).toEqual([]);
});
