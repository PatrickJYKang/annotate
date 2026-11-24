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
  await expect(page.getByTestId('presentation-editor')).toBeVisible({ timeout: 20_000 });
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

async function openFixtureStudio(page: Page, prepare?: () => Promise<void>) {
  await installOpfsDirectoryPickerFixture(page, path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).waitFor();
  await prepare?.();
  await page.goto('/clip/clip-sequence');
  const editor = page;
  await editor.getByRole('button', { name: 'Clip recordings' }).click();
  return { editor, studio: editor.getByRole('dialog', { name: 'Clip recordings' }) };
}

test('recording overlays fit the visible footage in short and narrow windows', async ({ page }) => {
  const { editor, studio } = await openFixtureStudio(page);
  const highlightAtFrame20 = async (laneId: string, canvasId: string) => {
    const lane = editor.getByTestId(laneId);
    const box = (await lane.boundingBox())!;
    await lane.click({ position: { x: box.width * (20 - 5) / (44 - 5), y: 12 } });
    const pixels = () => editor.getByTestId(canvasId).evaluate(el => {
      const ctx = (el as HTMLCanvasElement).getContext('2d')!;
      return Array.from(ctx.getImageData(230, 242, 60, 1).data);
    });
    await expect.poll(async () => (await pixels()).some((v, i) => i % 4 === 3 && v > 120)).toBe(true);
    return pixels();
  };
  await studio.getByRole('button', { name: 'Close', exact: true }).click();
  const editorPixels = await highlightAtFrame20('clip-timeline-lane', 'clip-stage');
  await editor.getByRole('button', { name: 'Clip recordings' }).click();
  expect(await highlightAtFrame20('recording-timeline-lane', 'presentation-animated-overlay')).toEqual(editorPixels);
  const checkFit = async (layer: string) => {
    await expect.poll(() => studio.getByTestId(layer).evaluate(el => {
      const viewport = el.parentElement!.parentElement!.getBoundingClientRect();
      const video = el.parentElement!.querySelector('video')!;
      if (!video.videoWidth || !video.videoHeight) return Infinity;
      const scale = Math.min(viewport.width / video.videoWidth, viewport.height / video.videoHeight);
      const w = video.videoWidth * scale, h = video.videoHeight * scale;
      const r = el.getBoundingClientRect();
      return Math.max(Math.abs(r.width - w), Math.abs(r.height - h),
        Math.abs(r.x - (viewport.x + (viewport.width - w) / 2)), Math.abs(r.y - (viewport.y + (viewport.height - h) / 2)));
    })).toBeLessThan(1);
  };
  await editor.setViewportSize({ width: 1280, height: 620 });
  await checkFit('presentation-animated-overlay');
  await editor.setViewportSize({ width: 600, height: 950 });
  await checkFit('presentation-animated-overlay');
  await studio.getByRole('button', { name: 'Use full clip' }).click();
  await studio.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(studio.getByTestId('presentation-pin-frame')).toBeVisible();
  await editor.setViewportSize({ width: 1280, height: 560 });
  await checkFit('presentation-pin-frame');
  await checkFit('presentation-pin-annotation-overlay');
});

test('tracked highlights move during a take even if the compositor skips the seek frame', async ({ page }) => {
  const { editor, studio } = await openFixtureStudio(page, async () => {
    const file = ['analysis', 'clips', 'clip-sequence', 'clip.json'];
    const clip = await readProjectJson(page, file);
    // Exercise a continuous tracked run rather than the fixture's deliberately hidden correction gaps.
    for (const key of clip.annotations[0].keyframes) key.provenance = 'tracked';
    await writeProjectJson(page, file, clip);
  });
  await studio.getByRole('button', { name: 'Use full clip' }).click();
  await editor.evaluate(() => {
    // Observe the actual ellipse draws, including fast frames between test commands.
    const ellipse = CanvasRenderingContext2D.prototype.ellipse;
    CanvasRenderingContext2D.prototype.ellipse = function (...args) {
      if (this.canvas.dataset.testid === 'presentation-animated-overlay') {
        const xs = this.canvas.dataset.highlightXs ?? '';
        this.canvas.dataset.highlightXs = xs + ' ' + args[0];
      }
      ellipse.apply(this, args);
    };
    // Deliver real decoded frames, but only every fourth one (never frame 5 or 15).
    const schedule = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (cb) {
      const sample: VideoFrameRequestCallback = (now, metadata) => {
        if (Math.round(metadata.mediaTime * 25) % 4 === 0 && metadata.mediaTime > 0.2) cb(now, metadata);
        else schedule.call(this, sample);
      };
      return schedule.call(this, sample);
    };
  });
  const record = studio.getByRole('button', { name: 'Record', exact: true });
  await record.click();
  await expect(studio.getByTestId('presentation-pin-frame')).toBeVisible();
  await expect(studio.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '15');
  const layer = studio.getByTestId('presentation-animated-overlay');
  await layer.evaluate(el => el.removeAttribute('data-highlight-xs'));
  await editor.keyboard.press('Space');
  await expect(studio.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '32');
  await expect(studio.getByTestId('presentation-pin-frame')).toBeVisible();
  const positions = (await layer.getAttribute('data-highlight-xs') ?? '').trim().split(/\s+/).map(Number);
  expect(Math.max(...positions) - Math.min(...positions), 'painted highlight X positions: ' + positions).toBeGreaterThan(25);
  await editor.keyboard.press('Space');
  await expect(studio.getByText('Recording saved.')).toBeVisible();
});

test('records independent clip takes and imports their timings into a recorded presentation', async ({page}) => {
  test.setTimeout(90_000);
  await installOpfsDirectoryPickerFixture(page,path.resolve(process.cwd(),'e2e/fixtures/clip-editor-project'));
  await page.goto('/');
  const annPath=['analysis','clips','clip-sequence','annotations','ann-shape.json'];
  const annotation=await readProjectJson(page,annPath);
  annotation.animations=[{id:'entrance',shapeIds:['shape-poly'],effect:'fade',trigger:'on_click',delayMs:0,durationMs:100}];
  await writeProjectJson(page,annPath,annotation);
  await openPresentation(page,'Breaking the press');
  await page.getByTestId('presentation-slide-slide-clip').click();
  const popup=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Edit clip',exact:true}).click();
  const editor=await popup;
  await editor.getByRole('button',{name:'Clip recordings'}).click();
  const studio=editor.getByRole('dialog',{name:'Clip recordings'});
  const record = studio.getByRole('button', { name: 'Record', exact: true });
  const lane = studio.getByTestId('recording-timeline-lane');
  const last = studio.getByRole('slider', { name: 'Last frame' });
  const canvas = studio.getByTestId('presentation-canvas');
  const seek = async (frame: number) => {
    const box = (await lane.boundingBox())!;
    await editor.mouse.click(box.x + box.width * (frame - 5) / 39, box.y + 12);
    await expect(canvas).toHaveAttribute('data-source-frame', String(frame));
  };
  await studio.getByLabel('Take name').fill('Pressing');
  await expect(record).toBeDisabled();
  await studio.getByRole('button', { name: 'Pin at frame 15' }).click();
  await studio.getByRole('button', { name: 'Set start' }).click();
  await expect(record).toBeDisabled();
  const track = (await lane.boundingBox())!;
  const handle = (await last.boundingBox())!;
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await editor.mouse.move(x, y);
  await editor.mouse.down();
  await editor.mouse.move(x - track.width * (44 - 18) / 39, y, { steps: 8 });
  await editor.mouse.up();
  await expect(last).toHaveAttribute('aria-valuenow', '18');
  await last.press('ArrowRight');
  await expect(canvas).toHaveAttribute('data-source-frame', '19');
  await expect.poll(() => studio.locator('video').evaluate(v => Math.floor((v as HTMLVideoElement).currentTime * 25))).toBe(19);
  await studio.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-source-frame', '19');
  await record.click();
  await expect(studio.getByTestId('presentation-canvas')).toHaveAttribute('data-static-animation-pending-click','true');
  await expect(studio.getByTestId('presentation-pin-frame')).toBeVisible();
  await editor.keyboard.press('Space');
  await expect(studio.getByTestId('presentation-canvas')).toHaveAttribute('data-static-animation-clicks','1');
  await editor.keyboard.press('Space');
  await expect(studio.getByText('Recording saved.')).toBeVisible();
  await studio.getByLabel('Take name').fill('Run only');
  await expect(record).toBeDisabled();
  await studio.getByRole('button', { name: 'Use full clip' }).click();
  await expect(record).toBeEnabled();
  await seek(20);
  await studio.getByRole('button', { name: 'Set start' }).click();
  await seek(24);
  await studio.getByRole('button', { name: 'Set end' }).click();
  await record.click();
  const second=studio.getByRole('listitem').filter({hasText:'Run only'});
  await expect(second).toBeVisible();
  const clip=await readProjectJson(editor,['analysis','clips','clip-sequence','clip.json']);
  expect(clip.recordings).toHaveLength(2);
  expect(clip.startFrame).toBe(5);
  expect(clip.endFrame).toBe(45);
  expect(clip.recordings[1]).toMatchObject({startFrame:20,endFrame:25});
  expect(clip.recordings[0]).toMatchObject({startFrame:15,endFrame:20,pauses:[{pinId:'pin-shape'}]});
  expect(clip.recordings[0].pauses[0].clickTimesMs).toHaveLength(1);
  const first=studio.getByRole('listitem').filter({hasText:'Pressing'});
  await first.getByRole('button',{name:'Export MP4'}).click();
  await expect(studio.getByRole('status')).toContainText('exports/recordings/',{timeout:30_000});
  const mp4=await studio.getByRole('status').innerText();
  const duration=await editor.evaluate(async path=>{
    let dir=await window.showDirectoryPicker();
    const parts=path.split('/');
    for (const p of parts.slice(0,-1)) dir=await dir.getDirectoryHandle(p);
    const file=await (await dir.getFileHandle(parts.at(-1)!)).getFile();
    const v=document.createElement('video');v.src=URL.createObjectURL(file);
    try {await new Promise<void>((res,rej)=>{v.onloadedmetadata=()=>res();v.onerror=rej;});return v.duration;}
    finally {URL.revokeObjectURL(v.src);}
  },mp4);
  expect(Math.abs(duration-(.2+clip.recordings[0].pauses[0].holdMs/1000))).toBeLessThan(.05);
  await editor.close();
  await page.reload();
  await page.getByTestId('presentation-slide-slide-clip').click();
  await page.getByLabel('Import clip timings').selectOption({label:'Pressing'});
  await expect.poll(async()=>(await readProjectJson(page,['presentations','presentation-sequence.json'])).slides[1].range).toEqual({startFrame:15,endFrame:20});
  await page.getByRole('button',{name:'Presentation recordings'}).click();
  const deck=page.getByRole('dialog');
  await deck.getByRole('button',{name:'Record',exact:true}).click();
  await expect(deck.getByTestId('presentation-title-slide')).toBeVisible();
  await deck.getByTestId('presentation-title-slide').click();
  await expect(deck.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame','32',{timeout:10000});
  await expect(deck.getByTestId('presentation-pin-frame')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(deck.getByText('Recording saved.')).toBeVisible();
  const saved=await readProjectJson(page,['presentations','presentation-sequence.json']);
  expect(saved.recordings[0].slides[0].holdMs).toBeGreaterThan(0);
  expect(saved.recordings[0].slides[1].pauseCues[0].clickTimesMs).toEqual(clip.recordings[0].pauses[0].clickTimesMs);
  await deck.getByRole('button',{name:'Replay',exact:true}).click();
  await expect(deck.getByTestId('presentation-title-slide')).toBeVisible();
  await expect(deck.getByRole('button',{name:'Export MP4'})).toBeVisible({timeout:10000});
  await deck.getByRole('button',{name:'Export MP4'}).click();
  await expect(deck.getByRole('status')).toContainText('exports/recordings/',{timeout:30000});
});

test('v2 presentations author clips and pins and play source video frame ranges', async ({ page }) => {
  const fixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');
  await installOpfsDirectoryPickerFixture(page, fixture);
  const exactRequests = await rejectExactPlaybackPreparation(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/');
  const animatedPinDocument = await readProjectJson(page, [
    'analysis', 'clips', 'clip-sequence', 'annotations', 'ann-shape.json',
  ]);
  await writeProjectJson(page, [
    'analysis', 'clips', 'clip-sequence', 'annotations', 'ann-shape.json',
  ], {
    ...animatedPinDocument,
    animations: [{
      id: 'shape-entrance',
      shapeIds: ['shape-poly'],
      effect: 'fade',
      trigger: 'on_click',
      delayMs: 0,
      durationMs: 200,
    }],
  });
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

  await expect(async () => {
    const stored = await readProjectJson(page, ['presentations', 'presentation-sequence.json']);
    expect({
      kinds: stored.slides.map((slide: { kind: string }) => slide.kind),
      transition: stored.transitions[2],
    }).toMatchObject({
      kinds: ['title', 'clip', 'pin', 'pin'],
      transition: { mode: 'match_video', hideAnnotationsDuringPlayback: true },
    });
  }).toPass({ timeout: 5000 });

  await page.getByTestId('presentation-slide-slide-clip').click();
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '5');
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-playback-asset', 'original');
  const editClipPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Edit clip', exact: true }).click();
  const editClipPage = await editClipPagePromise;
  await expect(editClipPage).toHaveURL(/\/clip\/clip-sequence\?projectSession=/);
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
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-static-animation-pending-click', 'true');
  await expect.poll(async () => page.getByTestId('presentation-pin-annotation-overlay').evaluate((canvas) => {
    const pixels = (canvas as HTMLCanvasElement).getContext('2d')?.getImageData(
      0,
      0,
      (canvas as HTMLCanvasElement).width,
      (canvas as HTMLCanvasElement).height,
    ).data;
    if (!pixels) return -1;
    let visiblePixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visiblePixels += 1;
    return visiblePixels;
  })).toBe(0);
  await timeline.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-static-animation-clicks', '1');
  await expect(page.getByTestId('presentation-pin-frame')).toBeVisible();
  await expect.poll(async () => page.getByTestId('presentation-pin-annotation-overlay').evaluate((canvas) => {
    const pixels = (canvas as HTMLCanvasElement).getContext('2d')?.getImageData(
      0,
      0,
      (canvas as HTMLCanvasElement).width,
      (canvas as HTMLCanvasElement).height,
    ).data;
    if (!pixels) return 0;
    let visiblePixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visiblePixels += 1;
    return visiblePixels;
  })).toBeGreaterThan(100);
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
  await expect(page.getByTestId('presentation-present').getByTestId('presentation-canvas')).toHaveAttribute('data-static-animation-clicks', '1');
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
