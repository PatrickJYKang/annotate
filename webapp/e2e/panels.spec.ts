import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const clipFixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');
const taggingFixture = path.resolve(process.cwd(), 'e2e/fixtures/retrieval-project');

async function openProject(page: Page, fixture: string): Promise<void> {
  await installOpfsDirectoryPickerFixture(page, fixture);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
}

async function dragHandle(handle: Locator, dx: number, dy: number): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error('Resize handle has no bounding box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await handle.page().mouse.move(x, y);
  await handle.page().mouse.down();
  await handle.page().mouse.move(x + dx, y + dy, { steps: 8 });
  await handle.page().mouse.up();
}

async function panelSize(page: Page, panelId: string): Promise<{ width: number; height: number }> {
  const box = await page.locator(`[data-panel-id="${panelId}"]`).boundingBox();
  if (!box) throw new Error(`Panel ${panelId} has no bounding box.`);
  return { width: box.width, height: box.height };
}

test('clip editor panels resize, enforce minima, and restore their layout', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openProject(page, clipFixture);
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await page.getByTestId('clip-tree-row-clip-sequence').click();
  const editorPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  page = await editorPagePromise;
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.getByTestId('clip-editor')).toBeVisible();

  const inspectorHandle = page.getByTestId('clip-inspector-resize-handle');
  const timelineHandle = page.getByTestId('clip-timeline-resize-handle');
  const beforeInspector = await panelSize(page, 'clip-inspector');
  const beforeTimeline = await panelSize(page, 'clip-timeline-panel');
  await dragHandle(inspectorHandle, -130, 0);
  await dragHandle(timelineHandle, 0, -90);
  const resizedInspector = await panelSize(page, 'clip-inspector');
  const resizedTimeline = await panelSize(page, 'clip-timeline-panel');
  expect(resizedInspector.width).toBeGreaterThan(beforeInspector.width + 80);
  expect(resizedTimeline.height).toBeGreaterThan(beforeTimeline.height + 55);

  await page.waitForTimeout(150);
  await page.reload();
  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await expect.poll(async () => (await panelSize(page, 'clip-inspector')).width).toBeCloseTo(resizedInspector.width, -1);
  await expect.poll(async () => (await panelSize(page, 'clip-timeline-panel')).height).toBeCloseTo(resizedTimeline.height, -1);

  const keyboardBefore = await panelSize(page, 'clip-inspector');
  await page.getByTestId('clip-inspector-resize-handle').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await panelSize(page, 'clip-inspector')).width).not.toBe(keyboardBefore.width);

  await dragHandle(page.getByTestId('clip-inspector-resize-handle'), 5000, 0);
  await dragHandle(page.getByTestId('clip-timeline-resize-handle'), 0, 5000);
  expect((await panelSize(page, 'clip-inspector')).width).toBeGreaterThan(180);
  expect((await panelSize(page, 'clip-timeline-panel')).height).toBeGreaterThan(75);
  await expect(page.getByTestId('clip-stage')).toBeVisible();
});

test('player panel hotkeys remain active after resizing and layouts persist', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openProject(page, taggingFixture);
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await expect(page.getByTestId('capture-player')).toBeVisible();

  const beforeVideo = await panelSize(page, 'player-video');
  const beforeBoard = await panelSize(page, 'player-tag-board');
  await dragHandle(page.getByTestId('player-main-resize-handle'), -120, 0);
  await dragHandle(page.getByTestId('player-tagging-resize-handle'), 0, 70);
  const resizedVideo = await panelSize(page, 'player-video');
  const resizedBoard = await panelSize(page, 'player-tag-board');
  expect(resizedVideo.width).toBeLessThan(beforeVideo.width - 70);
  expect(resizedBoard.height).toBeGreaterThan(beforeBoard.height + 40);

  await page.getByTestId('player-main-resize-handle').focus();
  await page.keyboard.press('p');
  await expect(page.getByTestId('tag-board-button-offensive.open_play.possession')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.keyboard.press('p');
  await expect(page.getByText(/Captured Possession/)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect.poll(async () => (await panelSize(page, 'player-video')).width).toBeCloseTo(resizedVideo.width, -1);
  await expect.poll(async () => (await panelSize(page, 'player-tag-board')).height).toBeCloseTo(resizedBoard.height, -1);
});

test('presentation authoring persists every major panel split', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openProject(page, clipFixture);
  const card = page.locator('[data-testid^="presentation-card-"]').filter({ hasText: 'Breaking the press' });
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('presentation-editor')).toBeVisible();

  const assetsBefore = await panelSize(page, 'presentation-assets-panel');
  const inspectorBefore = await panelSize(page, 'presentation-inspector-panel');
  const deckBefore = await panelSize(page, 'presentation-deck-panel');
  await dragHandle(page.getByTestId('presentation-assets-resize-handle'), 80, 0);
  await dragHandle(page.getByTestId('presentation-inspector-resize-handle'), -70, 0);
  await dragHandle(page.getByTestId('presentation-deck-resize-handle'), 0, -70);
  const assetsResized = await panelSize(page, 'presentation-assets-panel');
  const inspectorResized = await panelSize(page, 'presentation-inspector-panel');
  const deckResized = await panelSize(page, 'presentation-deck-panel');
  expect(assetsResized.width).toBeGreaterThan(assetsBefore.width + 40);
  expect(inspectorResized.width).toBeGreaterThan(inspectorBefore.width + 35);
  expect(deckResized.height).toBeGreaterThan(deckBefore.height + 35);

  await page.waitForTimeout(150);
  await page.reload();
  await expect(page.getByTestId('presentation-editor')).toBeVisible();
  await expect.poll(async () => (await panelSize(page, 'presentation-assets-panel')).width).toBeCloseTo(assetsResized.width, -1);
  await expect.poll(async () => (await panelSize(page, 'presentation-inspector-panel')).width).toBeCloseTo(inspectorResized.width, -1);
  await expect.poll(async () => (await panelSize(page, 'presentation-deck-panel')).height).toBeCloseTo(deckResized.height, -1);
});

test('narrow project and player routes do not introduce page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, taggingFixture);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
