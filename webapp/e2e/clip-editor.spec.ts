import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
const CLIP_ID = 'clip-playwright-1';

type TrackRequest = {
  videoRef?: string;
  videoPath?: string;
  startMs: number;
  endMs: number;
  seedBbox: { x: number; y: number; w: number; h: number };
  seedFrameMs: number;
  fps?: number;
};

function buildMockTrackedKeyframes(body: TrackRequest) {
  const stepMs = 150;
  const timestamps: number[] = [];
  for (let tMs = body.startMs; tMs < body.endMs; tMs += stepMs) {
    timestamps.push(tMs);
  }
  if (timestamps[timestamps.length - 1] !== body.endMs) {
    timestamps.push(body.endMs);
  }
  const lastIndex = Math.max(1, timestamps.length - 1);

  return timestamps.map((tMs, index) => {
    const ratio = index / lastIndex;
    return {
      tMs,
      x: Math.round(body.seedBbox.x + 24 * ratio),
      y: Math.round(body.seedBbox.y + 18 * ratio),
      w: body.seedBbox.w,
      h: body.seedBbox.h,
      visible: true,
    };
  });
}

async function installMockSidecar(page: Page): Promise<TrackRequest[]> {
  const trackRequests: TrackRequest[] = [];

  await page.route(`${SIDECAR_BASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          capabilities: ['tracking'],
          models: {
            yolo: true,
            mobilesam: false,
            narya: false,
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

    if (url.pathname === '/track') {
      const body = request.postDataJSON() as TrackRequest;
      trackRequests.push(body);
      const keyframes = buildMockTrackedKeyframes(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          keyframes,
          trackId: 7,
          detectionCount: keyframes.length,
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

  return trackRequests;
}

async function readClipFromFixture(page: Page) {
  return await page.evaluate(async (clipId) => {
    const dir = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    const clipsDir = await dir.getDirectoryHandle('clips', { create: false });
    const handle = await clipsDir.getFileHandle(`clip-${clipId}.json`, { create: false });
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  }, CLIP_ID);
}

function summarizePrimaryAnnotation(clip: any) {
  const annotation = clip.annotations?.[0] ?? null;
  return {
    annotationCount: clip.annotations?.length ?? 0,
    source: annotation?.source ?? null,
    keyframes: (annotation?.keyframes ?? []).map((keyframe: any) => ({
      tMs: keyframe.tMs,
      provenance: keyframe.provenance ?? null,
    })),
  };
}

test('clip editor supports major authoring flows end to end', async ({ page }) => {
  const fixturePath = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project.matchproj');
  const trackRequests = await installMockSidecar(page);
  await installDirectoryPickerFixture(page, fixturePath);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`/clip/${CLIP_ID}`);
  await page.getByRole('button', { name: 'Open Project Folder' }).click();
  await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  await expect(page.getByText(/Clip:\s+0:00\s+–\s+0:01/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Track' })).toBeVisible();
  await expect(page.getByText('No annotation selected. Pause playback and use Select mode to inspect or edit an annotation.')).toBeVisible();
  await expect(page.getByText('Before clip')).toHaveCount(0);
  await expect(page.getByText('After clip')).toHaveCount(0);
  await expect(page.getByText('1 available for import')).toBeVisible();

  const stageSurface = page.locator('[data-testid="clip-stage"] canvas').last();
  await expect(stageSurface).toBeVisible();
  const createX = 200;
  const createY = 150;

  await page.getByRole('button', { name: 'Box' }).click();
  await stageSurface.click({ position: { x: createX, y: createY } });

  await expect(page.getByText(/^source: manual$/)).toBeVisible();
  await expect(page.getByText(/^1 keyframe$/)).toBeVisible();

  await page.getByRole('button', { name: 'Select' }).click();
  const stageBox = await stageSurface.boundingBox();
  if (!stageBox) throw new Error('Clip stage bounds unavailable');
  await page.mouse.move(stageBox.x + createX, stageBox.y + createY);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + createX + 25, stageBox.y + createY + 20);
  await page.mouse.up();

  await page.getByRole('button', { name: '+250' }).click();
  await page.getByRole('button', { name: 'KF Here' }).click();
  await expect(page.getByText(/^2 keyframes$/)).toBeVisible();
  await page.getByRole('button', { name: 'Delete KF' }).click();
  await expect(page.getByText(/^1 keyframe$/)).toBeVisible();
  await page.keyboard.press('Meta+z');
  await expect(page.getByText(/^2 keyframes$/)).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(page.getByText(/^1 keyframe$/)).toBeVisible();
  await page.keyboard.press('Meta+z');
  await expect(page.getByText(/^2 keyframes$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return summarizePrimaryAnnotation(clip);
  }).toEqual({
    annotationCount: 1,
    source: 'manual',
    keyframes: [
      { tMs: 0, provenance: 'manual' },
      { tMs: 250, provenance: 'manual' },
    ],
  });

  await page.getByRole('button', { name: 'Track' }).click();
  await expect(page.getByText(/^source: auto$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return summarizePrimaryAnnotation(clip);
  }).toEqual({
    annotationCount: 1,
    source: 'auto',
    keyframes: [
      { tMs: 0, provenance: 'tracked' },
      { tMs: 150, provenance: 'tracked' },
      { tMs: 300, provenance: 'tracked' },
      { tMs: 450, provenance: 'tracked' },
      { tMs: 600, provenance: 'tracked' },
      { tMs: 750, provenance: 'tracked' },
      { tMs: 900, provenance: 'tracked' },
      { tMs: 1050, provenance: 'tracked' },
      { tMs: 1200, provenance: 'tracked' },
    ],
  });

  await page.getByRole('button', { name: '+250' }).click();
  await page.getByRole('button', { name: 'Re-track →' }).click();
  await expect(page.getByText(/^source: corrected$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return summarizePrimaryAnnotation(clip);
  }).toEqual({
    annotationCount: 1,
    source: 'corrected',
    keyframes: [
      { tMs: 0, provenance: 'tracked' },
      { tMs: 150, provenance: 'tracked' },
      { tMs: 300, provenance: 'tracked' },
      { tMs: 450, provenance: 'tracked' },
      { tMs: 500, provenance: 'tracked' },
      { tMs: 650, provenance: 'tracked' },
      { tMs: 800, provenance: 'tracked' },
      { tMs: 950, provenance: 'tracked' },
      { tMs: 1100, provenance: 'tracked' },
      { tMs: 1200, provenance: 'tracked' },
    ],
  });

  await page.getByRole('button', { name: 'Mark Range End' }).click();
  await expect(page.getByRole('button', { name: 'Clear Range' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-track range' })).toBeDisabled();
  await page.getByRole('button', { name: '+250' }).click();
  await expect(page.getByRole('button', { name: 'Re-track range' })).toBeEnabled();
  await page.getByRole('button', { name: 'Re-track range' }).click();
  await expect(page.getByText(/^source: corrected$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return summarizePrimaryAnnotation(clip);
  }).toEqual({
    annotationCount: 1,
    source: 'corrected',
    keyframes: [
      { tMs: 0, provenance: 'tracked' },
      { tMs: 150, provenance: 'tracked' },
      { tMs: 300, provenance: 'tracked' },
      { tMs: 450, provenance: 'tracked' },
      { tMs: 500, provenance: 'tracked' },
      { tMs: 650, provenance: 'tracked' },
      { tMs: 750, provenance: 'tracked' },
      { tMs: 800, provenance: 'tracked' },
      { tMs: 950, provenance: 'tracked' },
      { tMs: 1100, provenance: 'tracked' },
      { tMs: 1200, provenance: 'tracked' },
    ],
  });

  await page.getByRole('button', { name: '+250' }).click();
  await page.getByRole('button', { name: 'KF Here' }).click();
  await expect(page.getByText(/^Current frame is a correction point$/).first()).toBeVisible();
  await expect(page.getByText(/1 correction point/)).toBeVisible();
  await page.getByRole('button', { name: '-250' }).click();
  await expect(page.getByRole('button', { name: 'To Next Correction' })).toBeVisible();
  await page.getByRole('button', { name: 'To Next Correction' }).click();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return summarizePrimaryAnnotation(clip);
  }).toEqual({
    annotationCount: 1,
    source: 'corrected',
    keyframes: [
      { tMs: 0, provenance: 'tracked' },
      { tMs: 150, provenance: 'tracked' },
      { tMs: 300, provenance: 'tracked' },
      { tMs: 450, provenance: 'tracked' },
      { tMs: 500, provenance: 'tracked' },
      { tMs: 650, provenance: 'tracked' },
      { tMs: 750, provenance: 'tracked' },
      { tMs: 900, provenance: 'tracked' },
      { tMs: 1000, provenance: 'correction' },
      { tMs: 1100, provenance: 'tracked' },
      { tMs: 1200, provenance: 'tracked' },
    ],
  });

  expect(trackRequests).toHaveLength(4);
  expect(trackRequests[0]).toMatchObject({
    videoRef: 'video-ref-playwright',
    startMs: 200,
    endMs: 1400,
    seedFrameMs: 450,
  });
  expect(trackRequests[1]).toMatchObject({
    videoRef: 'video-ref-playwright',
    startMs: 700,
    endMs: 1400,
    seedFrameMs: 700,
  });
  expect(trackRequests[2]).toMatchObject({
    videoRef: 'video-ref-playwright',
    startMs: 700,
    endMs: 950,
    seedFrameMs: 950,
  });
  expect(trackRequests[3]).toMatchObject({
    videoRef: 'video-ref-playwright',
    startMs: 950,
    endMs: 1200,
    seedFrameMs: 950,
  });

  await page.getByRole('button', { name: /^Import 0:00:/ }).click();
  await expect(page.getByText(/Imported 1 annotations from still-playwright-1/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return clip.annotations.length;
  }).toBe(2);

  await page.keyboard.press('Delete');
  await expect(page.getByText('No annotation selected. Pause playback and use Select mode to inspect or edit an annotation.')).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return {
      annotationCount: clip.annotations.length,
      source: clip.annotations[0]?.source ?? null,
    };
  }).toEqual({
    annotationCount: 1,
    source: 'corrected',
  });

  await page.getByRole('button', { name: 'Box' }).click();
  await stageSurface.click({ position: { x: 360, y: 240 } });
  await page.getByRole('button', { name: 'Select' }).click();
  await page.mouse.move(stageBox.x + 140, stageBox.y + 110);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 430, stageBox.y + 320);
  await page.mouse.up();
  await expect(page.getByText(/^2 annotations selected$/)).toBeVisible();
});
