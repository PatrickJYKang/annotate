import { cp, mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { _electron: electron, expect } = createRequire(path.join(root, 'webapp/package.json'))('@playwright/test');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotate-electron-'));
const project = path.join(temporary, 'Project');
const artifacts = path.join(root, 'desktop/artifacts');
await mkdir(artifacts, { recursive: true });
await cp(path.join(root, 'webapp/e2e/fixtures/clip-editor-project'), project, { recursive: true });
const clipPath = path.join(project, 'analysis/clips/clip-sequence/clip.json');
const readClip = async () => JSON.parse(await readFile(clipPath, 'utf8'));
let application;
const errors = [];
const services = new Set();
function recordServices(data) {
  for (const match of data.toString().matchAll(/http:\/\/127\.0\.0\.1:\d+/g)) services.add(match[0]);
}
try {
  const packaged = process.env.ANNOTATE_TEST_PACKAGED_EXECUTABLE;
  application = await electron.launch({ executablePath: packaged ?? require('electron'), args: packaged ? [] : [path.join(root, 'desktop/main.mjs')], timeout: 120_000,
    env: { ...process.env, ANNOTATE_DESKTOP_HEADLESS: '1', ANNOTATE_DESKTOP_TEST_PROJECT: project,
      ANNOTATE_DESKTOP_TEST_VIDEO: path.join(project, 'media/retrieval-sample.mp4'), ANNOTATE_DESKTOP_USER_DATA: path.join(temporary, 'user-data') } });
  application.process().stderr.on('data', (data) => { process.stderr.write(data); recordServices(data); });
  application.process().stdout.on('data', (data) => {
    process.stdout.write(data);
    recordServices(data);
  });
  application.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const home = await application.firstWindow({ timeout: 120_000 });
  home.setDefaultTimeout(20_000);
  home.on('pageerror', (error) => errors.push(error.message));
  await expect(home.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  assert.deepEqual(await home.evaluate(() => ({ bridge: !!window.annotateDesktop, node: typeof window.require })), { bridge: true, node: 'undefined' });
  await home.getByRole('button', { name: 'Open Existing Project', exact: true }).click();
  await expect(home.getByRole('heading', { name: 'Clip editor fixture', exact: true })).toBeVisible();
  await home.getByRole('button', { name: 'Import video…', exact: true }).first().click();
  await expect(home.getByText('Imported retrieval-sample.mp4', { exact: false })).toBeVisible({ timeout: 30_000 });
  const importedManifest = JSON.parse(await readFile(path.join(project, 'project.json'), 'utf8'));
  assert.equal(importedManifest.videos.length, 2);
  assert.equal(importedManifest.videos[1].fps, 25);
  assert.equal(importedManifest.videos[1].frameCount, 50);
  assert.deepEqual(await readFile(path.join(project, importedManifest.videos[1].file)), await readFile(path.join(project, 'media/retrieval-sample.mp4')));
  await home.getByRole('button', { name: 'Open capture player' }).click();
  await home.getByTestId('clip-tree-row-clip-sequence').click();
  const opened = application.waitForEvent('window');
  await home.getByRole('button', { name: 'Open editor', exact: true }).click();
  const editor = await opened;
  editor.setDefaultTimeout(20_000);
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  await editor.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.match(await editor.locator('video').getAttribute('src'), /^http:\/\/127\.0\.0\.1:/);
  await editor.getByRole('button', { name: 'Step forward', exact: true }).click();
  await expect(editor.getByText(/Frame 6 · clip 5–44/)).toBeVisible();
  const before = (await readClip()).annotations.length;
  await editor.getByRole('button', { name: 'Highlight', exact: true }).click();
  const stage = await editor.getByTestId('clip-stage').boundingBox();
  assert.ok(stage);
  await editor.mouse.click(stage.x + stage.width * 0.65, stage.y + stage.height * 0.6);
  await expect.poll(async () => (await readClip()).annotations.length).toBe(before + 1);
  await editor.reload();
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  await editor.getByRole('button', { name: 'Pin at frame 15', exact: true }).click();
  const pinOpened = application.waitForEvent('window');
  await editor.getByRole('button', { name: 'Open pin at f15', exact: true }).click();
  const pin = await pinOpened;
  pin.setDefaultTimeout(20_000);
  const annotator = pin.getByTestId('pin-annotator');
  await expect(annotator).toBeVisible();
  await expect(annotator.getByText('At pin frame; annotations editable')).toBeVisible();
  const documentPath = path.join(project, 'analysis/clips/clip-sequence/annotations', `${(await readClip()).pins.find((p) => p.frame === 15).annotations[0].id}.json`);
  const original = JSON.parse(await readFile(documentPath, 'utf8')).shapes.length;
  await annotator.getByRole('button', { name: 'Highlight', exact: true }).click();
  const canvas = await annotator.locator('canvas').last().boundingBox();
  assert.ok(canvas);
  await pin.mouse.click(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.6);
  await expect(annotator.getByLabel('Name', { exact: true })).toBeVisible();
  // Close before the debounce fires: this must flush the real pin repository write.
  const closed = pin.waitForEvent('close');
  await annotator.getByRole('button', { name: 'Close pin', exact: true }).click();
  await closed;
  assert.equal(JSON.parse(await readFile(documentPath, 'utf8')).shapes.length, original + 1);
  const boundary = await editor.evaluate(async () => {
    const host = window.annotateDesktop;
    const root = (await host.request('project.restore')).result;
    const check = async (operation, input) => !(await host.request(operation, input)).ok;
    return {
      outside: await check('fs.file', { ...root, path: '../outside.txt' }),
      foreign: await check('fs.list', { ...root, id: 'not-my-project' }),
      authoritative: await check('fs.write', { ...root, path: 'project.json', bytes: new Uint8Array([123, 125]) }),
      unknown: await check('shell.run', { command: 'echo unsafe' }),
    };
  });
  assert.deepEqual(boundary, { outside: true, foreign: true, authoritative: true, unknown: true });
  const staleEdit = await home.evaluate(async () => {
    const host = window.annotateDesktop;
    const root = (await host.request('project.restore')).result;
    const description = (await host.request('fs.file', { ...root, path: 'analysis/clips/clip-sequence/clip.json' })).result;
    const latest = JSON.parse(new TextDecoder().decode(description.bytes));
    return host.request('project.command', { ...root, command: 'clip.patch', args: [latest.id, latest, { ...latest, annotations: latest.annotations.slice(0, -1) }] });
  });
  assert.equal(staleEdit.ok, false);
  assert.match(staleEdit.error.message, /Save conflict/);
  const detectionResponse = editor.waitForResponse((response) => response.url().endsWith('/track/detect') && response.request().method() === 'POST', { timeout: 60_000 });
  await editor.getByRole('button', { name: 'Track', exact: true }).click();
  const detection = await detectionResponse;
  assert.equal(detection.status(), 200, await detection.text());
  assert.ok(Array.isArray((await detection.json()).detections));
  await editor.getByRole('button', { name: 'Stop', exact: true }).click();
  const canceled = await home.evaluate(async () => {
    const host = window.annotateDesktop;
    const root = (await host.request('project.restore')).result;
    const file = (await host.request('fs.file', { ...root, path: 'media/retrieval-sample.mp4' })).result;
    const requestId = crypto.randomUUID();
    const pending = host.request('project.command', { ...root, command: 'video.import', args: [file.id, requestId] });
    await host.request('video.cancelImport', { requestId });
    return pending;
  });
  assert.equal(canceled.ok, false);
  assert.equal(canceled.error.name, 'AbortError');
  assert.equal(JSON.parse(await readFile(path.join(project, 'project.json'), 'utf8')).videos.length, 2);
  await home.goto(new URL('/', home.url()).href);
  await home.getByRole('button', { name: 'Export report…', exact: true }).click();
  await expect(home.getByText('Report exported to exports/report/.', { exact: true })).toBeVisible();
  const png = await readFile(path.join(project, 'exports/report/annotated/clip-sequence-f15-pin-shape-ann-shape.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await home.getByTestId('presentation-card-presentation-sequence').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(home.getByTestId('presentation-editor')).toBeVisible();
  await home.getByLabel('Template').selectOption('divider');
  await expect.poll(async () => JSON.parse(await readFile(path.join(project, 'presentations/presentation-sequence.json'), 'utf8')).slides[0].template).toBe('divider');
  await home.getByTestId('presentation-slide-slide-clip').click();
  await expect(home.getByTestId('presentation-canvas')).toHaveAttribute('data-source-frame', '5');
  await home.waitForFunction(() => {
    const video = document.querySelector('[data-testid="presentation-canvas"] video');
    return video?.readyState >= 2 && !video.seeking;
  });
  await home.getByTestId('presentation-timeline').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(home.getByTestId('presentation-pin-frame')).toBeVisible({ timeout: 15_000 });
  await home.getByRole('button', { name: 'Edit clip', exact: true }).click();
  assert.equal(application.windows().length, 2, 'Opening an existing clip must focus its window');
  await editor.screenshot({ path: path.join(artifacts, 'native-clip-editor.png') });
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: native project opening/import/cancel, editor/pin windows, range-backed video, seek/drawing, persistence/reload, close-time autosave, real detection request, report PNG export, presentation save/playback, deduplication, stale-write conflicts and IPC denial checks.');
} catch (error) {
  for (const [index, page] of (application?.windows() ?? []).entries()) {
    console.error(`Window ${index}: ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 8000)}`);
    await page.screenshot({ path: path.join(artifacts, `failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await application?.close();
  for (const url of services) {
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }), `Owned service still responds after quit: ${url}`);
  }
  await rm(temporary, { recursive: true, force: true });
}
