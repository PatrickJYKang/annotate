import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
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

async function readHomographyCache(page: Page) {
  return await page.evaluate(async () => {
    const dir = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    const cacheDir = await dir.getDirectoryHandle('homography-cache', { create: false });
    const handle = await cacheDir.getFileHandle('range-200-1400.json', { create: false });
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  });
}

async function installMockHomographySidecar(page: Page): Promise<void> {
  await page.route(`${SIDECAR_BASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          capabilities: ['homography'],
          models: {
            yolo: false,
            supervision: false,
            mobilesam: false,
            ellipse: true,
            pnlcalib: true,
            opencv: true,
          },
          homography: {
            providerName: 'playwright-mock',
            providers: [
              {
                name: 'playwright-mock',
                supports_manual_seed_tracking: false,
                available: true,
              },
            ],
          },
        }),
      });
      return;
    }

    if (url.pathname === '/video/register') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          videoRef: 'video-ref-playwright',
          filename: 'retrieval-sample.mp4',
          sizeBytes: 123456,
        }),
      });
      return;
    }

    if (url.pathname === '/homography') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frames: [
            { tMs: 200, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], method: 'mock' },
            { tMs: 800, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], method: 'mock' },
            { tMs: 1400, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], method: 'mock' },
          ],
        }),
      });
      return;
    }

    if (request.method() === 'DELETE' && url.pathname.startsWith('/video/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
}

test('clip editor supports cached homography and pitch-space authoring', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project.matchproj'),
  );
  await installMockHomographySidecar(page);

  await page.goto(`/clip/${CLIP_ID}`);
  await page.getByRole('button', { name: 'Open Project Folder' }).click();

  const computeHomographyButton = page.getByRole('button', { name: 'Compute H' });
  await expect(computeHomographyButton).toBeVisible();
  await expect(computeHomographyButton).toBeEnabled();
  await computeHomographyButton.click();
  await expect(page.getByRole('button', { name: 'Recompute H' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw: Image' })).toBeVisible();

  await page.getByRole('button', { name: 'Box' }).click();
  await page.getByRole('button', { name: 'Draw: Image' }).click();
  await expect(page.getByRole('button', { name: 'Draw: Pitch' })).toBeVisible();

  const stageSurface = page.locator('[data-testid="clip-stage"] canvas').last();
  await expect(stageSurface).toBeVisible();
  await stageSurface.click({ position: { x: 260, y: 180 } });

  await expect(page.getByText(/^pitch coords$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return clip.annotations[0] ?? null;
  }).toMatchObject({
    type: 'box',
    coordMode: 'pitch',
    source: 'manual',
  });

  const cache = await readHomographyCache(page);
  expect(cache.frames).toHaveLength(3);
  expect(cache.frames[0]).toMatchObject({
    tMs: 200,
    method: 'mock',
  });

  await page.getByRole('button', { name: '+250' }).click();
  await expect(page.getByRole('button', { name: 'Recompute H' })).toBeVisible();
});
