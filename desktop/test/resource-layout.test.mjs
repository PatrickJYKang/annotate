import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveResourceLayout, sha256File, sidecarEnvironment } from '../core/resource-layout.mjs';

test('validates architecture and resource checksums and keeps mutable data outside the bundle', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-resources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'bundle');
  await mkdir(bundle);
  const resources = {};
  for (const name of ['renderer', 'python', 'sidecar', 'ffmpeg', 'ffprobe', 'yolo', 'pnlcalib', 'keypoints', 'lines']) {
    if (['sidecar', 'pnlcalib'].includes(name)) {
      await mkdir(path.join(bundle, name));
      if (name === 'pnlcalib') await mkdir(path.join(bundle, name, 'weights'));
      resources[name] = { path: name, kind: 'directory' };
    } else {
      const relative = name === 'keypoints' ? 'pnlcalib/weights/SV_kp' : name === 'lines' ? 'pnlcalib/weights/SV_lines' : name;
      const file = path.join(bundle, relative);
      await writeFile(file, `${name}-fixture`);
      resources[name] = { path: relative, kind: 'file', sha256: await sha256File(file) };
    }
  }
  await writeFile(path.join(bundle, 'runtime-manifest.json'), JSON.stringify({ version: 1, platform: process.platform, arch: process.arch, resources }));
  const before = await readdir(bundle);
  const layout = await resolveResourceLayout(bundle, path.join(root, 'user-data'));
  assert.deepEqual(await readdir(bundle), before);
  const env = sidecarEnvironment(layout, { token: 'b'.repeat(64), origins: ['http://127.0.0.1:3000'], inherited: { PYTHONHOME: '/different-python', ANNOTATE_PNLCALIB_CONFIG: '/different-config' } });
  assert.equal(env.PYTHONPATH, await realpath(path.join(bundle, 'sidecar')));
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(env.ANNOTATE_TRACKING_MODEL, await realpath(path.join(bundle, 'yolo')));
  assert.equal(env.ANNOTATE_AUTH_TOKEN, 'b'.repeat(64));
  assert.equal(env.PYTHONHOME, undefined);
  assert.equal(env.ANNOTATE_PNLCALIB_CONFIG, path.join(layout.resources.sidecar, 'annotate_sidecar', 'config', 'pnlcalib.default.toml'));
  await assert.rejects(resolveResourceLayout(bundle, path.join(root, 'data'), { platform: 'wrong', arch: process.arch }), /platform and architecture/);
  await assert.rejects(resolveResourceLayout(bundle, path.join(bundle, 'data')), /outside the bundle/);
  assert.deepEqual(await readdir(bundle), before);
  const alias = path.join(root, 'bundle-alias');
  await symlink(bundle, alias, 'junction');
  await assert.rejects(resolveResourceLayout(bundle, path.join(alias, 'new', 'data')), /outside the bundle/);
  assert.deepEqual(await readdir(bundle), before);
  await writeFile(path.join(bundle, 'yolo'), 'tampered');
  await assert.rejects(resolveResourceLayout(bundle, path.join(root, 'data')), /checksum mismatch/);
});
