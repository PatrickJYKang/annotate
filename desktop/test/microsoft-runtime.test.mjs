import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectMicrosoftRuntime, isMicrosoftRuntime, windowsRuntimeLicensePage } from '../scripts/microsoft-runtime.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const runtime = await mkdtemp(path.join(tmpdir(), 'annotate-msvc-'));
  t.after(() => rm(runtime, { recursive: true, force: true }));
  const files = [{ path: 'python/msvcp140.dll', sha256: digest('dll') }];
  const notices = [{ path: 'licenses/msvc/u4.rtf', sha256: digest('notice') }];
  for (const [file, contents] of [[files[0], 'dll'], [notices[0], 'notice']]) {
    await mkdir(path.dirname(path.join(runtime, file.path)), { recursive: true });
    await writeFile(path.join(runtime, file.path), contents);
  }
  return { runtime, lock: { schema: 1, files, notices, maintainerConfirmation: { installedAndTermsAccepted: true } } };
}
test('verifies all reviewed DLLs and their notices without executing them', async t => {
  const { runtime, lock } = await fixture(t);
  assert.equal((await inspectMicrosoftRuntime('', runtime, { lock })).filesVerified, true);
  await writeFile(path.join(runtime, 'python/msvcp140.dll'), 'changed');
  await assert.rejects(inspectMicrosoftRuntime('', runtime, { lock }), /changed/);
});
test('unreviewed wheel-bundled DLLs and missing notices fail closed', async t => {
  const { runtime, lock } = await fixture(t);
  const extra = path.join(runtime, 'python/msvcp140-wheel.dll');
  await writeFile(extra, 'new');
  await assert.rejects(inspectMicrosoftRuntime('', runtime, { lock }), /Unreviewed/);
  await rm(extra);
  await rm(path.join(runtime, 'licenses/msvc/u4.rtf'));
  await assert.rejects(inspectMicrosoftRuntime('', runtime, { lock }), /ENOENT/);
});
test('rejects path traversal and requires distributor confirmation', async t => {
  const { runtime, lock } = await fixture(t);
  await assert.rejects(inspectMicrosoftRuntime('', runtime, { lock: { ...lock, maintainerConfirmation: {} } }), /incomplete/);
  lock.files[0].path = '../msvcp140.dll';
  await assert.rejects(inspectMicrosoftRuntime('', runtime, { lock }), /path/);
});
test('recognizes renamed runtime DLLs and keeps Microsoft terms separate from GPL rights', () => {
  for (const name of ['MSVCP140.dll', 'msvcp140-123abc.dll', 'vcruntime140_1.dll', 'vcomp140.dll', 'concrt140.dll']) assert.equal(isMicrosoftRuntime(name), true);
  assert.equal(isMicrosoftRuntime('geos.dll'), false);
  const original = '{\\rtf1\\ansi\\pard MICROSOFT VISUAL C++ 2015 - 2022 RUNTIME\\par Original terms.}\0';
  const page = windowsRuntimeLicensePage(original);
  assert.ok(page.includes(original.slice(original.indexOf('\\pard'), -1)));
  assert.match(page, /ONLY to the Microsoft/);
  assert.match(page, /do not restrict your rights in Annotate/);
  assert.equal(page.includes('\0'), false);
  assert.throws(() => windowsRuntimeLicensePage('different licence'), /Unexpected/);
});
