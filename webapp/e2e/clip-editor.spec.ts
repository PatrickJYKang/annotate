import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
const CLIP_ID = 'clip-sequence';

type TrackRequest = {
  videoRef?: string;
  videoPath?: string;
  startMs: number;
  endMs: number;
  seedFrameMs: number;
  fps?: number;
  seedBbox: { x: number; y: number; w: number; h: number };
  stopOnLoss?: boolean;
};

type DetectionRequest = {
  videoRef?: string;
  videoPath?: string;
  frameMs: number;
};

type HomographyRequest = {
  videoRef?: string;
  videoPath?: string;
  startMs: number;
  endMs: number;
  fps?: number;
  skipInterval?: number;
};

async function installMockSidecar(page: Page) {
  const trackRequests: TrackRequest[] = [];
  const detectionRequests: DetectionRequest[] = [];
  const homographyRequests: HomographyRequest[] = [];

  // Route.fulfill buffers its body. Re-stream tracking events in separate tasks so
  // React gets the same incremental updates it receives from the real sidecar.
  await page.context().addInitScript(({ sidecarBaseUrl }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      if (url.href !== `${sidecarBaseUrl}/track/stream`) {
        return nativeFetch(input, init);
      }

      const buffered = await nativeFetch(input, init);
      if (!buffered.ok) return buffered;
      const lines = (await buffered.text()).split('\n').filter(Boolean);
      const encoder = new TextEncoder();
      const signal = init?.signal;
      const headers = new Headers(buffered.headers);
      headers.set('Content-Type', 'application/x-ndjson');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let index = 0;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const cleanUp = () => {
            if (timer != null) clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
          };
          const abort = () => {
            cleanUp();
            controller.error(new DOMException('Tracking request aborted.', 'AbortError'));
          };
          const emit = () => {
            if (signal?.aborted) {
              abort();
              return;
            }
            if (index >= lines.length) {
              cleanUp();
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(`${lines[index]}\n`));
            index += 1;
            timer = setTimeout(emit, 20);
          };
          signal?.addEventListener('abort', abort, { once: true });
          emit();
        },
      });
      return new Response(stream, {
        status: buffered.status,
        statusText: buffered.statusText,
        headers,
      });
    };
  }, { sidecarBaseUrl: SIDECAR_BASE_URL });

  await page.context().route(`${SIDECAR_BASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          capabilities: ['tracking', 'homography'],
          models: {
            yolo: true,
            supervision: true,
            mobilesam: false,
            ellipse: true,
            pnlcalib: true,
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
          videoRef: 'video-ref',
          filename: 'retrieval-sample.mp4',
          sizeBytes: 2048,
        }),
      });
      return;
    }
    if (url.pathname === '/track/detect') {
      const body = request.postDataJSON() as DetectionRequest;
      detectionRequests.push(body);
      const frame = Math.round(body.frameMs / 40);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frameMs: body.frameMs,
          detections: [
            { x: 150 + frame * 2, y: 160, w: 44, h: 100, confidence: 0.94 },
            { x: 430 - frame, y: 170, w: 42, h: 96, confidence: 0.88 },
          ],
        }),
      });
      return;
    }
    if (url.pathname === '/track' || url.pathname === '/track/stream') {
      const body = request.postDataJSON() as TrackRequest;
      trackRequests.push(body);
      const firstRun = trackRequests.length === 1;
      const timestamps = firstRun
        ? [body.startMs, body.startMs + 40]
        : Array.from(
            { length: Math.floor((body.endMs - body.startMs) / 40) + 1 },
            (_, index) => body.startMs + index * 40,
          );
      const result = {
        keyframes: timestamps.map((tMs, index) => ({
            tMs,
            x: body.seedBbox.x + index * 4,
            y: body.seedBbox.y + index * 2,
            w: body.seedBbox.w,
            h: body.seedBbox.h,
            visible: true,
        })),
        trackId: 4,
        detectionCount: timestamps.length,
        completed: !firstRun,
        stoppedAtMs: firstRun ? body.startMs + 80 : null,
      };
      await route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith('/stream') ? 'application/x-ndjson' : 'application/json',
        body: url.pathname.endsWith('/stream')
          ? [
              ...result.keyframes.map((keyframe) => JSON.stringify({ type: 'keyframe', keyframe })),
              JSON.stringify({ type: 'result', result }),
            ].join('\n') + '\n'
          : JSON.stringify(result),
      });
      return;
    }
    if (url.pathname === '/homography') {
      const body = request.postDataJSON() as HomographyRequest;
      homographyRequests.push(body);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frames: [body.startMs, (body.startMs + body.endMs) / 2, body.endMs].map((tMs) => ({
            tMs,
            matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            method: 'mock',
          })),
        }),
      });
      return;
    }
    if (request.method() === 'DELETE' && url.pathname.startsWith('/video/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return { trackRequests, detectionRequests, homographyRequests };
}

async function readClip(page: Page) {
  return page.evaluate(async (clipId) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const project = await (window as Window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker();
        const clips = await project.getDirectoryHandle('analysis')
          .then((analysis) => analysis.getDirectoryHandle('clips'));
        const folder = await clips.getDirectoryHandle(clipId);
        const file = await folder.getFileHandle('clip.json').then((handle) => handle.getFile());
        return JSON.parse(await file.text());
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw lastError;
  }, CLIP_ID);
}

test('edits and tracks a non-zero-start clip on the absolute frame axis', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  const sidecar = await installMockSidecar(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await page.getByTestId(`clip-tree-row-${CLIP_ID}`).click();
  const editorPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  page = await editorPagePromise;
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await expect(page.getByText(/frames 5–44 · 25 fps/)).toBeVisible();
  await expect(page.getByText(/Frame 5 · clip 5–44/)).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo((5 + 0.5) / 25, 4);
  await expect.poll(() => page.locator('video').evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveCSS('width', '56px');

  const viewerBox = await page.getByTestId('clip-viewer-surface').boundingBox();
  const overlayBox = await page.getByTestId('clip-overlay-frame').boundingBox();
  if (!viewerBox || !overlayBox) throw new Error('Clip viewer did not have a layout box.');
  const containedScale = Math.min(viewerBox.width / 640, viewerBox.height / 360);
  expect(overlayBox.width).toBeCloseTo(640 * containedScale, 0);
  expect(overlayBox.height).toBeCloseTo(360 * containedScale, 0);
  expect(overlayBox.x + overlayBox.width / 2).toBeCloseTo(viewerBox.x + viewerBox.width / 2, 0);
  expect(overlayBox.y + overlayBox.height / 2).toBeCloseTo(viewerBox.y + viewerBox.height / 2, 0);

  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Player 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Player 1' }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/Frame 8 · clip 5–44/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText(/Frame 5 · clip 5–44/)).toBeVisible();
  await expect.poll(async () => {
    const clip = await readClip(page);
    const annotation = clip.annotations.at(-1);
    return {
      frames: annotation.keyframes.map((keyframe: { frame: number }) => keyframe.frame),
      radius: annotation.keyframes[0].radius,
    };
  }).toEqual({ frames: [5], radius: 32 });
  await page.keyboard.press('Shift+Backspace');

  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Player 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Player 1' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('Tracked 2 source frames.')).toBeVisible();
  await expect(page.getByText(/Frame 7 · clip 5–44/)).toBeVisible();
  await expect.poll(async () => {
    const annotation = (await readClip(page)).annotations.at(-1);
    return annotation.keyframes.map((keyframe: { frame: number; visible?: boolean }) => ({
      frame: keyframe.frame,
      visible: keyframe.visible,
    }));
  }).toEqual([
    { frame: 5, visible: undefined },
    { frame: 6, visible: undefined },
    { frame: 7, visible: false },
  ]);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => sidecar.detectionRequests.at(-1)?.frameMs).toBe(400);
  await page.getByRole('button', { name: 'Player 1' }).click();
  await expect.poll(() => sidecar.trackRequests.length).toBe(1);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => sidecar.trackRequests.length).toBe(2);
  await expect(page.getByText(/Frame 44 · clip 5–44/)).toBeVisible();
  await expect.poll(async () => {
    const clip = await readClip(page);
    const annotation = clip.annotations.at(-1);
    return {
      type: annotation.type,
      frames: annotation.keyframes.map((keyframe: { frame: number }) => keyframe.frame),
      hidden: annotation.keyframes.filter((keyframe: { visible?: boolean }) => keyframe.visible === false).length,
    };
  }).toEqual({
    type: 'highlight',
    frames: Array.from({ length: 40 }, (_, index) => index + 5),
    hidden: 0,
  });

  await page.getByLabel('Name', { exact: true }).fill('Left winger');
  await page.getByLabel('Name', { exact: true }).blur();
  await expect(page.getByRole('button', { name: '3. Left winger', exact: true })).toBeVisible();
  await expect.poll(async () => (await readClip(page)).annotations.at(-1).name).toBe('Left winger');

  expect(sidecar.trackRequests).toHaveLength(2);
  expect(sidecar.trackRequests[0]).toMatchObject({
    videoRef: 'video-ref',
    startMs: 200,
    endMs: 1760,
    seedFrameMs: 200,
    fps: 25,
    stopOnLoss: true,
  });
  expect(sidecar.trackRequests[0].videoPath).toBeUndefined();
  expect(sidecar.trackRequests[1]).toMatchObject({
    startMs: 400,
    endMs: 1760,
    seedFrameMs: 400,
    fps: 25,
    stopOnLoss: true,
  });
  await page.getByRole('button', { name: 'Skip back', exact: true }).click();
  await expect(page.getByText(/Frame 5 · clip 5–44/)).toBeVisible();

  const stage = page.getByTestId('clip-stage');
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error('Clip stage did not have a layout box.');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByRole('button', { name: 'Circle' }).click();
  await page.mouse.move(stageBox.x + stageBox.width * 0.2, stageBox.y + stageBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.3, stageBox.y + stageBox.height * 0.45, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const annotation = (await readClip(page)).annotations.at(-1);
    return { type: annotation.type, coordMode: annotation.coordMode, rx: annotation.keyframes[0].rx };
  }).toMatchObject({ type: 'circle', coordMode: 'image' });
  expect((await readClip(page)).annotations.at(-1).keyframes[0].rx).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await page.keyboard.press('Shift+Backspace');

  await page.getByRole('button', { name: 'Compute H' }).click();
  await expect(page.getByRole('progressbar', { name: 'Computing homography' })).toBeVisible();
  await expect(page.getByText('Loaded 3 homography samples.')).toBeVisible();
  expect(sidecar.homographyRequests).toHaveLength(1);
  expect(sidecar.homographyRequests[0]).toMatchObject({
    videoRef: 'video-ref',
    startMs: 200,
    endMs: 1760,
    fps: 5,
    skipInterval: 4,
  });
  expect(sidecar.homographyRequests[0].videoPath).toBeUndefined();

  await page.getByRole('button', { name: 'Box' }).click();
  await expect(page.getByRole('button', { name: 'Draw: Pitch' })).toBeVisible();
  await page.mouse.move(stageBox.x + stageBox.width * 0.35, stageBox.y + stageBox.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.55, stageBox.y + stageBox.height * 0.58, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText(/pitch coords/)).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'KF Here' }).click();

  await expect.poll(async () => {
    const stored = await readClip(page);
    const annotation = stored.annotations[stored.annotations.length - 1];
    return {
      type: annotation.type,
      coordMode: annotation.coordMode,
      frames: annotation.keyframes.map((keyframe: { frame: number }) => keyframe.frame),
      width: annotation.keyframes[0].w,
      height: annotation.keyframes[0].h,
    };
  }).toMatchObject({ type: 'box', coordMode: 'pitch', frames: [5, 6] });
  const drawnBox = (await readClip(page)).annotations.at(-1).keyframes[0];
  expect(drawnBox.w).toBeGreaterThan(0);
  expect(drawnBox.h).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Delete KF' }).click();
  await expect.poll(async () => {
    const stored = await readClip(page);
    return stored.annotations[stored.annotations.length - 1].keyframes.map((keyframe: { frame: number }) => keyframe.frame);
  }).toEqual([5]);

  await page.keyboard.press('Meta+z');
  await expect.poll(async () => {
    const stored = await readClip(page);
    return stored.annotations[stored.annotations.length - 1].keyframes.map((keyframe: { frame: number }) => keyframe.frame);
  }).toEqual([5, 6]);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => {
    const stored = await readClip(page);
    return stored.annotations[stored.annotations.length - 1].keyframes.map((keyframe: { frame: number }) => keyframe.frame);
  }).toEqual([5]);
  await page.keyboard.press('Meta+z');

  await expect(page.getByRole('button', { name: 'Show KF' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hide KF' })).toHaveCount(0);

  const timelineLaneBox = await page.getByTestId('clip-timeline-lane').boundingBox();
  if (!timelineLaneBox) throw new Error('Timeline lane did not have a layout box.');
  const seekFrame = 24;
  const seekX = timelineLaneBox.x + ((seekFrame - 5) / (44 - 5)) * timelineLaneBox.width;
  await page.mouse.click(seekX, timelineLaneBox.y + 14);
  await expect(page.getByText(/Frame 24 · clip 5–44/)).toBeVisible();

  const scrubStartFrame = 12;
  const scrubEndFrame = 32;
  const scrubStartX = timelineLaneBox.x + ((scrubStartFrame - 5) / (44 - 5)) * timelineLaneBox.width;
  const scrubEndX = timelineLaneBox.x + ((scrubEndFrame - 5) / (44 - 5)) * timelineLaneBox.width;
  await page.mouse.move(scrubStartX, timelineLaneBox.y + 14);
  await page.mouse.down();
  await page.mouse.move(scrubEndX, timelineLaneBox.y + 14, { steps: 8 });
  await expect(page.getByText(/Frame 32 · clip 5–44/)).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText(/Frame 32 · clip 5–44/)).toBeVisible();

  const selectedAnnotationId = (await readClip(page)).annotations.at(-1).id as string;
  const pinnedAccentBox = await page.getByTestId(`clip-timeline-accent-${selectedAnnotationId}`).boundingBox();
  if (!pinnedAccentBox) throw new Error('Pinned timeline accent did not have a layout box.');
  expect(pinnedAccentBox.x + pinnedAccentBox.width).toBeLessThanOrEqual(timelineLaneBox.x);

  const frameSixKeyframe = page.getByRole('button', { name: 'box keyframe at frame 6' });
  const keyframeBox = await frameSixKeyframe.boundingBox();
  if (!keyframeBox) throw new Error('Frame-six keyframe did not have a layout box.');
  const frameTenX = timelineLaneBox.x + ((10 - 5) / (44 - 5)) * timelineLaneBox.width;
  await page.mouse.move(keyframeBox.x + keyframeBox.width / 2, keyframeBox.y + keyframeBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(frameTenX, keyframeBox.y + keyframeBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => {
    const stored = await readClip(page);
    const annotation = stored.annotations[stored.annotations.length - 1];
    return annotation.keyframes.map((keyframe: { frame: number }) => keyframe.frame);
  }).toEqual([5, 10]);

  for (const control of ['Skip back', 'Step back', 'Play', 'Step forward', 'Skip forward']) {
    await expect(page.getByRole('button', { name: control, exact: true })).toBeVisible();
  }

  const timelineScroller = page.getByTestId('clip-timeline-scroller');
  const laneWidthBeforeZoom = (await page.getByTestId('clip-timeline-lane').boundingBox())?.width ?? 0;
  const scrollerBox = await timelineScroller.boundingBox();
  if (!scrollerBox) throw new Error('Timeline scroller did not have a layout box.');
  for (let index = 0; index < 36; index += 1) {
    await timelineScroller.dispatchEvent('wheel', {
      ctrlKey: true,
      deltaY: -12,
      clientX: scrollerBox.x + scrollerBox.width / 2,
      clientY: scrollerBox.y + 10,
    });
  }
  await expect.poll(async () => (await page.getByTestId('clip-timeline-lane').boundingBox())?.width ?? 0)
    .toBeGreaterThan(laneWidthBeforeZoom);

  const showHomography = page.getByTestId('clip-toggle-homography');
  await showHomography.click();
  await expect(page.getByTestId('clip-toggle-homography')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('clip-delete-homography').click();
  await expect(page.getByText('Homography deleted.')).toBeVisible();
  await expect(showHomography).toBeDisabled();

  await page.getByRole('button', { name: 'Skip back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete object (Shift+Delete)' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((element) => (element as HTMLVideoElement).paused)).toBe(false);
  await stage.click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('button', { name: 'Delete object (Shift+Delete)' })).toHaveCount(0);
});
