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
      const duration = Math.max(0, body.endMs - body.startMs);
      const midMs = body.startMs + Math.round(duration / 2);
      const keyframes = [
        {
          tMs: body.startMs,
          x: body.seedBbox.x,
          y: body.seedBbox.y,
          w: body.seedBbox.w,
          h: body.seedBbox.h,
          visible: true,
        },
        {
          tMs: midMs,
          x: body.seedBbox.x + 18,
          y: body.seedBbox.y + 12,
          w: body.seedBbox.w,
          h: body.seedBbox.h,
          visible: true,
        },
        {
          tMs: body.endMs,
          x: body.seedBbox.x + 24,
          y: body.seedBbox.y + 18,
          w: body.seedBbox.w,
          h: body.seedBbox.h,
          visible: true,
        },
      ];
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
    return {
      annotationCount: clip.annotations.length,
      source: clip.annotations[0]?.source ?? null,
      keyframeCount: clip.annotations[0]?.keyframes?.length ?? 0,
    };
  }).toEqual({
    annotationCount: 1,
    source: 'manual',
    keyframeCount: 2,
  });
  const manuallyEditedClip = await readClipFromFixture(page);
  expect(manuallyEditedClip.annotations[0]?.keyframes?.[0]?.x ?? 0).toBeGreaterThan(createX - 40);
  expect(manuallyEditedClip.annotations[0]?.keyframes?.[0]?.y ?? 0).toBeGreaterThan(createY - 24);

  await page.getByRole('button', { name: 'Track' }).click();
  await expect(page.getByText(/^source: auto$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return {
      source: clip.annotations[0]?.source ?? null,
      keyframeCount: clip.annotations[0]?.keyframes?.length ?? 0,
    };
  }).toEqual({
    source: 'auto',
    keyframeCount: 3,
  });

  await page.getByRole('button', { name: '+250' }).click();
  await page.getByRole('button', { name: 'Re-track →' }).click();
  await expect(page.getByText(/^source: corrected$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return {
      source: clip.annotations[0]?.source ?? null,
      keyframeCount: clip.annotations[0]?.keyframes?.length ?? 0,
    };
  }).toEqual({
    source: 'corrected',
    keyframeCount: 3,
  });

  await page.getByRole('button', { name: '+250' }).click();
  const timelineBox = await page.locator('[data-testid="clip-timeline"]').boundingBox();
  if (!timelineBox) throw new Error('Timeline bounds unavailable');
  await page.locator('[data-testid="clip-timeline"]').click({
    modifiers: ['Shift'],
    position: {
      x: Math.round((250 / 1200) * timelineBox.width),
      y: 10,
    },
  });

  await expect(page.getByRole('button', { name: 'Re-track range' })).toBeVisible();
  await page.getByRole('button', { name: 'Re-track range' }).click();
  await expect(page.getByText(/^source: corrected$/)).toBeVisible();

  await expect.poll(async () => {
    const clip = await readClipFromFixture(page);
    return {
      source: clip.annotations[0]?.source ?? null,
      keyframeCount: clip.annotations[0]?.keyframes?.length ?? 0,
    };
  }).toEqual({
    source: 'corrected',
    keyframeCount: 3,
  });

  expect(trackRequests).toHaveLength(3);
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
    startMs: 450,
    endMs: 950,
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
