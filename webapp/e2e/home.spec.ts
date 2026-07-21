import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  installDirectoryPickerFixture,
  installOpfsDirectoryPickerFixture,
} from './support/fsAccessFixture';

const SIDECAR_PORT = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

async function installVideoFilePicker(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        kind: 'file',
        name: 'source.mp4',
        async getFile() {
          return new File(['source-video'], 'source.mp4', { type: 'video/mp4' });
        },
      }],
    });
  });
}

test('opens a valid project and shows frame-native dashboard counts', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();

  await expect(page.getByRole('heading', { name: 'Clip editor fixture' })).toBeVisible();
  await expect(page.getByTestId('stat-videos')).toContainText('1');
  await expect(page.getByTestId('stat-clips')).toContainText('1');
  await expect(page.getByTestId('stat-presentations')).toContainText('1');
  await expect(page.getByTestId('integrity-summary')).toContainText('0 errors · 0 warnings');
});

test('restores a persisted handle after refresh under the canonical key', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByRole('heading', { name: 'Clip editor fixture' })).toBeVisible();

  const keys = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('annotate-db', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = database.transaction('handles', 'readonly').objectStore('handles').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(keys).toContain('project');
  expect(keys).not.toContain('project-v2');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clip editor fixture' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Existing Project' })).toHaveCount(0);
});

test('refuses a v1 project without populating project state', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/project-v1'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();

  await expect(page.getByText(/created by Annotate 0\.1/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('opens a broken graph and surfaces its informational integrity report', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/broken-project'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();

  await expect(page.getByRole('heading', { name: 'Broken integrity fixture' })).toBeVisible();
  await expect(page.locator('[data-integrity-code="unresolved-clip-video"]')).toBeVisible();
  await expect(page.locator('[data-integrity-code="annotation-anchor-mismatch"]')).toBeVisible();
  await expect(page.locator('[data-integrity-code="orphan-annotation-document"]')).toBeVisible();
  await expect(page.locator('[data-integrity-code="unresolved-presentation-clip"]')).toBeVisible();
});

test('creates a project in a new named child folder', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/create-parent'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Create New Project' }).click();
  await page.getByRole('button', { name: 'Create project folder...' }).click();

  await expect(page.getByRole('heading', { name: 'MyMatch' })).toBeVisible();
  await expect(page.getByTestId('stat-videos')).toContainText('0');
  const created = await page.evaluate(async () => {
    const parent = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const project = await parent.getDirectoryHandle('MyMatch', { create: false });
    const manifest = JSON.parse(await (await project.getFileHandle('project.json')).getFile().then((file) => file.text()));
    const board = await project.getFileHandle('tagging-board.json', { create: false });
    return { schema: manifest.schema, board: board.kind };
  });
  expect(created).toEqual({ schema: 'project.v2', board: 'file' });
});

test('refuses to overwrite a non-empty project destination', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/nonempty-create-parent'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Create New Project' }).click();
  await page.getByRole('button', { name: 'Create project folder...' }).click();

  await expect(page.getByText(/requires an empty folder/)).toBeVisible();
  const existing = await page.evaluate(async () => {
    const parent = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const project = await parent.getDirectoryHandle('MyMatch', { create: false });
    return (await project.getFileHandle('existing.txt')).getFile().then((file) => file.text());
  });
  expect(existing).toContain('must not be overwritten');
});

test('shows import progress and leaves a new project untouched when metadata is absent', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/create-parent'),
  );
  await installVideoFilePicker(page);
  let statusReads = 0;
  await page.route(`${SIDECAR_BASE_URL}/video/normalize/**`, async (route) => {
    const request = route.request();
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
    if (request.url().endsWith('/start')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ jobId: 'playwright-normalize-job' }),
      });
      return;
    }
    if (request.url().endsWith('/file')) {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: corsHeaders,
        body: 'normalized-without-headers',
      });
      return;
    }
    if (request.method() === 'DELETE') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: '{}' });
      return;
    }
    statusReads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(statusReads === 1
        ? { jobId: 'playwright-normalize-job', status: 'normalizing', progress: 0.5 }
        : { jobId: 'playwright-normalize-job', status: 'complete', progress: 1 }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create New Project' }).click();
  await page.getByRole('button', { name: 'Create project folder...' }).click();
  await page.getByLabel('Project controls').getByRole('button', { name: 'Import video…' }).click();

  await expect(page.getByLabel('Video import progress')).toContainText('Converting to the requested media contract');
  await expect(page.getByText(/authoritative media metadata/)).toBeVisible();
  const stored = await page.evaluate(async () => {
    const parent = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const project = await parent.getDirectoryHandle('MyMatch');
    const manifest = JSON.parse(await (await project.getFileHandle('project.json')).getFile().then((file) => file.text()));
    const media = await project.getDirectoryHandle('media');
    const mediaEntries: string[] = [];
    for await (const [name] of media.entries()) mediaEntries.push(name);
    return { videos: manifest.videos, mediaEntries };
  });
  expect(stored).toEqual({ videos: [], mediaEntries: [] });
});

test('preserves a compatible video with its own FPS and resolution', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/create-parent'),
  );
  await installVideoFilePicker(page);
  let statusReads = 0;
  await page.route(`${SIDECAR_BASE_URL}/video/normalize/**`, async (route) => {
    const request = route.request();
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
    if (request.url().endsWith('/start')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ jobId: 'playwright-preserve-job' }),
      });
      return;
    }
    if (request.method() === 'DELETE') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: '{}' });
      return;
    }
    statusReads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(statusReads === 1
        ? { jobId: 'playwright-preserve-job', status: 'analyzing', progress: 1 }
        : {
          jobId: 'playwright-preserve-job',
          status: 'complete',
          progress: 1,
          metadata: {
            fps: 25,
            frameCount: 250,
            width: 1280,
            height: 720,
            durationMs: 10000,
            frameCountSource: 'probe',
            importStrategy: 'preserve',
          },
        }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create New Project' }).click();
  await expect(page.getByLabel('FPS')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create project folder...' }).click();
  await page.getByLabel('Project controls').getByRole('button', { name: 'Import video…' }).click();

  await expect(page.getByText('250 frames · 25 fps · 1,280×720')).toBeVisible();
  const stored = await page.evaluate(async () => {
    const parent = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    const project = await parent.getDirectoryHandle('MyMatch');
    const manifest = JSON.parse(await (await project.getFileHandle('project.json')).getFile().then((file) => file.text()));
    const media = await project.getDirectoryHandle('media');
    const file = await (await media.getFileHandle('source.mp4')).getFile();
    return {
      topLevelFps: manifest.fps ?? null,
      topLevelResolution: manifest.resolution ?? null,
      video: manifest.videos[0],
      media: await file.text(),
    };
  });
  expect(stored).toMatchObject({
    topLevelFps: null,
    topLevelResolution: null,
    video: { fps: 25, frameCount: 250, width: 1280, height: 720, frameCountSource: 'probe' },
    media: 'source-video',
  });
});
