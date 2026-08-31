import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
const CLIP_ID = 'clip-sequence';

type HomographyRequest = {
  videoRef?: string;
  startMs: number;
  endMs: number;
  fps?: number;
};

async function installMockSidecar(page: Page) {
  const homographyRequests: HomographyRequest[] = [];
  await page.context().route(`${SIDECAR_BASE_URL}/**`, async (route) => {
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
        body: JSON.stringify({ videoRef: 'pin-video-ref', filename: 'retrieval-sample.mp4', sizeBytes: 2048 }),
      });
      return;
    }
    if (url.pathname === '/homography') {
      const body = request.postDataJSON() as HomographyRequest;
      homographyRequests.push(body);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frames: [body.startMs, body.endMs].map((tMs) => ({
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
  return { homographyRequests };
}

async function readClip(page: Page) {
  return page.evaluate(async (clipId) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const project = await (window as Window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker();
        const clipFolder = await project.getDirectoryHandle('analysis')
          .then((analysis) => analysis.getDirectoryHandle('clips'))
          .then((clips) => clips.getDirectoryHandle(clipId));
        const file = await clipFolder.getFileHandle('clip.json').then((handle) => handle.getFile());
        return JSON.parse(await file.text());
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw lastError;
  }, CLIP_ID);
}

async function readPinDocumentAtFrame(page: Page, frame: number) {
  return page.evaluate(async ({ clipId, targetFrame }) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const project = await (window as Window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker();
        const clipFolder = await project.getDirectoryHandle('analysis')
          .then((analysis) => analysis.getDirectoryHandle('clips'))
          .then((clips) => clips.getDirectoryHandle(clipId));
        const clip = JSON.parse(await clipFolder.getFileHandle('clip.json')
          .then((handle) => handle.getFile())
          .then((file) => file.text()));
        const pin = clip.pins.find((candidate: { frame: number }) => candidate.frame === targetFrame);
        if (!pin?.annotations?.[0]) return null;
        const file = await clipFolder.getDirectoryHandle('annotations')
          .then((annotations) => annotations.getFileHandle(`${pin.annotations[0].id}.json`))
          .then((handle) => handle.getFile());
        return { pin, document: JSON.parse(await file.text()) };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw lastError;
  }, { clipId: CLIP_ID, targetFrame: frame });
}

async function openEditor(page: Page): Promise<Page> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await page.getByTestId(`clip-tree-row-${CLIP_ID}`).click();
  const editorPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  const editorPage = await editorPagePromise;
  await editorPage.setViewportSize({ width: 1440, height: 1000 });
  await expect(editorPage.getByTestId('clip-editor')).toBeVisible();
  return editorPage;
}

test('pins support annotation parity, import, preview locking, and trash undo', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  const sidecar = await installMockSidecar(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  page = await openEditor(page);

  const existingObjectKeyframe = page.getByRole('button', { name: 'Arrow keyframe at frame 15' });
  const existingPin = page.getByRole('button', { name: 'Pin at frame 15' });
  await expect(existingObjectKeyframe).toBeVisible();
  await expect(page.getByTestId('clip-frame-grid')).toHaveAttribute('data-grid-step', '1');
  const markerPositions = await existingObjectKeyframe.evaluate((element) => {
    const lane = element.closest<HTMLElement>('[data-testid="clip-timeline-lane"]');
    if (!lane) throw new Error('Timeline lane missing');
    const pin = lane.querySelector<HTMLElement>('[aria-label="Pin at frame 15"]');
    if (!pin) throw new Error('Matching pin missing');
    return {
      object: Number.parseFloat((element as HTMLElement).style.left),
      pin: Number.parseFloat(pin.style.left),
    };
  });
  expect(markerPositions.object).toBeCloseTo(markerPositions.pin, 4);

  await existingPin.click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await expect(page.getByText(/Frame 16 · clip 5–44/)).toBeVisible();
  await page.getByRole('button', { name: 'Go to pin' }).click();
  await expect(page.getByText(/Frame 15 · clip 5–44/)).toBeVisible();
  const firstPinPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open pin at f15' }).click();
  let pinPage = await firstPinPagePromise;
  await pinPage.bringToFront();
  await pinPage.setViewportSize({ width: 1440, height: 1000 });
  let annotator = pinPage.getByTestId('pin-annotator');
  await expect(annotator).toBeVisible();
  await expect(pinPage).toHaveURL(/\/clip\/clip-sequence\?pinId=pin-shape/);
  await expect(pinPage.getByText(/Frame 15 · clip 5–44/)).toBeVisible();
  await pinPage.keyboard.press('Escape');
  expect(pinPage.isClosed()).toBe(false);
  await expect(annotator).toBeVisible();
  for (const tool of ['Select', 'Box', 'Circle', 'Highlight', 'Shadow', 'Arrow', 'Lob', 'Poly', 'Text', 'Manual H']) {
    await expect(annotator.getByRole('button', { name: tool, exact: true })).toBeVisible();
  }
  await expect(annotator.getByRole('button', { name: 'Import into clip' })).toBeEnabled();

  await annotator.getByRole('button', { name: 'Calibrate', exact: true }).click();
  await expect(annotator.getByRole('button', { name: 'Calibrating…' })).toBeVisible();
  await expect(annotator.getByText('PnLCalib applied.')).toBeVisible();
  expect(sidecar.homographyRequests).toHaveLength(1);
  expect(sidecar.homographyRequests[0]).toMatchObject({
    videoRef: 'pin-video-ref',
    startMs: 200,
    endMs: 1000,
    fps: 5,
  });
  const showHomography = annotator.getByRole('button', { name: 'Show H', exact: true });
  await expect(showHomography).toBeEnabled();
  await showHomography.click();
  await expect(annotator.getByRole('button', { name: 'Hide H', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await annotator.getByRole('button', { name: 'Delete H', exact: true }).click();
  await expect(annotator.getByText('Homography deleted.')).toBeVisible();
  await expect(annotator.getByRole('button', { name: 'Show H', exact: true })).toBeDisabled();
  await expect.poll(async () => {
    const stored = await readPinDocumentAtFrame(page, 15);
    return stored?.document.perspective ?? null;
  }).toBeNull();

  await expect(annotator.getByText('At pin frame; annotations editable')).toBeVisible();
  await pinPage.keyboard.down('ArrowRight');
  await expect(annotator.getByText(/annotations hidden and locked/)).toBeVisible();
  await pinPage.keyboard.up('ArrowRight');
  await expect(annotator.getByRole('button', { name: 'Return to pin' })).toBeVisible();
  await pinPage.keyboard.press('Space');
  await expect(annotator.getByText('At pin frame; annotations editable')).toBeVisible();
  const previewVideo = pinPage.getByTestId('clip-source-video');
  await expect.poll(async () => previewVideo.evaluate((element) => (
    Math.floor((element as HTMLVideoElement).currentTime * 25 + 1e-7)
  ))).toBe(15);
  await pinPage.waitForTimeout(200);
  await expect(annotator.getByText('At pin frame; annotations editable')).toBeVisible();

  await pinPage.keyboard.down('ArrowLeft');
  await expect(annotator.getByText(/annotations hidden and locked/)).toBeVisible();
  await pinPage.keyboard.up('ArrowLeft');
  await annotator.getByRole('button', { name: 'Return to pin' }).click();
  await expect.poll(async () => previewVideo.evaluate((element) => (
    Math.floor((element as HTMLVideoElement).currentTime * 25 + 1e-7)
  ))).toBe(15);
  await pinPage.waitForTimeout(200);
  await expect(annotator.getByText('At pin frame; annotations editable')).toBeVisible();

  await annotator.getByRole('button', { name: 'Import into clip' }).click();
  await expect(annotator.getByText('Annotations imported into the animated clip layer.')).toBeVisible();
  await expect.poll(async () => {
    const clip = await readClip(page);
    const imported = clip.annotations.find((annotation: { type: string; keyframes: Array<{ frame: number }> }) => (
      annotation.type === 'poly' && annotation.keyframes.some((keyframe) => keyframe.frame === 15)
    ));
    return imported ? { id: imported.id, hasMs: 'tMs' in imported.keyframes[0] } : null;
  }).toMatchObject({ hasMs: false });
  const importedAtFifteen = (await readClip(page)).annotations.find((annotation: { type: string; keyframes: Array<{ frame: number }> }) => (
    annotation.type === 'poly' && annotation.keyframes.some((keyframe) => keyframe.frame === 15)
  ));
  expect(importedAtFifteen.id).not.toBe('shape-poly');

  await annotator.getByRole('button', { name: 'New set' }).click();
  await annotator.getByPlaceholder('Set label').fill('Alternate view');
  await annotator.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(annotator.getByRole('combobox').first()).toHaveValue(/annotation-/);
  await expect.poll(async () => {
    const clip = await readClip(page);
    return clip.pins.find((pin: { frame: number }) => pin.frame === 15).annotations.length;
  }).toBe(2);
  await annotator.getByRole('button', { name: 'Delete set' }).click();
  await expect(annotator.getByRole('button', { name: 'Undo set delete' })).toBeVisible();
  await annotator.getByRole('button', { name: 'Undo set delete' }).click();
  await expect.poll(async () => {
    const clip = await readClip(page);
    return clip.pins.find((pin: { frame: number }) => pin.frame === 15).annotations.length;
  }).toBe(2);
  const firstPinClosed = pinPage.waitForEvent('close');
  await annotator.getByRole('button', { name: 'Close pin' }).click();
  await firstPinClosed;

  await page.getByRole('button', { name: 'Step forward' }).click();
  await expect(page.getByText(/Frame 16 · clip 5–44/)).toBeVisible();
  const secondPinPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Add pin at f16' }).click();
  pinPage = await secondPinPagePromise;
  await pinPage.bringToFront();
  await pinPage.setViewportSize({ width: 1440, height: 1000 });
  annotator = pinPage.getByTestId('pin-annotator');
  await expect(annotator).toBeVisible();
  await expect(pinPage).toHaveURL(/\/clip\/clip-sequence\?pinId=pin-/);
  await expect(pinPage.getByText(/Frame 16 · clip 5–44/)).toBeVisible();
  await expect(annotator.getByRole('button', { name: 'Import into clip' })).toBeEnabled();

  const stage = annotator.locator('canvas').last();
  await expect(stage).toBeVisible();
  await annotator.getByRole('button', { name: 'Select', exact: true }).click();
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error('Annotation stage did not have a layout box.');
  await pinPage.mouse.move(stageBox.x + 120, stageBox.y + 120);
  await pinPage.mouse.down({ button: 'middle' });
  await pinPage.mouse.move(stageBox.x + 260, stageBox.y + 240, { steps: 5 });
  await expect(annotator.getByTestId('annotation-marquee')).toHaveCount(0);
  await pinPage.mouse.up({ button: 'middle' });
  await annotator.getByRole('button', { name: 'Highlight', exact: true }).click();
  await stage.click({ position: { x: 300, y: 220 } });
  await annotator.getByLabel('Name', { exact: true }).fill('Left back');
  await annotator.getByLabel('Display name', { exact: true }).check();
  await annotator.getByLabel('Text size', { exact: true }).fill('32');
  await annotator.getByTestId('annotation-animation-add').click();
  await annotator.getByTestId('annotation-animation-effect').selectOption('grow');
  await annotator.getByTestId('annotation-animation-trigger').selectOption('on_click');
  await annotator.getByTestId('annotation-animation-delay').fill('0.2');
  await annotator.getByTestId('annotation-animation-duration').fill('0.6');
  await annotator.getByRole('button', { name: 'Arrow', exact: true }).click();
  await stage.click({ position: { x: 300, y: 220 } });
  await stage.click({ position: { x: 450, y: 170 } });
  await annotator.getByTestId('annotation-animation-add').click();
  await annotator.getByTestId('annotation-animation-effect').selectOption('wipe');
  await annotator.getByTestId('annotation-animation-trigger').selectOption('after_previous');
  await annotator.getByTestId('annotation-animation-duration').fill('0.4');
  await annotator.getByRole('button', { name: 'Poly', exact: true }).click();
  await stage.click({ position: { x: 300, y: 220 } });
  await stage.click({ position: { x: 380, y: 240 } });
  await stage.click({ position: { x: 420, y: 300 } });
  await pinPage.keyboard.press('Enter');
  await pinPage.keyboard.press('Meta+z');
  await annotator.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => {
    const stored = await readPinDocumentAtFrame(page, 16);
    return stored?.document.shapes.map((shape: { type: string }) => shape.type).sort() ?? [];
  }).toEqual(['arrow', 'highlight']);
  await pinPage.keyboard.press('Meta+Shift+z');
  await annotator.getByTestId('annotation-animation-preview-start').click();
  const animationPreview = annotator.getByTestId('annotation-animation-preview');
  await expect(animationPreview).toBeVisible();
  await expect(animationPreview).toHaveAttribute('data-animation-clicks', '0');
  await expect(animationPreview).toHaveAttribute('data-animation-pending-click', 'true');
  await annotator.getByTestId('annotation-animation-preview-next').click();
  await expect(animationPreview).toHaveAttribute('data-animation-clicks', '1');
  await annotator.getByRole('button', { name: 'Stop', exact: true }).click();
  await annotator.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(async () => {
    const stored = await readPinDocumentAtFrame(page, 16);
    return stored?.document.shapes.map((shape: { type: string }) => shape.type).sort() ?? [];
  }).toEqual(['arrow', 'highlight', 'poly']);
  const storedPin = await readPinDocumentAtFrame(page, 16);
  if (!storedPin) throw new Error('Frame-16 pin document was not persisted.');
  const highlight = storedPin.document.shapes.find((shape: { type: string }) => shape.type === 'highlight');
  const arrow = storedPin.document.shapes.find((shape: { type: string }) => shape.type === 'arrow');
  const poly = storedPin.document.shapes.find((shape: { type: string }) => shape.type === 'poly');
  expect(highlight.name).toBe('Left back');
  expect(highlight.displayName).toBe(true);
  expect(highlight.style.fontSize).toBe(32);
  expect(arrow.vertexRefs[0]).toBe(highlight.id);
  expect(poly.vertexRefs[0]).toBe(highlight.id);
  expect(storedPin.document.animations).toEqual([
    expect.objectContaining({
      shapeIds: [highlight.id],
      effect: 'grow',
      trigger: 'on_click',
      delayMs: 200,
      durationMs: 600,
    }),
    expect.objectContaining({
      shapeIds: [arrow.id],
      effect: 'wipe',
      trigger: 'after_previous',
      delayMs: 0,
      durationMs: 400,
    }),
  ]);

  await annotator.getByRole('button', { name: 'Import into clip' }).click();
  await expect(annotator.getByText('Annotations imported into the animated clip layer.')).toBeVisible();
  await expect.poll(async () => {
    const clip = await readClip(page);
    return clip.annotations.filter((annotation: { keyframes: Array<{ frame: number }> }) => (
      annotation.keyframes.some((keyframe) => keyframe.frame === 16)
    )).length;
  }).toBe(3);
  const secondPinClosed = pinPage.waitForEvent('close');
  await annotator.getByRole('button', { name: 'Close pin' }).click();
  await secondPinClosed;

  await expect.poll(async () => {
    const clip = await readClip(page);
    const imported = clip.annotations.filter((annotation: { keyframes: Array<{ frame: number }> }) => (
      annotation.keyframes.some((keyframe) => keyframe.frame === 16)
    ));
    const importedHighlight = imported.find((annotation: { type: string }) => annotation.type === 'highlight');
    const importedArrow = imported.find((annotation: { type: string }) => annotation.type === 'arrow');
    const importedPoly = imported.find((annotation: { type: string }) => annotation.type === 'poly');
    return {
      count: imported.length,
      arrowRef: importedArrow?.vertexRefs?.[0] ?? null,
      polyRef: importedPoly?.vertexRefs?.[0] ?? null,
      highlightId: importedHighlight?.id ?? null,
      highlightName: importedHighlight?.name ?? null,
      highlightDisplayName: importedHighlight?.displayName ?? null,
      highlightFontSize: importedHighlight?.style?.fontSize ?? null,
    };
  }).toMatchObject({
    count: 3,
    highlightName: 'Left back',
    highlightDisplayName: true,
    highlightFontSize: 32,
  });
  const importedClip = await readClip(page);
  const importedAtSixteen = importedClip.annotations.filter((annotation: { keyframes: Array<{ frame: number }> }) => (
    annotation.keyframes.some((keyframe) => keyframe.frame === 16)
  ));
  const importedHighlight = importedAtSixteen.find((annotation: { type: string }) => annotation.type === 'highlight');
  expect(importedAtSixteen.find((annotation: { type: string }) => annotation.type === 'arrow').vertexRefs[0]).toBe(importedHighlight.id);
  expect(importedAtSixteen.find((annotation: { type: string }) => annotation.type === 'poly').vertexRefs[0]).toBe(importedHighlight.id);

  await page.getByLabel('Pin label').fill('Second phase');
  await page.getByRole('button', { name: 'Save label' }).click();
  await expect.poll(async () => {
    const clip = await readClip(page);
    return clip.pins.find((pin: { frame: number }) => pin.frame === 16)?.label;
  }).toBe('Second phase');
  await page.getByRole('button', { name: 'Delete pin' }).click();
  await expect.poll(async () => (await readClip(page)).pins.some((pin: { frame: number }) => pin.frame === 16)).toBe(false);
  await page.getByRole('button', { name: 'Undo pin delete' }).click();
  await expect.poll(async () => (await readClip(page)).pins.some((pin: { frame: number }) => pin.frame === 16)).toBe(true);

  await page.reload();
  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pin at frame 16' })).toBeVisible();
  const reloadedPin = await readPinDocumentAtFrame(page, 16);
  if (!reloadedPin) throw new Error('Frame-16 pin was not restored after reload.');
  expect(reloadedPin.document.shapes).toHaveLength(3);

  await page.getByRole('button', { name: 'Pin at frame 15' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('clip-editor')).toHaveAttribute('data-playback-paused-pin-id', reloadedPin.pin.id);
  await expect(page.getByTestId('clip-editor')).toHaveAttribute('data-pin-animation-pending-click', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('clip-editor')).toHaveAttribute('data-pin-animation-clicks', '1');
  await expect(page.getByTestId('clip-editor')).toHaveAttribute('data-playback-paused-pin-id', reloadedPin.pin.id);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('clip-editor')).not.toHaveAttribute('data-playback-paused-pin-id', /.+/);
});

test('pin shadows expose direct direction and spread handles', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
    { rootName: 'pin-shadow-handles-project' },
  );
  await installMockSidecar(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  page = await openEditor(page);

  await page.getByRole('button', { name: 'Pin at frame 15' }).click();
  const pinPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open pin at f15' }).click();
  const pinPage = await pinPagePromise;
  await pinPage.setViewportSize({ width: 1440, height: 1000 });
  const annotator = pinPage.getByTestId('pin-annotator');
  await expect(annotator).toBeVisible();
  const stage = annotator.locator('canvas').last();
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error('Annotation stage did not have a layout box.');

  const center = {
    x: stageBox.x + stageBox.width * 0.6,
    y: stageBox.y + stageBox.height * 0.55,
  };
  const displayRadius = Math.min(stageBox.width, stageBox.height) * 0.18;
  const initialDirection = { x: center.x, y: center.y - displayRadius };
  await annotator.getByRole('button', { name: 'Shadow', exact: true }).click();
  await pinPage.mouse.move(center.x, center.y);
  await pinPage.mouse.down();
  await pinPage.mouse.move(initialDirection.x, initialDirection.y, { steps: 5 });
  await pinPage.mouse.up();

  await annotator.getByRole('button', { name: 'Select', exact: true }).click();
  await pinPage.mouse.click(center.x, center.y - displayRadius / 2);
  const newDirection = { x: center.x + displayRadius, y: center.y };
  await pinPage.mouse.move(initialDirection.x, initialDirection.y);
  await pinPage.mouse.down();
  await pinPage.mouse.move(newDirection.x, newDirection.y, { steps: 8 });
  await pinPage.mouse.up();

  const spreadHandle = {
    x: center.x + Math.cos(21 * Math.PI / 180) * displayRadius,
    y: center.y + Math.sin(21 * Math.PI / 180) * displayRadius,
  };
  const wideTarget = {
    x: center.x + Math.cos(60 * Math.PI / 180) * displayRadius,
    y: center.y + Math.sin(60 * Math.PI / 180) * displayRadius,
  };
  await pinPage.mouse.move(spreadHandle.x, spreadHandle.y);
  await pinPage.mouse.down();
  await pinPage.mouse.move(wideTarget.x, wideTarget.y, { steps: 8 });
  await pinPage.mouse.up();
  await annotator.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(async () => {
    const stored = await readPinDocumentAtFrame(page, 15);
    const shadow = stored?.document.shapes.find((shape: { type: string }) => shape.type === 'shadow');
    return shadow
      ? {
          rotation: Math.round(shadow.rotation),
          spread: Math.round(shadow.spreadDeg),
          hasRadius: shadow.r > 0,
        }
      : null;
  }).toEqual({ rotation: 0, spread: 120, hasRadius: true });
});
