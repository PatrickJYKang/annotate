import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { desktopPreviewVersion } from '../preview-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, `desktop/artifacts/installers/Annotate-${desktopPreviewVersion}-source.tar.gz`);
const ref = process.argv[2] ?? 'HEAD';
const candidates = execFileSync('git', ['ls-tree', '-rz', '--name-only', ref], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [];
for (const file of candidates) {
  if (!file.endsWith('.md') && !/^(webapp\/|sidecar\/|desktop\/|scripts\/|docs\/|legacy\/|brand\/wordmark\/a-icon\.svg$|\.github\/|package(-lock)?\.json$|LICENSE$)/.test(file)) continue;
  if (/(^|\/)(\.env[^/]*|node_modules|\.venv|__pycache__|test-results|playwright-report|artifacts|build)(\/|$)/.test(file)) continue;
  files.push(file);
}
await mkdir(path.dirname(destination), { recursive: true });
execFileSync('git', ['archive', '--format=tar.gz', `--output=${destination}`, ref, '--', ...files], { cwd: root });
console.log(`Archived ${files.length} source files from ${ref}: ${destination}`);
