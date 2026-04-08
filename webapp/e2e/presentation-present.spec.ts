import path from 'node:path';
import { promises as fs } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

test('presents without separate prepare controls and upgrades to exact transition playback when media becomes ready', async ({ page }, testInfo) => {
  const browserConsoleMessages: string[] = [];
  const failedBlobRequests: string[] = [];
  page.on('console', (message) => {
    browserConsoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('blob:')) {
      failedBlobRequests.push(request.url());
    }
  });

  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/retrieval-project.matchproj'),
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

  await page.getByRole('button', { name: /0:00\.400 Untagged/ }).click();
  await page.getByRole('button', { name: 'Create still + add' }).first().click();
  await expect(page.getByText('1 videos · 2 marks · 1 stills · 0 clips')).toBeVisible();
  await page.getByRole('button', { name: /Slide 2/i }).click();

  await page.getByRole('button', { name: /0:01\.200 Untagged/ }).click();
  await page.getByRole('button', { name: 'Create still + add' }).first().click();
  await expect(page.getByText('1 videos · 2 marks · 2 stills · 0 clips')).toBeVisible();

  await page.getByRole('button', { name: /Slide 2/i }).click();
  await page.locator('select').last().selectOption('match_video');
  await page.evaluate(() => {
    (window as Window & { __ANNOTATE_MEDIA_TRACE__?: unknown[]; __ANNOTATE_MEDIA_TRACE_SEQ__?: number }).__ANNOTATE_MEDIA_TRACE__ = [];
    (window as Window & { __ANNOTATE_MEDIA_TRACE__?: unknown[]; __ANNOTATE_MEDIA_TRACE_SEQ__?: number }).__ANNOTATE_MEDIA_TRACE_SEQ__ = 0;
  });

  await page.getByRole('button', { name: 'Present', exact: true }).click();

  await expect(page.getByText('Present mode')).toBeVisible();
  await expect(page.getByText('Exact playback active')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Marks' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next' }).click();

  let transitionPlayable = false;
  try {
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null;
        return !!video && video.readyState > 0;
      });
    }, { timeout: 30000 }).toBe(true);
    transitionPlayable = true;
  } catch {
    const summary = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      return {
        bodyText: document.body.innerText,
        hasVideo: !!video,
        readyState: video?.readyState ?? null,
        networkState: video?.networkState ?? null,
        currentSrc: video?.currentSrc ?? null,
        paused: video?.paused ?? null,
      };
    });
    throw new Error([
      'Present-mode transition never became playable.',
      `Summary: ${JSON.stringify(summary)}`,
      'Browser console:',
      ...browserConsoleMessages,
    ].join('\n'));
  }

  expect(transitionPlayable, browserConsoleMessages.join('\n')).toBe(true);
  expect(failedBlobRequests, browserConsoleMessages.join('\n')).toEqual([]);
  expect(
    browserConsoleMessages.filter((message) => message.includes('Video autoplay was rejected')),
    browserConsoleMessages.join('\n'),
  ).toEqual([]);

  const frontendSummary = await page.evaluate(() => {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    return {
      bodyText: document.body.innerText,
      hasVideo: !!video,
      currentSrc: video?.currentSrc ?? null,
      readyState: video?.readyState ?? null,
      networkState: video?.networkState ?? null,
      paused: video?.paused ?? null,
      currentTime: video?.currentTime ?? null,
    };
  });
  const frontendSummaryPath = testInfo.outputPath('frontend-summary.json');
  await fs.writeFile(frontendSummaryPath, JSON.stringify(frontendSummary, null, 2), 'utf8');
  console.log(`FRONTEND_SUMMARY_FILE ${frontendSummaryPath}`);
  const frontendScreenshotPath = testInfo.outputPath('frontend-after-next.png');
  await page.screenshot({ path: frontendScreenshotPath, fullPage: true });
  console.log(`FRONTEND_SCREENSHOT_FILE ${frontendScreenshotPath}`);

  const mediaTrace = await page.evaluate(() => {
    return (window as Window & { __ANNOTATE_MEDIA_TRACE__?: unknown[] }).__ANNOTATE_MEDIA_TRACE__ ?? [];
  });
  const mediaTracePath = testInfo.outputPath('media-trace.json');
  await fs.writeFile(mediaTracePath, JSON.stringify(mediaTrace, null, 2), 'utf8');
  console.log(`MEDIA_TRACE_FILE ${mediaTracePath}`);

  await expect(page.getByRole('button', { name: 'Exit' })).toBeVisible();

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
});
