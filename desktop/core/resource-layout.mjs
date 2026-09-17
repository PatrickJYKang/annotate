import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validateRelativePath } from './project-store.mjs';

const REQUIRED = {
  renderer: 'file', python: 'file', sidecar: 'directory', ffmpeg: 'file', ffprobe: 'file',
  yolo: 'file', pnlcalib: 'directory', keypoints: 'file', lines: 'file',
};

async function canonicalDestination(destination) {
  let existing = path.resolve(destination);
  const missing = [];
  while (true) {
    try { return path.join(await realpath(existing), ...missing); } catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(existing) === existing) throw error;
      missing.unshift(path.basename(existing));
      existing = path.dirname(existing);
    }
  }
}

function requireOutsideBundle(root, destination) {
  const relative = path.relative(root, destination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Writable application data must live outside the bundle.');
  }
}

export async function sha256File(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

/** Validate a staged bundle; the caller supplies OS-specific resource/user-data locations. */
export async function resolveResourceLayout(resourceRoot, userDataRoot, { platform = process.platform, arch = process.arch } = {}) {
  const root = await realpath(resourceRoot);
  const manifest = JSON.parse(await readFile(path.join(root, 'runtime-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.platform !== platform || manifest.arch !== arch || !manifest.resources) {
    throw new Error('The runtime bundle does not match this platform and architecture.');
  }
  const resolved = {};
  for (const [key, kind] of Object.entries(REQUIRED)) {
    const entry = manifest.resources[key];
    if (!entry || entry.kind !== kind) throw new Error(`Missing or invalid runtime resource: ${key}`);
    const relative = validateRelativePath(entry.path);
    const target = await realpath(path.join(root, ...relative));
    const fromRoot = path.relative(root, target);
    if (!fromRoot || fromRoot.startsWith(`..${path.sep}`) || fromRoot === '..' || path.isAbsolute(fromRoot)) throw new Error(`Runtime resource escapes its bundle: ${key}`);
    const stat = await lstat(target);
    if (entry.kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Invalid runtime resource: ${key}`);
    if (entry.kind === 'file') {
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || await sha256File(target) !== entry.sha256) throw new Error(`Runtime checksum mismatch: ${key}`);
    }
    resolved[key] = target;
  }
  for (const [key, filename] of [['keypoints', 'SV_kp'], ['lines', 'SV_lines']]) {
    if (resolved[key] !== await realpath(path.join(resolved.pnlcalib, 'weights', filename))) {
      throw new Error(`The verified ${key} weights must match the provider's runtime path.`);
    }
  }
  const userRoot = await canonicalDestination(userDataRoot);
  requireOutsideBundle(root, userRoot);
  const writable = {};
  // Resolve all existing aliases before creating anything, including /var on macOS.
  for (const key of ['cache', 'logs', 'temp', 'settings']) {
    writable[key] = await canonicalDestination(path.join(userRoot, key));
    requireOutsideBundle(root, writable[key]);
  }
  for (const key of ['cache', 'logs', 'temp', 'settings']) {
    await mkdir(writable[key], { recursive: true });
    writable[key] = await realpath(writable[key]);
    requireOutsideBundle(root, writable[key]);
  }
  await mkdir(path.join(writable.settings, 'ultralytics'), { recursive: true });
  return { resources: resolved, writable };
}

export function sidecarEnvironment(layout, { token, origins, inherited = process.env }) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '') || !Array.isArray(origins) || !origins.length) throw new Error('Managed services require a session token and allowed origins.');
  const { resources, writable } = layout;
  const environment = {
    ...inherited,
    PATH: [path.dirname(resources.ffmpeg), path.dirname(resources.ffprobe), inherited.PATH ?? ''].join(path.delimiter),
    PYTHONPATH: resources.sidecar,
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    ANNOTATE_PNLCALIB_ROOT: resources.pnlcalib,
    ANNOTATE_PNLCALIB_CONFIG: path.join(resources.sidecar, 'annotate_sidecar', 'config', 'pnlcalib.default.toml'),
    ANNOTATE_TRACKING_MODEL: resources.yolo,
    ANNOTATE_AUTH_TOKEN: token,
    ANNOTATE_ALLOWED_ORIGINS: origins.join(','),
    XDG_CACHE_HOME: writable.cache,
    MPLCONFIGDIR: path.join(writable.cache, 'matplotlib'),
    TORCH_HOME: path.join(writable.cache, 'torch'),
    YOLO_CONFIG_DIR: path.join(writable.settings, 'ultralytics'),
    TMPDIR: writable.temp, TMP: writable.temp, TEMP: writable.temp,
  };
  delete environment.PYTHONHOME;
  return environment;
}
