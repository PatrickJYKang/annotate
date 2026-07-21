import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

type StoredClip = {
  id: string;
  label?: string;
  startFrame: number;
  endFrame: number;
  tags: {
    primary: string | null;
    facets: Record<string, string | string[]>;
  };
};

async function clipDocuments(page: Page): Promise<StoredClip[]> {
  return page.evaluate(async () => {
    const project = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const clips = await project
      .getDirectoryHandle('analysis')
      .then((analysis) => analysis.getDirectoryHandle('clips'));
    const documents = [];
    for await (const [, handle] of clips.entries()) {
      if (handle.kind !== 'directory') continue;
      const file = await handle.getFileHandle('clip.json').then((entry) => entry.getFile());
      try {
        documents.push(JSON.parse(await file.text()));
      } catch {
        // A click handler may still be closing a newly created writable stream.
      }
    }
    return documents;
  });
}

async function openCapturePlayer(page: Page): Promise<void> {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/retrieval-project'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect(page.getByTestId('tag-board')).toBeVisible();
  await expect(page.getByTestId('video-range-lanes')).toBeVisible();
  await expect(page.locator('[data-testid^="video-range-lane-"]:not([data-testid="video-range-lanes"])')).toHaveCount(4);
  await expect(page.locator('[data-testid^="video-range-lane-label-"]')).toHaveCount(0);
}

test('manual timeline scrolling suspends playhead following', async ({ page }) => {
  await openCapturePlayer(page);

  const scroller = page.getByTestId('video-timeline-scroller');
  const scrollerBox = await scroller.boundingBox();
  if (!scrollerBox) throw new Error('Video timeline scroller did not have a layout box.');

  for (let index = 0; index < 36; index += 1) {
    await scroller.dispatchEvent('wheel', {
      ctrlKey: true,
      deltaY: -12,
      clientX: scrollerBox.x + scrollerBox.width / 2,
      clientY: scrollerBox.y + 8,
    });
  }
  await scroller.hover();
  await page.mouse.wheel(0, 4_000);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const scrollLeftBeforePlayback = await scroller.evaluate((element) => element.scrollLeft);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(350);
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(scrollLeftBeforePlayback * 0.8);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

test('clicking a clip row seeks to its start and reveals it in the timeline', async ({ page }) => {
  await openCapturePlayer(page);

  const scroller = page.getByTestId('video-timeline-scroller');
  const scrollerBox = await scroller.boundingBox();
  if (!scrollerBox) throw new Error('Video timeline scroller did not have a layout box.');

  for (let index = 0; index < 36; index += 1) {
    await scroller.dispatchEvent('wheel', {
      ctrlKey: true,
      deltaY: -12,
      clientX: scrollerBox.x + scrollerBox.width / 2,
      clientY: scrollerBox.y + 8,
    });
  }
  await page.waitForTimeout(200);
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(
    () => scroller.evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
  const hiddenPlayhead = await page.getByTestId('video-timeline-playhead').boundingBox();
  if (!hiddenPlayhead) throw new Error('Timeline playhead did not have a layout box.');
  expect(
    hiddenPlayhead.x < scrollerBox.x
    || hiddenPlayhead.x > scrollerBox.x + scrollerBox.width,
  ).toBe(true);

  await page.getByTestId('clip-tree-row-clip-first').click();
  await expect(page.getByText(/frame 5 \/ 49/)).toBeVisible();

  const visibleScroller = await scroller.boundingBox();
  const playhead = await page.getByTestId('video-timeline-playhead').boundingBox();
  if (!visibleScroller || !playhead) throw new Error('Timeline or playhead did not have a layout box.');
  expect(playhead.x).toBeGreaterThanOrEqual(visibleScroller.x - 1);
  expect(playhead.x).toBeLessThanOrEqual(visibleScroller.x + visibleScroller.width + 1);
});

test('captures and re-tags clips exclusively through the tagging board', async ({ page }) => {
  await openCapturePlayer(page);

  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: 'Step forward' }).click();
  }
  await expect(page.getByText(/frame 3 \/ 49/)).toBeVisible();

  const verticalThird = page.getByTestId('tag-board-facet-zone.vertical_third');
  const finalThird = verticalThird.getByRole('button', { name: /Final third/ });
  await finalThird.click();
  await expect(finalThird).toHaveAttribute('aria-pressed', 'true');
  const possession = page.getByTestId('tag-board-button-offensive.open_play.possession');
  await possession.click();
  await expect(possession).toHaveAttribute('aria-pressed', 'true');
  const offensiveOpenPlayLane = page.getByTestId('video-range-lane-offensive.open_play');
  const activePossession = offensiveOpenPlayLane.getByTestId('video-range-active-offensive.open_play.possession');
  await expect(activePossession).toBeVisible();
  await expect(activePossession).toHaveAttribute('data-pending', 'true');
  await expect(finalThird).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await possession.click();
  await expect(activePossession).toHaveCount(0);

  await expect.poll(async () => (await clipDocuments(page)).length).toBe(3);
  const toggledCapture = (await clipDocuments(page)).find((clip) => (
    clip.label === 'Possession' && clip.startFrame === 3
  ));
  expect(toggledCapture).toMatchObject({
    startFrame: 3,
    endFrame: 6,
    tags: {
      primary: 'offensive.open_play.possession',
      facets: { 'zone.vertical_third': 'final_third' },
    },
  });
  await expect(finalThird).toHaveAttribute('aria-pressed', 'false');

  const transition = page.getByTestId('tag-board-button-offensive.open_play.transition');
  const pass = page.getByTestId('tag-board-button-offensive.open_play.pass');
  await transition.click();
  const outcome = page.getByTestId('tag-board-facet-outcome.general');
  const goal = outcome.getByRole('button', { name: /Goal/ });
  await expect(page.getByTestId('tag-board-facet-goal.method')).toHaveCount(0);
  await goal.click();
  const goalMethod = page.getByTestId('tag-board-facet-goal.method');
  const header = goalMethod.getByRole('button', { name: /Header/ });
  await expect(header).toBeVisible();
  await header.click();

  await pass.click();
  await expect(page.getByText('2 ranges armed')).toBeVisible();
  const activeTransition = offensiveOpenPlayLane.getByTestId('video-range-active-offensive.open_play.transition');
  const activePass = offensiveOpenPlayLane.getByTestId('video-range-active-offensive.open_play.pass');
  await expect(activeTransition).toBeVisible();
  await expect(activePass).toBeVisible();
  const transitionBox = await activeTransition.boundingBox();
  const passBox = await activePass.boundingBox();
  expect(transitionBox?.y).not.toBe(passBox?.y);

  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await pass.click();
  await expect(activePass).toHaveCount(0);
  await expect(activeTransition).toBeVisible();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(4);
  expect((await clipDocuments(page)).find((clip) => clip.label === 'Pass')).toMatchObject({
    startFrame: 5,
    endFrame: 8,
  });
  await expect(page.getByText('1 range armed')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('1 range armed')).toHaveCount(0);

  await expect(possession).toBeEnabled();
  await page.keyboard.press('p');
  await expect(possession).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.keyboard.press('p');
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(5);
  const hotkeyCapture = (await clipDocuments(page)).find((clip) => (
    clip.label === 'Possession' && clip.startFrame === 7
  ));
  expect(hotkeyCapture).toMatchObject({ startFrame: 7, endFrame: 9 });
  if (!hotkeyCapture) throw new Error('Hotkey capture was not persisted.');

  await page.getByLabel('Selected video').focus();
  await page.keyboard.press('p');
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(5);

  await page.getByRole('button', { name: 'Re-tag selected' }).click();
  await expect(page.getByTestId('tag-board-mode')).toHaveText('re-tag');
  await pass.click();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(5);
  await expect.poll(async () => (
    (await clipDocuments(page)).find((clip) => clip.id === hotkeyCapture.id)?.tags.primary
  )).toBe('offensive.open_play.pass');
  await expect(page.getByTestId('tag-board-mode')).toHaveText('capture');

  const row = page.getByTestId(`clip-tree-row-${hotkeyCapture.id}`);
  const takeOnTarget = page.getByTestId('clip-tag-target-offensive.open_play.take_on');
  await row.dragTo(takeOnTarget);
  await expect.poll(async () => (
    (await clipDocuments(page)).find((clip) => clip.id === hotkeyCapture.id)?.tags.primary
  )).toBe('offensive.open_play.take_on');

  await page.getByRole('button', { name: 'Untagged clip' }).click();
  await expect(page.getByRole('button', { name: 'Untagged clip' })).toHaveAttribute('aria-pressed', 'true');
  const activeUntagged = page.getByTestId('video-range-active-untagged');
  await expect(activeUntagged).toBeVisible();
  await expect(activeUntagged).toHaveAttribute('data-pending', 'true');
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'Untagged clip' }).click();
  await expect(activeUntagged).toHaveCount(0);
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(6);
  await expect(page.getByText('Untagged', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete clip' }).click();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(5);
  await page.getByRole('button', { name: 'Undo delete' }).click();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(6);

  await page.reload();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect.poll(async () => (
    (await clipDocuments(page)).find((clip) => clip.id === hotkeyCapture.id)?.tags.primary
  )).toBe('offensive.open_play.take_on');
  await expect(page.getByText('Untagged', { exact: true })).toBeVisible();
});
