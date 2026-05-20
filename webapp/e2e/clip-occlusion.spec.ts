import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
const CLIP_ID = 'clip-playwright-1';
const MASK_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGP4DwUMMAYAj4IP8TylVlEAAAAASUVORK5CYII=';

async function installMockSegmentationSidecar(page: Page): Promise<{ getSegmentCallCount: () => number }> {
  let segmentCallCount = 0;

  await page.route(`${SIDECAR_BASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          capabilities: ['segmentation'],
          models: {
            yolo: true,
            supervision: false,
            mobilesam: true,
            ellipse: false,
            pnlcalib: false,
            opencv: true,
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

    if (url.pathname === '/segment') {
      segmentCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mask: MASK_DATA_URI,
          width: 640,
          height: 360,
          personCount: 1,
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

  return {
    getSegmentCallCount: () => segmentCallCount,
  };
}

test('occlusion behaves as a paused-frame workflow in the clip editor', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  const mockSidecar = await installMockSegmentationSidecar(page);

  await page.goto(`/clip/${CLIP_ID}`);
  await page.getByRole('button', { name: 'Open Project Folder' }).click();

  await expect(page.getByRole('button', { name: 'Occ' })).toBeVisible();
  await page.getByRole('button', { name: 'Occ' }).click();

  await expect(page.getByText('Foreground mask ready')).toBeVisible();
  expect(mockSidecar.getSegmentCallCount()).toBe(1);

  await page.keyboard.press('Space');
  await expect(page.getByText('Paused-frame only')).toBeVisible();
  await page.waitForTimeout(400);
  expect(mockSidecar.getSegmentCallCount()).toBe(1);

  await page.keyboard.press('Space');
  await expect(page.getByText('Foreground mask ready')).toBeVisible();
  expect(mockSidecar.getSegmentCallCount()).toBeGreaterThanOrEqual(2);
});
