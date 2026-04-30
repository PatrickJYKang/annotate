import path from 'node:path';
import { promises as fs } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';
import { activatePresentationMarkRow, dragPresentationMarkToDeck } from './support/presentationHelpers';

test('match_video transition preview becomes playable after exact clip generation', async ({ page }, testInfo) => {
  const browserConsoleMessages: string[] = [];
  const failedBlobRequests: string[] = [];
  const previewProxyRequests: string[] = [];

  page.on('console', (message) => {
    browserConsoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  page.on('request', (request) => {
    if (request.url().includes('/derived-media/preview-proxy')) {
      previewProxyRequests.push(`${request.method()} ${request.url()}`);
    }
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

  await activatePresentationMarkRow(page, /0:00\.400/);
  await dragPresentationMarkToDeck(page, /0:00\.400/);
  await expect(page.getByText('2 marks · 1 stills · 0 clips')).toBeVisible();
  await page.getByRole('button', { name: /Slide 2/i }).click();

  await activatePresentationMarkRow(page, /0:01\.200/);
  await dragPresentationMarkToDeck(page, /0:01\.200/);
  await expect(page.getByText('2 marks · 2 stills · 0 clips')).toBeVisible();

  await page.getByRole('button', { name: /Slide 2/i }).click();
  await page.locator('select').last().selectOption('match_video');
  await page.evaluate(() => {
    (window as Window & { __ANNOTATE_MEDIA_TRACE__?: unknown[]; __ANNOTATE_MEDIA_TRACE_SEQ__?: number }).__ANNOTATE_MEDIA_TRACE__ = [];
    (window as Window & { __ANNOTATE_MEDIA_TRACE__?: unknown[]; __ANNOTATE_MEDIA_TRACE_SEQ__?: number }).__ANNOTATE_MEDIA_TRACE_SEQ__ = 0;
  });
  await page.getByRole('button', { name: 'Preview transition' }).click();

  await expect(page.getByText('Transition preview').first()).toBeVisible();
  await expect(page.getByText('Exact preview').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Zoom')).toHaveCount(0);

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
        hasVideo: !!video,
        src: video?.currentSrc ?? video?.getAttribute('src') ?? null,
        readyState: video?.readyState ?? 0,
        networkState: video?.networkState ?? null,
        paused: video?.paused ?? null,
        bodyText: document.body.innerText,
      };
    });
    throw new Error([
      'Transition preview never became playable.',
      `Summary: ${JSON.stringify(summary)}`,
      `Preview proxy requests: ${JSON.stringify(previewProxyRequests)}`,
      `Failed blob requests: ${JSON.stringify(failedBlobRequests)}`,
      'Browser console:',
      ...browserConsoleMessages,
    ].join('\n'));
  }

  expect(transitionPlayable, browserConsoleMessages.join('\n')).toBe(true);
  expect(previewProxyRequests, browserConsoleMessages.join('\n')).toEqual([]);
  expect(failedBlobRequests, browserConsoleMessages.join('\n')).toEqual([]);
  expect(
    browserConsoleMessages.filter((message) => message.includes('Video autoplay was rejected')),
    browserConsoleMessages.join('\n'),
  ).toEqual([]);

  const frontendSummary = await page.evaluate(() => {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    const rect = video?.getBoundingClientRect();
    return {
      hasVideo: !!video,
      currentSrc: video?.currentSrc ?? null,
      readyState: video?.readyState ?? null,
      paused: video?.paused ?? null,
      currentTime: video?.currentTime ?? null,
      clientWidth: video?.clientWidth ?? null,
      clientHeight: video?.clientHeight ?? null,
      rect: rect ? {
        width: rect.width,
        height: rect.height,
      } : null,
      bodyText: document.body.innerText,
    };
  });
  expect(frontendSummary.clientHeight, JSON.stringify(frontendSummary, null, 2)).toBeGreaterThan(0);
  expect(frontendSummary.rect?.height ?? 0, JSON.stringify(frontendSummary, null, 2)).toBeGreaterThan(0);
  expect(frontendSummary.currentTime ?? 1, JSON.stringify(frontendSummary, null, 2)).toBeLessThan(0.35);

  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => {
    return await page.evaluate(() => !document.querySelector('video'));
  }, { timeout: 300 }).toBe(true);
  await expect(page.getByText('Still slide 3')).toBeVisible();

  const mediaTrace = await page.evaluate(() => {
    return (window as Window & { __ANNOTATE_MEDIA_TRACE__?: unknown[] }).__ANNOTATE_MEDIA_TRACE__ ?? [];
  });
  const mediaTracePath = testInfo.outputPath('media-trace.json');
  await fs.writeFile(mediaTracePath, JSON.stringify(mediaTrace, null, 2), 'utf8');
  console.log(`MEDIA_TRACE_FILE ${mediaTracePath}`);
});
