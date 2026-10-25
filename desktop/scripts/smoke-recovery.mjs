import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { _electron: electron, expect } = createRequire(path.join(root, 'webapp/package.json'))('@playwright/test');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotate-recovery-'));
const project = path.join(temporary, 'Project');
await cp(path.join(root, 'webapp/e2e/fixtures/clip-editor-project'), project, { recursive: true });
const executablePath = process.env.ANNOTATE_TEST_PACKAGED_EXECUTABLE ?? require('electron');
const args = process.env.ANNOTATE_TEST_PACKAGED_EXECUTABLE ? [] : [path.join(root, 'desktop/main.mjs')];
const env = { ...process.env, ANNOTATE_DESKTOP_HEADLESS: '1', ANNOTATE_DESKTOP_TEST_PROJECT: project, ANNOTATE_DESKTOP_USER_DATA: path.join(temporary, 'user-data') };
const resource = 'analysis/clips/clip-sequence/annotations/ann-shape.json';
const layoutKey = 'react-resizable-panels:annotate:clip:viewer-timeline';
let application;
const services = new Set();
async function launch() {
  application = await electron.launch({ executablePath, args, env, timeout: 120000 });
  for (const stream of [application.process().stdout, application.process().stderr]) stream.on('data', (data) => {
    for (const match of data.toString().matchAll(/http:\/\/127\.0\.0\.1:\d+/g)) services.add(match[0]);
  });
  const page = await application.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(20000);
  await expect(page.locator('#app-locale')).toBeVisible();
  services.add(new URL(page.url()).origin);
  return page;
}
async function assertServicesStopped() {
  for (const url of services) await expect.poll(async () => {
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; }
  }, { timeout: 15000 }).toBe(true);
  services.clear();
}
try {
  let home = await launch();
  await home.getByRole('button', { name: 'Open Existing Project', exact: true }).click();
  await expect(home.getByRole('heading', { name: 'Clip editor fixture', exact: true })).toBeVisible();
  const firstOrigin = new URL(home.url()).origin;
  const firstId = await home.evaluate(async () => (await window.annotateDesktop.request('project.restore')).result.id);
  const data = JSON.parse(await readFile(path.join(project, resource), 'utf8'));
  data.shapes[0].name = 'Recovered highlight';
  const saved = await home.evaluate(async ({ resource, data, layoutKey }) => {
    const host = window.annotateDesktop;
    const project = (await host.request('project.restore')).result;
    await host.preferences.setItem(layoutKey, '{"relaunch-test":[70,30]}');
    return host.request('project.command', { ...project, command: 'recovery.write', args: [resource, { data, contentHash: 'newer-recovery-copy', updatedAt: new Date(Date.now() + 1000).toISOString() }] });
  }, { resource, data, layoutKey });
  assert.equal(saved.ok, true);
  await home.locator('#app-locale').selectOption('fr');
  await application.close();
  application = null;
  await assertServicesStopped();

  home = await launch();
  await expect(home.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(home.getByRole('heading', { name: 'Clip editor fixture', exact: true })).toBeVisible();
  const restored = await home.evaluate(async (layoutKey) => ({
    project: (await window.annotateDesktop.request('project.restore')).result,
    layout: window.annotateDesktop.preferences.getItem(layoutKey),
  }), layoutKey);
  assert.notEqual(restored.project.id, firstId);
  assert.equal(restored.layout, '{"relaunch-test":[70,30]}');
  console.log(`Relaunched from ${firstOrigin} to ${new URL(home.url()).origin}; native preferences persisted.`);
  await home.locator('#app-locale').selectOption('en');
  const opened = application.waitForEvent('window');
  await home.evaluate(async () => {
    const host = window.annotateDesktop;
    const project = (await host.request('project.restore')).result;
    const response = await host.request('editor.open', { ...project, target: { clipId: 'clip-sequence', pinId: 'pin-shape' } });
    if (!response.ok) throw new Error(response.error.message);
  });
  const pin = await opened;
  await expect(pin.getByTestId('annotation-recovery')).toBeVisible({ timeout: 30000 });
  await pin.getByRole('button', { name: 'Restore recovery copy', exact: true }).click();
  await expect(pin.getByTestId('annotation-recovery')).toHaveCount(0);
  await expect.poll(async () => JSON.parse(await readFile(path.join(project, resource), 'utf8')).shapes[0].name).toBe('Recovered highlight');
  const closed = pin.waitForEvent('close');
  await pin.getByRole('button', { name: 'Close pin', exact: true }).click();
  await closed;

  const diagnostic = await home.evaluate(async () => (await window.annotateDesktop.request('support.diagnostics')).result);
  assert.equal(diagnostic.app, 'Annotate');
  assert.ok(diagnostic.version);
  assert.equal(JSON.stringify(diagnostic).includes(temporary), false);
  assert.equal(JSON.stringify(diagnostic).includes('Bearer'), false);

  const duplicate = spawn(executablePath, args, { env, stdio: 'ignore' });
  const timeout = setTimeout(() => duplicate.kill('SIGKILL'), 10000);
  const [exitCode] = await once(duplicate, 'exit');
  clearTimeout(timeout);
  assert.equal(exitCode, 0, 'A second launch must exit rather than start a second service set');
  assert.equal(application.windows().length, 1);

  await application.evaluate(({ dialog }) => {
    globalThis.recoveryPrompts = [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.recoveryPrompts.push(options.message);
      return { response: 1, checkboxChecked: false };
    };
  });
  const crashed = home.waitForEvent('crash');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await crashed;
  // Playwright retains a crashed Page flag; inspect the real reloaded Electron
  // webContents instead of silently replacing the app recovery with page.reload().
  await expect.poll(async () => {
    return application.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      if (contents.isCrashed() || contents.isLoading()) return false;
      return contents.executeJavaScript('document.body.innerText.includes("Clip editor fixture")').catch(() => false);
    });
  }, { timeout: 20000 }).toBe(true);
  const prompts = await application.evaluate(() => globalThis.recoveryPrompts);
  assert.ok(prompts.includes('The editor stopped unexpectedly.'));

  const mainProcess = application.process();
  const exited = once(mainProcess, 'exit');
  mainProcess.kill('SIGKILL');
  await exited;
  application = null;
  await assertServicesStopped();
  console.log('Recovery smoke passed: native preferences across new origin/capabilities, actual recovery prompt/restore/save, redacted diagnostics, second-instance refusal, renderer crash/reload, and owned services stop after main-process termination.');
} catch (error) {
  console.error(await application?.evaluate(async ({ BrowserWindow }) => ({ prompts: globalThis.recoveryPrompts, windows: await Promise.all(BrowserWindow.getAllWindows().map(async (window) => ({ url: window.webContents.getURL(), crashed: window.webContents.isCrashed(), loading: window.webContents.isLoading(), text: await window.webContents.executeJavaScript('document.body.innerText').catch((error) => error.message) }))) })).catch(() => 'Main process unavailable'));
  throw error;
} finally {
  await application?.close();
  await rm(temporary, { recursive: true, force: true });
}
