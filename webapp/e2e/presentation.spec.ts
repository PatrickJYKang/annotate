import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

async function rejectExactPlaybackPreparation(page: Page) {
  const requests: string[] = [];
  await page.route(`${SIDECAR_BASE_URL}/derived-media/exact-motion`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Presentation playback must use original media."}' });
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
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const file = await directory.getFileHandle(pathSegments.at(-1)!).then((handle) => handle.getFile());
        return JSON.parse(await file.text());
      } catch (error) {
        lastError = error;
        if (!(error instanceof DOMException) || error.name !== 'NotReadableError') throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
    }
    throw lastError;
  }, segments);
}

async function writeProjectJson(page: Page, segments: string[], value: unknown) {
  await page.evaluate(async ({ pathSegments, document }) => {
    let directory = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    for (const segment of pathSegments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    const file = await directory.getFileHandle(pathSegments.at(-1)!, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(document, null, 2));
    await writable.close();
  }, { pathSegments: segments, document: value });
}

test('v2 presentations author clips and pins and play source video frame ranges', async ({ page }) => {
  const fixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');
  await installOpfsDirectoryPickerFixture(page, fixture);
  const exactRequests = await rejectExactPlaybackPreparation(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openPresentation(page, 'Breaking the press');

  const authoringCanvasPanel = page.locator('#presentation-canvas-panel');
  await expect(authoringCanvasPanel.getByTestId('presentation-title-slide')).toHaveAttribute('data-title-template', 'section');
  await page.getByLabel('Template').selectOption('divider');
  await expect(authoringCanvasPanel.getByTestId('presentation-title-slide')).toHaveAttribute('data-title-template', 'divider');
  await expect(page.getByTestId('presentation-slide-thumbnail-slide-title')).toBeVisible();
  await expect(page.getByTestId('presentation-slide-thumbnail-slide-clip')).toHaveAttribute('data-thumbnail-loaded', 'true', { timeout: 15_000 });

  const clipAsset = page.getByTestId('presentation-asset-clip-sequence');
  await expect(clipAsset).toBeVisible();
  await page.getByLabel('Expand pins for Press broken through midfield').click();
  const shapePinAsset = page.getByTestId('presentation-pin-asset-pin-shape');
  await expect(shapePinAsset).toBeVisible();

  await shapePinAsset.click();
  await expect(page.getByTestId('presentation-source-inspector')).toContainText('Shape before pass');
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '15');
  await expect(page.getByTestId('presentation-deck').getByRole('button', { pressed: true })).toHaveCount(0);

  await shapePinAsset.dragTo(page.getByTestId('presentation-slide-slide-pin'));
  await expect(page.getByTestId('presentation-deck').locator(':scope > button')).toHaveCount(4);
  await page.getByLabel('Transition after slide').selectOption('match_video');
  expect(exactRequests).toEqual([]);

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
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '5');
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-playback-asset', 'original');
  const editClipPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Edit clip', exact: true }).click();
  const editClipPage = await editClipPagePromise;
  await expect(editClipPage).toHaveURL(/\/clip\/clip-sequence$/);
  await expect(editClipPage.getByTestId('clip-editor')).toBeVisible();
  await editClipPage.close();
  const shapePauseDetails = page.locator('details').filter({ hasText: 'Shape before pass' });
  await shapePauseDetails.locator('summary').click();
  const autoResume = shapePauseDetails.getByLabel('Auto-resume (seconds)');
  await expect(autoResume).toHaveValue('1.2');
  await autoResume.fill('');
  const timeline = page.getByTestId('presentation-timeline');
  await expect(timeline).toBeVisible();
  const lane = page.getByTestId('presentation-timeline-lane');
  const laneBox = await lane.boundingBox();
  expect(laneBox).not.toBeNull();
  const frameX = (frame: number) => laneBox!.x + ((frame - 5) / (44 - 5)) * laneBox!.width;
  await page.mouse.move(frameX(7), laneBox!.y + laneBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameX(8), laneBox!.y + laneBox!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '8');
  await expect.poll(async () => page.getByTestId('presentation-animated-overlay').evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d');
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    let nonTransparent = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) nonTransparent += 1;
    return nonTransparent;
  })).toBeGreaterThan(100);

  await timeline.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('presentation-pin-frame')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '15');
  await timeline.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('presentation-pin-frame')).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByTestId('presentation-canvas').getAttribute('data-source-frame'))).toBeGreaterThan(15);

  await page.getByTestId('presentation-slide-slide-pin').click();
  await expect(page.getByTestId('presentation-pin-frame')).toBeVisible();

  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.getByTestId('presentation-present')).toBeVisible();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-timeline')).toHaveCount(0);
  await page.getByTestId('presentation-present').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-canvas')).toHaveAttribute('data-playback-asset', 'original');

  await page.getByTestId('presentation-present').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-pin-frame')).toBeVisible();
  await page.getByTestId('presentation-present').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-canvas')).toHaveAttribute('data-playback-asset', 'original');
  await expect(page.getByTestId('presentation-present').getByText('Transition 3')).toBeVisible();
  expect(exactRequests).toEqual([]);
});

test('switching clip slides replaces the timeline and animated scene state', async ({ page }) => {
  const fixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');
  await installOpfsDirectoryPickerFixture(page, fixture);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/');

  await writeProjectJson(page, ['analysis', 'clips', 'clip-second', 'clip.json'], {
    schema: 'clip.v2',
    id: 'clip-second',
    videoId: 'video-main',
    label: 'Second animated sequence',
    startFrame: 20,
    endFrame: 48,
    tags: {
      primary: 'offensive.open_play.pass',
      facets: { 'pass.type': 'through_ball', 'outcome.pass': 'progression' },
    },
    pins: [
      { id: 'pin-second', frame: 28, label: 'Second pin', annotations: [] },
    ],
    annotations: [
      {
        id: 'second-highlight',
        type: 'highlight',
        coordMode: 'image',
        source: 'manual',
        style: {
          stroke: '#ff0000',
          fill: '#ff0000',
          fillOpacity: 0.8,
          strokeWidth: 6,
        },
        keyframes: [
          { frame: 20, cx: 500, cy: 100, radius: 24, provenance: 'manual' },
          { frame: 47, cx: 450, cy: 100, radius: 24, provenance: 'manual' },
        ],
      },
    ],
  });
  const stored = await readProjectJson(page, ['presentations', 'presentation-sequence.json']);
  await writeProjectJson(page, ['presentations', 'presentation-sequence.json'], {
    ...stored,
    slides: [
      { id: 'slide-first-clip', kind: 'clip', clipId: 'clip-sequence', pausePins: [] },
      { id: 'slide-second-clip', kind: 'clip', clipId: 'clip-second', pausePins: [] },
    ],
    transitions: [{ mode: 'cut' }],
  });

  await openPresentation(page, 'Breaking the press');
  const timeline = page.getByTestId('presentation-timeline');
  const lane = page.getByTestId('presentation-timeline-lane');
  const scroller = page.getByTestId('presentation-timeline-scroller');
  const zoom = timeline.getByLabel('Timeline zoom');
  await expect(lane).toHaveAttribute('data-start-frame', '5');
  await expect(lane).toHaveAttribute('data-end-frame', '44');

  await zoom.fill('4');
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await page.getByTestId('presentation-slide-slide-second-clip').click();
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '20');
  await expect(lane).toHaveAttribute('data-start-frame', '20');
  await expect(lane).toHaveAttribute('data-end-frame', '47');
  await expect(zoom).toHaveValue('0');
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect.poll(() => page.getByTestId('presentation-animated-overlay').evaluate((element) => {
    const pixel = (element as HTMLCanvasElement).getContext('2d')?.getImageData(500, 100, 1, 1).data;
    return pixel ? { red: pixel[0], green: pixel[1], alpha: pixel[3] } : null;
  })).toMatchObject({ red: 255, green: 0, alpha: expect.any(Number) });

  await page.getByTestId('presentation-slide-slide-first-clip').click();
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '5');
  await expect.poll(() => page.getByTestId('presentation-animated-overlay').evaluate((element) => (
    (element as HTMLCanvasElement).getContext('2d')?.getImageData(500, 100, 1, 1).data[3] ?? -1
  ))).toBe(0);
});

test('v2 presentation slides visibly degrade when their referenced clip is missing', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/broken-project'),
  );
  await openPresentation(page, 'Broken target');
  await expect(page.getByTestId('presentation-missing-reference')).toContainText('Missing clip: clip-missing');
});
