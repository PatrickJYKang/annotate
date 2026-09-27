import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeServiceExecutable } from '../core/node-service-executable.mjs';

test('packaged macOS services use the background helper, not the foreground app', () => {
  assert.equal(nodeServiceExecutable('/Applications/Annotate.app/Contents/MacOS/Annotate', 'darwin'),
    '/Applications/Annotate.app/Contents/Frameworks/Annotate Helper.app/Contents/MacOS/Annotate Helper');
});

test('development macOS services use the Electron helper without hard-coded app paths', () => {
  assert.equal(nodeServiceExecutable('/Users/demo/My Repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin'),
    '/Users/demo/My Repo/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper');
});

test('Windows and Linux keep their existing Node-mode executable', () => {
  const windows = 'C:\\Program Files\\Annotate\\Annotate.exe';
  assert.equal(nodeServiceExecutable(windows, 'win32'), windows);
  assert.equal(nodeServiceExecutable('/opt/Annotate/annotate', 'linux'), '/opt/Annotate/annotate');
});
