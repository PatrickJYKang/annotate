import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

type ExactRequest = { videoRef?: string; startMs: number; endMs: number };

async function installExactSidecar(page: Page, sourceVideoPath: string) {
  const requests: ExactRequest[] = [];
  const video = await readFile(sourceVideoPath);
  await page.route(`${SIDECAR_BASE_URL}/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/video/register') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ videoRef: 'presentation-video-ref', filename: 'retrieval-sample.mp4', sizeBytes: video.byteLength }),
      });
      return;
    }
    if (pathname === '/derived-media/exact-motion') {
      requests.push(request.postDataJSON() as ExactRequest);
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: video });
      return;
    }
    if (request.method() === 'DELETE' && pathname.startsWith('/video/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (pathname === '/health') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', capabilities: ['export'] }) });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
  return requests;
}

async function openPresentation(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  const card = page.locator('[data-testid^="presentation-card-"]').filter({ hasText: name });
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('presentation-editor')).toBeVisible();
}

async function readProjectJson(page: Page, segments: string[]) {
  return page.evaluate(async (pathSegments) => {
    let directory = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    for (const segment of pathSegments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const file = await directory.getFileHandle(pathSegments.at(-1)!).then((handle) => handle.getFile());
    return JSON.parse(await file.text());
  }, segments);
}

test('v2 presentations author clips and pins and preserve exact frame playback contracts', async ({ page }) => {
  const fixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');
  await installOpfsDirectoryPickerFixture(page, fixture);
  const exactRequests = await installExactSidecar(page, path.join(fixture, 'media/retrieval-sample.mp4'));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openPresentation(page, 'Breaking the press');

  const clipAsset = page.getByTestId('presentation-asset-clip-sequence');
  await expect(clipAsset).toBeVisible();
  await page.getByLabel('Expand pins for Press broken through midfield').click();
  const shapePinAsset = page.getByTestId('presentation-pin-asset-pin-shape');
  await expect(shapePinAsset).toBeVisible();

  await shapePinAsset.dragTo(page.getByTestId('presentation-slide-slide-pin'));
  await expect(page.getByTestId('presentation-deck').locator('[data-testid^="presentation-slide-"]')).toHaveCount(4);
  await page.getByLabel('Transition after slide').selectOption('match_video');
  await expect.poll(() => exactRequests.length).toBe(1);
  expect(exactRequests[0]).toEqual({ videoRef: 'presentation-video-ref', startMs: 600, endMs: 1280 });

  await expect.poll(async () => {
    const stored = await readProjectJson(page, ['presentations', 'presentation-sequence.json']);
    return {
      kinds: stored.slides.map((slide: { kind: string }) => slide.kind),
      transition: stored.transitions[2],
    };
  }).toMatchObject({
    kinds: ['title', 'clip', 'pin', 'pin'],
    transition: { mode: 'match_video', hideAnnotationsDuringPlayback: true },
  });

  await page.getByTestId('presentation-slide-slide-clip').click();
  const frameSlider = page.getByLabel('Presentation source frame');
  await expect(frameSlider).toBeVisible();
  await frameSlider.fill('8');
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '8');
  await expect.poll(async () => page.getByTestId('presentation-animated-overlay').evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d');
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    let nonTransparent = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) nonTransparent += 1;
    return nonTransparent;
  })).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Play preview' }).click();
  const resumeShape = page.getByRole('button', { name: /Resume from Shape before pass/ });
  await expect(resumeShape).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('presentation-pin-frame')).toBeVisible();
  await resumeShape.click();
  await expect(resumeShape).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByTestId('presentation-canvas').getAttribute('data-source-frame'))).toBeGreaterThan(15);

  await page.getByTestId('presentation-slide-slide-pin').click();
  await expect(page.getByTestId('presentation-pin-frame')).toBeVisible();

  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.getByTestId('presentation-present')).toBeVisible();
  await expect.poll(() => exactRequests.some((request) => request.startMs === 200 && request.endMs === 1800)).toBe(true);
  await page.getByTestId('presentation-present').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-canvas')).toHaveAttribute('data-playback-asset', 'exact_motion');

  await page.getByTestId('presentation-present').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-pin-frame')).toBeVisible();
  await page.getByTestId('presentation-present').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-canvas')).toHaveAttribute('data-playback-asset', 'exact_motion');
  await expect(page.getByTestId('presentation-present').getByText('Transition 3')).toBeVisible();

  const mediaIndex = await readProjectJson(page, ['derived-media', 'presentations', 'presentation-sequence', 'assets-v2.json']);
  expect(mediaIndex.assets).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'clip_slide', sourceStartFrame: 5, sourceEndFrame: 45 }),
    expect.objectContaining({ kind: 'transition', sourceStartFrame: 15, sourceEndFrame: 32 }),
  ]));
});

test('v2 presentation slides visibly degrade when their referenced clip is missing', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/broken-project'),
  );
  await openPresentation(page, 'Broken target');
  await expect(page.getByTestId('presentation-missing-reference')).toContainText('Missing clip: clip-missing');
});
