import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { desktopPreviewVersion } from '../preview-version.mjs';

test('browser, desktop and lockfiles use one product version', async () => {
  for (const relative of ['../../package.json', '../../webapp/package.json', '../../package-lock.json', '../../webapp/package-lock.json']) {
    const document = JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
    assert.equal(document.version, desktopPreviewVersion, relative);
    if (document.packages) assert.equal(document.packages[''].version, desktopPreviewVersion, relative);
  }
  assert.match(desktopPreviewVersion, /^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/);
});
