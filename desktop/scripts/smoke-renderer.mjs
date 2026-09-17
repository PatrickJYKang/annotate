import { access, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ServiceSupervisor } from '../core/service-supervisor.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'webapp/.next-desktop/standalone');
await access(path.join(source, 'server.js'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotate-standalone-'));
const supervisor = new ServiceSupervisor();
const { chromium } = createRequire(path.join(root, 'webapp/package.json'))('@playwright/test');
const withSidecar = process.argv.includes('--with-sidecar');

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function fixtureFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await fixtureFiles(file, `${relative}/`));
    else files.push({ path: relative, base64: (await readFile(file)).toString('base64') });
  }
  return files;
}

let browser;
try {
  await cp(source, temporary, { recursive: true });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const services = [];
  let runtime;
  if (withSidecar) {
    const helper = path.join(temporary, 'helper');
    const temp = path.join(temporary, 'service-temp');
    await mkdir(temp);
    await cp(path.join(root, 'sidecar/annotate_sidecar'), path.join(helper, 'annotate_sidecar'), {
      recursive: true, filter: (file) => !file.includes('__pycache__'),
    });
    const python = process.env.ANNOTATE_SIDECAR_PYTHON ?? path.join(root, 'sidecar/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    await access(python);
    const sidecarPort = await availablePort();
    const token = randomBytes(32).toString('hex');
    runtime = { version: 1, host: 'desktop', sidecar: { baseUrl: `http://127.0.0.1:${sidecarPort}`, token } };
    services.push({
      id: 'sidecar', command: python, args: ['-m', 'annotate_sidecar', '--port', String(sidecarPort)], cwd: temporary,
      env: {
        ...process.env, PYTHONPATH: helper, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
        ANNOTATE_AUTH_TOKEN: token, ANNOTATE_ALLOWED_ORIGINS: origin,
        TMPDIR: temp, TMP: temp, TEMP: temp,
      },
      ready: async (signal) => (await fetch(`${runtime.sidecar.baseUrl}/health`, { signal, headers: { Authorization: `Bearer ${token}` } })).status === 200,
    });
  }
  supervisor.on('log', ({ stream, text }) => { if (stream === 'stderr') process.stderr.write(text); });
  services.push({
    id: 'standalone-renderer', command: process.execPath,
    args: [path.join(temporary, 'server.js')], cwd: temporary,
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', NODE_PATH: '' },
    ready: async (signal) => (await fetch(origin, { signal })).status === 200,
  });
  await supervisor.start(services, { timeoutMs: 60000 });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  if (runtime) await page.addInitScript((configuration) => { window.__ANNOTATE_RUNTIME__ = configuration; }, runtime);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create New Project' }).click();
  await page.getByRole('button', { name: 'Create project folder...' }).waitFor();
  await page.goto(`${origin}/userguide`);
  await page.getByRole('heading', { name: 'Annotate User Guide', exact: true }).waitFor();
  if (runtime) {
    assert.equal((await fetch(`${runtime.sidecar.baseUrl}/health`)).status, 401);
    assert.equal((await fetch(`${runtime.sidecar.baseUrl}/health`, { headers: { Origin: 'https://example.com', Authorization: `Bearer ${runtime.sidecar.token}` } })).status, 403);
    await page.goto(origin);
    await page.evaluate(async (files) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('smoke-project', { create: true });
      for (const file of files) {
        const segments = file.path.split('/');
        const name = segments.pop();
        let parent = directory;
        for (const segment of segments) parent = await parent.getDirectoryHandle(segment, { create: true });
        const writer = await (await parent.getFileHandle(name, { create: true })).createWritable();
        await writer.write(Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)));
        await writer.close();
      }
      window.showDirectoryPicker = async () => directory;
    }, await fixtureFiles(path.join(root, 'webapp/e2e/fixtures/clip-editor-project')));
    await page.getByRole('button', { name: 'Open Existing Project', exact: true }).click();
    await page.getByRole('heading', { name: 'Clip editor fixture', exact: true }).waitFor();
    const health = page.waitForResponse((response) => response.url() === `${runtime.sidecar.baseUrl}/health` && response.request().method() === 'GET');
    const registration = page.waitForResponse((response) => response.url() === `${runtime.sidecar.baseUrl}/video/register` && response.request().method() === 'POST');
    await page.goto(`${origin}/clip/clip-sequence`);
    for (const response of [await health, await registration]) {
      assert.equal(response.status(), 200);
      assert.equal(await response.request().headerValue('authorization'), `Bearer ${runtime.sidecar.token}`);
    }
    await page.locator('video').waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    console.log('Managed sidecar passed authentication, CORS, real clip-editor health polling, source-video registration, and video loading.');
  }
  assert.deepEqual(errors, []);
  console.log('Standalone renderer passed real Chromium startup, hydration, project setup, and user-guide checks outside the checkout.');
} finally {
  await browser?.close();
  await supervisor.stop();
  await rm(temporary, { recursive: true, force: true });
}
