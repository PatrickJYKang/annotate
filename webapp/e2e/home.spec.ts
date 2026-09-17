import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
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

for (const action of ['cancel', 'close project', 'navigate', 'reload'] as const) {
  test(`releases a queued import on ${action} without leaving overlapping status text`, async ({ page }) => {
    await installDirectoryPickerFixture(page, path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'));
    await installVideoFilePicker(page);
    let deleted = 0;
    // A real HTTP peer is needed here: browser-owned keepalive requests during
    // unload are not reliably observable through Playwright route interception.
    const sidecar = createServer((request, response) => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      };
      request.resume();
      if (request.method === 'DELETE') deleted += 1;
      response.writeHead(request.method === 'OPTIONS' ? 204 : 200, { ...headers, 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jobId: 'queued-import', status: 'queued', progress: 0 }));
    });
    sidecar.listen(0, '127.0.0.1');
    await once(sidecar, 'listening');
    const address = sidecar.address() as { port: number };
    await page.addInitScript((baseUrl) => { window.__SIDECAR_URL = baseUrl; }, `http://127.0.0.1:${address.port}`);
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Open Existing Project' }).click();
      await page.getByLabel('Project controls').getByRole('button', { name: 'Import video…' }).click();
      const progress = page.getByLabel('Video import progress');
      await expect(progress).toContainText('Waiting for another import to finish');
      await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '0.35');
      await expect(page.locator('.toast')).toHaveCount(0);
      await expect(page.getByText('Preparing source.mp4…', { exact: true })).toHaveCount(0);

      if (action === 'cancel') await progress.getByRole('button', { name: 'Cancel' }).click();
      else if (action === 'close project') await page.getByRole('button', { name: 'Close project' }).click();
      else if (action === 'navigate') await page.getByRole('link', { name: 'User guide' }).click();
      else await page.reload();

      await expect.poll(() => deleted).toBe(1);
      await expect(page.getByLabel('Video import progress')).toHaveCount(0);
    } finally {
      sidecar.close();
      sidecar.closeAllConnections();
    }
  });
}

test('estimates import time from live step progress and resets for the next step', async ({ page }) => {
  await installDirectoryPickerFixture(page, path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'));
  await installVideoFilePicker(page);
  let started = 0;
  let phase = 'transcoding';
  await page.route('**/video/normalize/start', (route) => {
    started = Date.now();
    return route.fulfill({ json: { jobId: 'eta-import' } });
  });
  await page.route('**/video/normalize/eta-import', (route) => route.fulfill({ json: {
    jobId: 'eta-import', status: phase,
    progress: phase === 'transcoding' ? Math.min(0.8, (Date.now() - started) / 20_000) : 0,
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByLabel('Project controls').getByRole('button', { name: 'Import video…' }).click();
  const estimate = page.getByTestId('import-time-estimate');
  await expect(estimate).toHaveText(/About \d+:\d{2} remaining in this step/);
  phase = 'probing';
  await expect(estimate).toHaveText('Estimating remaining time...');
  await page.getByLabel('Video import progress').getByRole('button', { name: 'Cancel' }).click();
  await expect(estimate).toHaveCount(0);
});

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

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('annotate-db', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const handle = await new Promise<FileSystemDirectoryHandle>((resolve, reject) => {
        const request = database.transaction('handles', 'readonly').objectStore('handles').get('project');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = database.transaction('handles', 'readonly').objectStore('handles').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const manifest = JSON.parse(await (await (await handle.getFileHandle('project.json')).getFile()).text());
      return { keys, kind: handle.kind, schema: manifest.schema };
    } finally {
      database.close();
    }
  });
  expect(stored.keys).toContain('project');
  expect(stored.keys).not.toContain('project-v2');
  expect(stored.kind).toBe('directory');
  expect(stored.schema).toBe('project.v2');

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
