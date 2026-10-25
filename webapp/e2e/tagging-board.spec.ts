import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';
import defaultBoardDocument from '../public/tagging/board.json';

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

async function openCapturePlayer(page: Page, board?: unknown): Promise<void> {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/retrieval-project'),
  );
  await page.goto('/');
  if (board) await page.evaluate(async (document) => {
    const project = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    const file = await project.getFileHandle('tagging-board.json');
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(document));
    await writable.close();
  }, board);
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect(page.getByTestId('tag-board')).toBeVisible();
  await expect(page.getByTestId('video-range-lanes')).toBeVisible();
  await expect(page.locator('[data-testid^="video-range-lane-"]:not([data-testid="video-range-lanes"])')).toHaveCount(4);
  await expect(page.locator('[data-testid^="video-range-lane-label-"]')).toHaveCount(0);
}

async function settleFrame(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && !video.seeking && video.readyState >= 2;
  });
  // A seek resolves before requestVideoFrameCallback publishes its decoded frame.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
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

test('exclusive possession switches save adjacent clips while an overlapping pass stays active', async ({ page }) => {
  const board = structuredClone(defaultBoardDocument);
  Object.assign(board.groups[0].buttons[0], { hotkey: 'p' });
  await openCapturePlayer(page, board);
  const offense = page.getByTestId('tag-board-button-offensive.open_play.possession');
  const defense = page.getByTestId('tag-board-button-defensive.open_play.possession');
  const pass = page.getByTestId('tag-board-button-offensive.open_play.pass');
  const activeOffense = page.getByTestId('video-range-active-offensive.open_play.possession');
  const activeDefense = page.getByTestId('video-range-active-defensive.open_play.possession');
  const activePass = page.getByTestId('video-range-active-offensive.open_play.pass');

  await page.keyboard.press('p');
  await expect(offense).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tag-board-facet-zone.vertical_third').getByRole('button', { name: /Final third/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await settleFrame(page);
  await pass.click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await settleFrame(page);
  await defense.click();
  await expect(offense).toHaveAttribute('aria-pressed', 'false');
  await expect(defense).toHaveAttribute('aria-pressed', 'true');
  await expect(activeOffense).toHaveCount(0);
  await expect(activeDefense).toBeVisible();
  await expect(activePass).toBeVisible();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(3);
  const first = (await clipDocuments(page)).find((clip) => clip.tags.primary === 'offensive.open_play.possession')!;
  expect(first.tags.facets).toEqual({ 'zone.vertical_third': 'final_third' });
  expect(first.startFrame).toBe(0);
  expect(first.endFrame).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Step forward' }).click();
  await settleFrame(page);
  await page.keyboard.press('p');
  await expect(defense).toHaveAttribute('aria-pressed', 'false');
  await expect(offense).toHaveAttribute('aria-pressed', 'true');
  await expect(activePass).toBeVisible();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(4);
  const second = (await clipDocuments(page)).find((clip) => clip.tags.primary === 'defensive.open_play.possession')!;
  expect(second.startFrame).toBe(first.endFrame);
  expect(second.endFrame).toBe(second.startFrame + 1);
  expect(second.tags.facets).toEqual({});
  await page.getByRole('button', { name: 'Step forward' }).click();
  await settleFrame(page);
  await offense.click();
  await pass.click();
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(6);
  const overlappingPass = (await clipDocuments(page)).find((clip) => clip.tags.primary === 'offensive.open_play.pass')!;
  expect(overlappingPass.startFrame).toBeLessThan(first.endFrame);
  expect(overlappingPass.endFrame).toBeGreaterThan(second.endFrame);
  await page.reload();
  await expect(page.getByTestId(`clip-tree-row-${first.id}`)).toContainText('Possession');
  expect((await clipDocuments(page)).filter((clip) => clip.tags.primary === 'offensive.open_play.possession')).toHaveLength(2);
});

test('older default boards gain exclusions and a failed switch retains the original capture', async ({ page }) => {
  const { exclusiveGroups: _groups, ...olderBoard } = defaultBoardDocument;
  await openCapturePlayer(page, olderBoard);
  const offense = page.getByTestId('tag-board-button-offensive.open_play.possession');
  const defense = page.getByTestId('tag-board-button-defensive.open_play.possession');
  await offense.click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.evaluate(() => {
    const prototype = FileSystemDirectoryHandle.prototype;
    const getDirectory = prototype.getDirectoryHandle;
    prototype.getDirectoryHandle = async function (name, options) {
      if (this.name === 'clips' && options?.create) {
        prototype.getDirectoryHandle = getDirectory;
        throw new DOMException('Simulated disk full', 'QuotaExceededError');
      }
      return getDirectory.call(this, name, options);
    };
  });
  await defense.click();
  await expect(page.getByRole('status')).toContainText('Simulated disk full');
  await expect(offense).toHaveAttribute('aria-pressed', 'true');
  await expect(defense).toHaveAttribute('aria-pressed', 'false');
  expect((await clipDocuments(page)).length).toBe(2);
  await defense.click();
  await expect(offense).toHaveAttribute('aria-pressed', 'false');
  await expect(defense).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await clipDocuments(page)).length).toBe(3);
  expect((await clipDocuments(page)).find((clip) => clip.tags.primary === 'offensive.open_play.possession'))
    .toMatchObject({ startFrame: 0, endFrame: 1 });
});

test('clicking a clip row seeks to its start and reveals it in the timeline', async ({ page }) => {
  await openCapturePlayer(page);
  const decodedFrame = await page.locator('video').evaluateHandle((video: HTMLVideoElement) => {
    const state: { mediaTime: number | null } = { mediaTime: null };
    const callback: VideoFrameRequestCallback = (_now, metadata) => {
      state.mediaTime = metadata.mediaTime;
      video.requestVideoFrameCallback(callback);
    };
    video.requestVideoFrameCallback(callback);
    return state;
  });

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
  await expect.poll(() => decodedFrame.evaluate((state) => state.mediaTime)).toBeCloseTo(5 / 25, 6);
  await expect(page.getByText(/frame 5 \/ 49/)).toBeVisible();
  const seekTime = await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
  expect(seekTime).toBeGreaterThan(5 / 25);
  expect(seekTime).toBeLessThan(6 / 25);

  const visibleScroller = await scroller.boundingBox();
  const playhead = await page.getByTestId('video-timeline-playhead').boundingBox();
  if (!visibleScroller || !playhead) throw new Error('Timeline or playhead did not have a layout box.');
  expect(playhead.x).toBeGreaterThanOrEqual(visibleScroller.x - 1);
  expect(playhead.x).toBeLessThanOrEqual(visibleScroller.x + visibleScroller.width + 1);

  await page.getByRole('button', { name: 'Step forward', exact: true }).click();
  await expect.poll(() => decodedFrame.evaluate((state) => state.mediaTime)).toBeCloseTo(6 / 25, 6);
  await expect(page.getByText(/frame 6 \/ 49/)).toBeVisible();
  await page.getByRole('button', { name: 'Step back', exact: true }).click();
  await expect.poll(() => decodedFrame.evaluate((state) => state.mediaTime)).toBeCloseTo(5 / 25, 6);
  await expect(page.getByText(/frame 5 \/ 49/)).toBeVisible();
  await decodedFrame.dispose();
});

test('timeline selection reveals the clip row without disturbing an already visible row', async ({ page }) => {
  await openCapturePlayer(page);
  const tree = page.getByTestId('clip-tag-tree');
  const row = page.getByTestId('clip-tree-row-clip-second');
  const range = page.getByTestId('video-range-clip-second');
  const rowIsVisible = () => row.evaluate((element) => {
    const scroller = element.closest('[data-testid="clip-tag-tree"]')!;
    const viewport = scroller.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const heading = element.closest('section')!.querySelector('[data-clip-group-heading]')!;
    return bounds.top >= viewport.top + heading.getBoundingClientRect().height - 1
      && bounds.bottom <= viewport.bottom + 1;
  });
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  expect(await rowIsVisible()).toBe(false);
  await range.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(rowIsVisible).toBe(true);
  await expect(page.getByText(/frame 20 \/ 49/)).toBeVisible();

  const visibleScroll = await tree.evaluate((element) => element.scrollTop);
  await range.click();
  expect(await tree.evaluate((element) => element.scrollTop)).toBe(visibleScroll);

  // The same selection must reveal again after the user scrolls it out of view.
  await tree.hover();
  await page.mouse.wheel(0, -4_000);
  await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await rowIsVisible()).toBe(false);
  await range.click();
  await expect.poll(rowIsVisible).toBe(true);

  await page.getByTestId('video-range-clip-first').click();
  const first = page.getByTestId('clip-tree-row-clip-first');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => first.evaluate((element) => {
    const scroller = element.closest('[data-testid="clip-tag-tree"]')!;
    const heading = element.closest('section')!.querySelector('[data-clip-group-heading]')!;
    return element.getBoundingClientRect().top >= scroller.getBoundingClientRect().top
      + heading.getBoundingClientRect().height - 1;
  })).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
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
  const otherAction = page.getByTestId('tag-board-button-offensive.open_play.cross');
  await otherAction.hover();
  await expect(verticalThird).toBeVisible();
  await expect(page.getByTestId('tag-board-facet-cross.type')).toHaveCount(0);
  await otherAction.focus();
  await expect(verticalThird).toBeVisible();
  await expect(finalThird).toHaveAttribute('aria-pressed', 'true');
  // Cross the action grid on the way to a modifier without changing its target.
  await finalThird.click();
  await expect(finalThird).toHaveAttribute('aria-pressed', 'false');
  await finalThird.click();
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
  await transition.hover();
  await expect(page.getByTestId('tag-board-facet-pass.type')).toBeVisible();
  await expect(outcome).toHaveCount(0);
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
  await expect(goalMethod).toBeVisible();
  await expect(header).toHaveAttribute('aria-pressed', 'true');
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
  await otherAction.hover();
  await expect(verticalThird).toBeVisible();
  await expect(page.getByTestId('tag-board-facet-cross.type')).toHaveCount(0);
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
  const range = page.getByTestId(`video-range-${hotkeyCapture.id}`);
  await expect(row).toContainText('Pass');
  await expect(range).toContainText('Pass');
  await expect.poll(async () => (
    (await clipDocuments(page)).find((clip) => clip.id === hotkeyCapture.id)?.label
  )).toBe('Pass');
  const takeOnTarget = page.getByTestId('clip-tag-target-offensive.open_play.take_on');
  await row.dragTo(takeOnTarget);
  await expect.poll(async () => (
    (await clipDocuments(page)).find((clip) => clip.id === hotkeyCapture.id)?.tags.primary
  )).toBe('offensive.open_play.take_on');
  await expect(row).toContainText('Take-on');
  await expect(range).toContainText('Take-on');

  // Existing projects may contain user-authored clip names. Seed one on disk,
  // reload it, then re-tag through the UI without losing that custom name.
  await page.evaluate(async (clipId) => {
    const project = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const clips = await (await project.getDirectoryHandle('analysis')).getDirectoryHandle('clips');
    const handle = await (await clips.getDirectoryHandle(clipId)).getFileHandle('clip.json');
    const clip = JSON.parse(await (await handle.getFile()).text());
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ ...clip, label: 'Build-up on the left' }));
    await writable.close();
  }, hotkeyCapture.id);
  await page.reload();
  await row.click();
  await page.getByRole('button', { name: 'Re-tag selected' }).click();
  await page.getByTestId('tag-board-button-offensive.set_piece.throw_in').click();
  await expect.poll(async () => (
    (await clipDocuments(page)).find((clip) => clip.id === hotkeyCapture.id)?.tags.primary
  )).toBe('offensive.set_piece.throw_in');
  await expect(row).toContainText('Build-up on the left');
  await expect(range).toContainText('Build-up on the left');

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
  )).toBe('offensive.set_piece.throw_in');
  await expect(row).toContainText('Build-up on the left');
  await expect(range).toContainText('Build-up on the left');
  await expect(page.getByText('Untagged', { exact: true })).toBeVisible();
});
