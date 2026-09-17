import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { openAsBlob, createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeProjectStore, validateRelativePath } from './core/project-store.mjs';
import { repositoryDirectory, serialized } from './core/repository-directory.mjs';
import { ServiceSupervisor } from './core/service-supervisor.mjs';
import { startMediaServer } from './core/media-server.mjs';
import { startSidecarProxy } from './core/sidecar-proxy.mjs';
import { resolveResourceLayout, sidecarEnvironment } from './core/resource-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const domain = require('./dist/domain-service.cjs');
const store = new NativeProjectStore();
const supervisor = new ServiceSupervisor();
const windows = new Map();
const editorWindows = new Map();
let rendererOrigin, sidecarUrl, sidecarToken, media, proxy, boardSource;
let quitting = false;
let shuttingDown = false;
let shutdownComplete = false;
let recent = null;
let startupWindow;
let serviceLog;
app.setName('Annotate');
if (process.env.ANNOTATE_DESKTOP_USER_DATA) app.setPath('userData', process.env.ANNOTATE_DESKTOP_USER_DATA);
const settingsPath = path.join(app.getPath('userData'), 'recent-project.json');

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function upstream(route, data, method) {
  const response = await fetch(`${sidecarUrl}${route}`, {
    method: method ?? (data ? 'POST' : 'GET'), redirect: 'error',
    headers: { Authorization: `Bearer ${sidecarToken}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok) throw new Error(`Local service failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

function stateFor(event, bootstrap = false) {
  const state = windows.get(event.sender.id);
  if (!state || event.senderFrame !== event.sender.mainFrame) throw new Error('Unrecognized application window.');
  const url = event.senderFrame.url;
  if (!(bootstrap && (!url || url === 'about:blank')) && new URL(url).origin !== rendererOrigin) throw new Error('Untrusted application page.');
  return state;
}

function authorizedDirectory(state, input) {
  if (!input || !state.grants.has(input.id) || typeof input.path !== 'string') throw new Error('This window does not own that project.');
  if (input.path) validateRelativePath(input.path);
  return repositoryDirectory(store, input.id, input.path, input.name);
}

function writableAuxiliary(relative) {
  const [first] = validateRelativePath(relative);
  if (!['exports', 'cache', 'homography-cache', 'derived-media'].includes(first)) throw new Error('Use a project command to modify authoritative data.');
}

async function describeFile(state, id, relative) {
  const stat = await store.statPath(id, relative);
  const name = path.posix.basename(relative);
  if (!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name)) {
    if (stat.size > 64 * 1024 * 1024) throw new Error('Document/image is too large.');
    const document = name.endsWith('.json') ? await store.readDocument(id, relative) : null;
    const bytes = document ? Buffer.from(document.text) : await readFile(await store.resolvePath(id, relative));
    const key = `${id}/${relative}`;
    // A repository's read-latest call must not silently replace the editor's
    // original revision and make stale content look current.
    if (document && !state.revisions.has(key)) {
      state.revisions.set(key, document.revision);
      state.baselines.set(key, JSON.parse(document.text));
    }
    return { ...stat, name, bytes: new Uint8Array(bytes) };
  }
  const key = `${id}/${relative}`;
  let file = state.mediaByPath.get(key);
  if (!file) {
    const capability = await media.register(id, relative);
    file = { ...capability, projectId: id, relative };
    state.files.set(file.id, file);
    state.mediaByPath.set(key, file);
  }
  return { ...stat, name, id: file.id, url: file.url };
}

async function registerMedia(state, fileId) {
  const file = state.files.get(fileId);
  if (!file) throw new Error('This window does not own the source video.');
  const registered = await upstream('/native/register', { path: await store.resolvePath(file.projectId, file.relative) });
  state.connection.addRef(registered.videoRef);
  return registered;
}

async function importVideo(state, input, fileId, requestId) {
  if (typeof requestId !== 'string' || state.imports.has(requestId)) throw new Error('Invalid import request.');
  const file = state.files.get(fileId);
  if (!file) throw new Error('Select a source video first.');
  const controller = new AbortController();
  state.imports.set(requestId, controller);
  let registered, job;
  const progress = (phase, value) => { if (!state.window.isDestroyed()) state.window.webContents.send('annotate:progress', { requestId, phase, progress: value }); };
  try {
    registered = await registerMedia(state, fileId);
    controller.signal.throwIfAborted();
    job = await upstream('/native/import', { videoRef: registered.videoRef });
    while (true) {
      controller.signal.throwIfAborted();
      const status = await upstream(`/video/normalize/${job.jobId}`);
      if (state.window.isDestroyed()) throw new Error('Import window closed.');
      progress(status.status === 'complete' ? 'probing' : status.status, status.progress);
      if (status.status === 'failed' || status.status === 'canceled') throw new Error(status.error || 'Import failed.');
      if (status.status === 'complete') break;
      await delay(200);
    }
    const result = await upstream(`/native/import/${job.jobId}/result`);
    const directory = authorizedDirectory(state, input);
    return await serialized(`commands:${input.id}`, async () => {
      controller.signal.throwIfAborted();
      let destination;
      let video;
      try {
        const manifest = await domain.manifests.mutateProjectManifestExclusive(directory, async (latest) => {
          const mediaDirectory = await directory.getDirectoryHandle('media');
          const stem = path.parse(file.relative).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'video';
          const used = new Set((await store.listDirectory(input.id, input.path ? `${input.path}/media` : 'media')).map((entry) => entry.name.toLowerCase()));
          let name = `${stem}.mp4`, index = 1;
          while (used.has(name.toLowerCase())) name = `${stem}-${index++}.mp4`;
          destination = name;
          const targetPath = `${input.path ? `${input.path}/` : ''}media/${name}`;
          progress('copying', 0);
          let lastProgress = 0;
          await store.writeBlob(input.id, targetPath, await openAsBlob(result.path), {
            signal: controller.signal,
            onProgress: (value) => { if (value === 1 || value - lastProgress >= 0.01) { lastProgress = value; progress('copying', value); } },
          });
          controller.signal.throwIfAborted();
          const m = result.metadata;
          video = { id: `video-${randomUUID()}`, label: path.basename(file.relative), file: `media/${name}`, fps: m.fps, frameCount: m.frameCount, frameCountSource: m.frameCountSource, width: m.width, height: m.height };
          return { ...latest, videos: [...latest.videos, video] };
        });
        return { manifest, video };
      } catch (error) {
        if (destination) await (await directory.getDirectoryHandle('media')).removeEntry(destination).catch(() => {});
        throw error;
      }
    });
  } finally {
    state.imports.delete(requestId);
    if (job) await upstream(`/video/normalize/${job.jobId}`, null, 'DELETE').catch(() => {});
    if (registered) {
      await upstream(`/video/${registered.videoRef}`, null, 'DELETE').catch(() => {});
      state.connection.removeRef(registered.videoRef);
    }
  }
}

async function projectCommand(state, input) {
  const directory = authorizedDirectory(state, input);
  if (input.command === 'video.import') return importVideo(state, input, input.args?.[0], input.args?.[1]);
  return serialized(`commands:${input.id}`, async () => {
    let args = input.args;
    const patchPath = input.command === 'clip.patch' ? `analysis/clips/${args?.[0]}/clip.json`
      : input.command === 'project.patch' ? 'project.json' : null;
    const patchKey = patchPath ? `${input.id}/${input.path ? `${input.path}/` : ''}${patchPath}` : null;
    if (patchKey) {
      const original = state.baselines.get(patchKey);
      if (!original) throw new Error('Read the document before editing it.');
      const base = input.command === 'clip.patch' ? args[1] : args[0];
      const next = input.command === 'clip.patch' ? args[2] : args[1];
      // Preserve the original values only for fields the renderer is changing.
      const expected = { ...base };
      for (const field of new Set([...Object.keys(base), ...Object.keys(next)])) {
        if (JSON.stringify(base[field]) !== JSON.stringify(next[field])) {
          if (JSON.stringify(base[field]) !== JSON.stringify(original[field])) throw new Error(`Save conflict: ${field} changed since this window loaded it. Reload before saving.`);
          expected[field] = original[field];
        }
      }
      args = input.command === 'clip.patch' ? [args[0], expected, next] : [expected, next];
    }
    const document = input.args?.[0];
    const relative = input.command === 'annotation.save' ? `analysis/clips/${document?.clipId}/annotations/${document?.annotationId}.json`
      : input.command === 'presentation.save' ? `presentations/${document?.id}.json` : null;
    const key = relative ? `${input.id}/${input.path ? `${input.path}/` : ''}${relative}` : null;
    if (relative) {
      let current = null;
      try { current = (await store.readDocument(input.id, input.path ? `${input.path}/${relative}` : relative)).revision; } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
      if (current !== (state.revisions.get(key) ?? null)) throw new Error('Save conflict: this document changed in another window. Reload before saving.');
    }
    const result = await domain.runDomainCommand(directory, input.command, args, boardSource);
    if (patchKey) state.baselines.set(patchKey, result);
    if (relative) state.revisions.set(key, (await store.readDocument(input.id, input.path ? `${input.path}/${relative}` : relative)).revision);
    for (const other of windows.values()) if (other.grants.has(input.id)) other.window.webContents.send('annotate:changed', input.id);
    return result;
  });
}

async function dispatch(state, operation, input) {
  switch (operation) {
    case 'dialog.directory': {
      const chosen = process.env.ANNOTATE_DESKTOP_TEST_PROJECT ? { canceled: false, filePaths: [process.env.ANNOTATE_DESKTOP_TEST_PROJECT] }
        : await dialog.showOpenDialog(state.window, { properties: ['openDirectory', 'createDirectory'] });
      if (chosen.canceled) throw new DOMException('Folder selection canceled.', 'AbortError');
      const project = await store.registerProject(chosen.filePaths[0]);
      state.grants.add(project.id);
      return { ...project, path: '' };
    }
    case 'dialog.video': {
      const chosen = process.env.ANNOTATE_DESKTOP_TEST_VIDEO ? { canceled: false, filePaths: [process.env.ANNOTATE_DESKTOP_TEST_VIDEO] }
        : await dialog.showOpenDialog(state.window, { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }] });
      if (chosen.canceled) return null;
      const project = await store.registerProject(path.dirname(chosen.filePaths[0]));
      // A video chooser authorizes only this file, not renderer directory access.
      return describeFile(state, project.id, path.basename(chosen.filePaths[0]));
    }
    case 'project.remember': {
      authorizedDirectory(state, input);
      const absolute = await store.resolvePath(input.id, input.path);
      const opened = await store.registerProject(absolute);
      state.grants.add(opened.id);
      state.project = { ...opened, path: '' };
      recent = absolute;
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ path: absolute }));
      return state.project;
    }
    case 'project.restore': {
      if (state.project) return state.project;
      if (!recent || state.explicitProject) return null;
      const project = await store.registerProject(recent);
      state.grants.add(project.id);
      return state.project = { ...project, path: '' };
    }
    case 'project.forget': state.project = null; state.explicitProject = true; return null;
    case 'project.command': return projectCommand(state, input);
    case 'fs.list': authorizedDirectory(state, input); return store.listDirectory(input.id, input.path);
    case 'fs.ensure': {
      authorizedDirectory(state, input);
      if (input.create) {
        if (input.kind === 'directory') await store.ensureDirectory(input.id, input.path);
        else { writableAuxiliary(input.path); await store.ensureFile(input.id, input.path); }
      }
      if ((await store.statPath(input.id, input.path)).kind !== input.kind) throw new DOMException('Wrong entry type.', 'TypeMismatchError');
      return null;
    }
    case 'fs.file': authorizedDirectory(state, input); return describeFile(state, input.id, input.path);
    case 'fs.write':
      authorizedDirectory(state, input); writableAuxiliary(input.path);
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > 64 * 1024 * 1024) throw new Error('Invalid write payload.');
      await store.writeBlob(input.id, input.path, input.bytes); return null;
    case 'fs.remove': authorizedDirectory(state, input); writableAuxiliary(input.path); await store.removePath(input.id, input.path, input.recursive === true); return null;
    case 'media.register': return registerMedia(state, input?.fileId);
    case 'video.cancelImport': state.imports.get(input?.requestId)?.abort(); return null;
    case 'editor.open': {
      authorizedDirectory(state, input);
      const { clipId, pinId } = input.target ?? {};
      if (typeof clipId !== 'string' || (pinId !== undefined && typeof pinId !== 'string')) throw new Error('Invalid editor target.');
      validateRelativePath(clipId);
      const key = `${input.id}/${clipId}/${pinId ?? ''}`;
      const existing = editorWindows.get(key);
      if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return null; }
      const url = `/clip/${encodeURIComponent(clipId)}${pinId === undefined ? '' : `?pinId=${encodeURIComponent(pinId)}`}`;
      const editor = await createWindow({ id: input.id, name: input.name, path: input.path }, url);
      editorWindows.set(key, editor);
      editor.once('closed', () => editorWindows.delete(key));
      return null;
    }
    case 'window.close': state.window.close(); return null;
    default: throw new Error('Unknown host operation.');
  }
}

async function createWindow(project = null, route = '/') {
  const connection = proxy.connect();
  const window = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 600, title: 'Annotate', show: false,
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  const state = { window, project, explicitProject: !!project, grants: new Set(project ? [project.id] : []), connection, files: new Map(), mediaByPath: new Map(), revisions: new Map(), baselines: new Map(), imports: new Map(), mayClose: false, closing: false };
  windows.set(window.webContents.id, state);
  const webContentsId = window.webContents.id;
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) { state.revisions.clear(); state.baselines.clear(); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== rendererOrigin) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (state.mayClose) return;
    event.preventDefault();
    if (!state.closing) { state.closing = true; window.webContents.send('annotate:prepare-close'); }
  });
  window.once('closed', () => {
    windows.delete(webContentsId);
    for (const controller of state.imports.values()) controller.abort();
    for (const file of state.files.values()) media.release(file.id);
    void connection.close();
    if (!windows.size && quitting) app.quit();
  });
  await window.loadURL(`${rendererOrigin}${route}`);
  if (!process.env.ANNOTATE_DESKTOP_HEADLESS) window.show();
  return window;
}

ipcMain.on('annotate:runtime', (event) => {
  try { event.returnValue = stateFor(event, true).connection.runtime; } catch { event.returnValue = null; }
});
ipcMain.handle('annotate:request', async (event, operation, input) => {
  try { return { ok: true, result: await dispatch(stateFor(event), operation, input) }; }
  catch (error) { return { ok: false, error: { message: String(error.message ?? 'Host operation failed.'), name: error.code === 'NOT_FOUND' ? 'NotFoundError' : error.name } }; }
});
ipcMain.on('annotate:close-ready', (event) => { const state = stateFor(event); state.mayClose = true; state.window.close(); });
ipcMain.on('annotate:close-error', async (event, message) => {
  const state = stateFor(event);
  const answer = await dialog.showMessageBox(state.window, { type: 'warning', message: 'The window has unfinished changes.', detail: String(message).slice(0, 500), buttons: ['Keep open', 'Discard and close'], cancelId: 0, defaultId: 0 });
  state.closing = false;
  if (answer.response === 1) { state.mayClose = true; state.window.close(); }
  else quitting = false;
});

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  quitting = true;
  if (windows.size) { for (const state of windows.values()) state.window.close(); return; }
  shuttingDown = true;
  void (async () => {
    try { await proxy?.close(); await media?.close(); await store.close(); }
    finally { await supervisor.stop(); shutdownComplete = true; app.quit(); }
  })();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.ANNOTATE_DESKTOP_HEADLESS) app.quit(); });
app.on('activate', () => { if (proxy && !windows.size) void createWindow(); });

// Do not await readiness at ES-module top level: Electron waits for module
// evaluation before dispatching ready.
void app.whenReady().then(async () => {
session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
]));
supervisor.on('log', ({ stream, text }) => process[stream].write(text));
supervisor.on('failure', ({ id }) => { dialog.showErrorBox('Annotate service stopped', `${id} stopped unexpectedly. Restart Annotate.`); app.quit(); });
try {
  if (!process.env.ANNOTATE_DESKTOP_HEADLESS) {
    startupWindow = new BrowserWindow({ width: 420, height: 200, title: 'Annotate', resizable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await startupWindow.loadFile(path.join(import.meta.dirname, 'startup.html'));
    startupWindow.on('closed', () => { startupWindow = null; if (!windows.size) app.quit(); });
  }
  const progress = (text, value) => {
    if (startupWindow && !startupWindow.isDestroyed()) void startupWindow.webContents.executeJavaScript(
      `document.querySelector('p').textContent=${JSON.stringify(text)};document.querySelector('progress').value=${value};`
    );
  };
  progress('Checking application files...', 0.1);
  const webPort = await freePort();
  const sidecarPort = await freePort();
  rendererOrigin = `http://127.0.0.1:${webPort}`;
  sidecarUrl = `http://127.0.0.1:${sidecarPort}`;
  sidecarToken = randomBytes(32).toString('hex');
  const layout = app.isPackaged
    ? await resolveResourceLayout(path.join(process.resourcesPath, 'runtime'), app.getPath('userData')) : null;
  const renderer = layout?.resources.renderer ?? path.join(root, 'webapp/.next-desktop/standalone/server.js');
  const python = layout?.resources.python ?? process.env.ANNOTATE_SIDECAR_PYTHON ?? path.join(root, 'sidecar/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const sidecarCwd = layout?.writable.temp ?? path.join(root, 'sidecar');
  const sidecarEnv = layout ? sidecarEnvironment(layout, { token: sidecarToken, origins: [rendererOrigin] })
    : { ...process.env, ANNOTATE_AUTH_TOKEN: sidecarToken, ANNOTATE_ALLOWED_ORIGINS: rendererOrigin };
  if (layout) {
    serviceLog = createWriteStream(path.join(layout.writable.logs, 'services.log'), { flags: 'a' });
    supervisor.on('log', ({ id, text }) => serviceLog.write(`[${id}] ${text}`));
  }
  supervisor.on('progress', ({ id, phase }) => progress(
    id === 'sidecar' ? 'Starting video and analysis services...' : 'Opening workspace...',
    id === 'sidecar' ? (phase === 'ready' ? 0.65 : 0.25) : 0.85
  ));
  await access(renderer); await access(python);
  boardSource = await readFile(layout ? path.join(path.dirname(renderer), 'public/tagging/board.json') : path.join(root, 'webapp/public/tagging/board.json'), 'utf8');
  try { recent = JSON.parse(await readFile(settingsPath, 'utf8')).path; } catch { /* First launch. */ }
  await supervisor.start([
    { id: 'sidecar', command: python, args: ['-m', 'annotate_sidecar', '--port', String(sidecarPort)], cwd: sidecarCwd,
      env: sidecarEnv,
      ready: async (signal) => (await fetch(`${sidecarUrl}/health`, { signal, headers: { Authorization: `Bearer ${sidecarToken}` } })).ok },
    { id: 'renderer', command: process.execPath, args: [renderer], cwd: path.dirname(renderer),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(webPort), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
      ready: async (signal) => (await fetch(rendererOrigin, { signal })).ok },
  ], { timeoutMs: 120000 });
  media = await startMediaServer(store, { allowedOrigins: [rendererOrigin] });
  proxy = await startSidecarProxy({ upstream: sidecarUrl, token: sidecarToken, rendererOrigin });
  await createWindow();
  startupWindow?.destroy();
} catch (error) {
  console.error(error);
  if (!process.env.ANNOTATE_DESKTOP_HEADLESS) dialog.showErrorBox('Annotate could not start', String(error.message));
  app.quit();
}
});
